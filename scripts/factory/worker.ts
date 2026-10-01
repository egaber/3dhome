import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyResult, beginStep, blockTask, newTask, selectTask, titleKey } from './core';
import type { AgentResult, FactoryConfig, FactoryTask, Verification } from './core';
import { atomicWrite, fingerprint, Interrupted, invokeAgent, localPath, runChecks, runtimePath, updateBoard } from './runtime';
import type { MemoryEntry } from './runtime';
import { notesForTask, notesVersion, readNotes, withNotesLock } from './notes';
import type { OperatorNote } from './notes';

export async function importBacklog(root: string, config: FactoryConfig): Promise<void> {
  const titles = (await readFile(join(root, 'BACKLOG.md'), 'utf8')).split(/\r?\n/)
    .flatMap(line => /^\s*- \[ \] (.+?)\s*$/.exec(line)?.[1] ?? []);
  if (!titles.length) return;
  await updateBoard(root, tasks => {
    const entries: MemoryEntry[] = [];
    for (const title of titles) {
      const key = titleKey(title);
      if (tasks.some(task => task.source_key === key || titleKey(task.title) === key)) continue;
      if (tasks.length >= config.maxBacklogSize) throw new Error('Backlog limit reached. Archive reviewed completed tasks before importing more.');
      const task = { ...newTask(tasks, title, config.maxRetries), source_key: key };
      tasks.push(task);
      entries.push({ section: 'Live System Logs', text: `- ${new Date().toISOString()} imported ${task.id}: ${task.title}` });
    }
    return { tasks, entries };
  });
}

async function reserveDailyCall(root: string, config: FactoryConfig): Promise<void> {
  const file = runtimePath(root, 'usage.json');
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  if (existsSync(file)) {
    const usage: { date: string; calls: number } = JSON.parse(await readFile(file, 'utf8'));
    if (!Number.isSafeInteger(usage.calls) || usage.calls < 0 || typeof usage.date !== 'string') throw new Error('Invalid usage ledger; manual review required.');
    if (usage.date === today) count = usage.calls;
  }
  if (count >= config.maxAgentRunsPerDay) throw new Error('Daily agent-call budget reached. Review usage before resuming; the counter resets on the next UTC day.');
  await atomicWrite(file, JSON.stringify({ date: today, calls: count + 1 }));
}

function assertSameTask(actual: FactoryTask | undefined, expected: FactoryTask): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Active task changed externally. Result preserved; refusing to overwrite the edit.');
}

async function persistResult(root: string, task: FactoryTask, result: AgentResult, config: FactoryConfig, runDir: string, evidence?: Verification, reviewedNotes: OperatorNote[] = []): Promise<void> {
  // Serialize the last note read with final acceptance so a concurrent note is not silently missed.
  if (result.outcome === 'done') {
    await withNotesLock(root, async () => {
      const current = notesForTask(await readNotes(root), task.id);
      if (notesVersion(current) !== notesVersion(reviewedNotes)) {
        await updateBoard(root, tasks => {
          assertSameTask(tasks.find(item => item.id === task.id), task);
          return { tasks, entries: [{ section: 'Live System Logs', text: `- ${new Date().toISOString()} ${task.id}: new operator notes arrived during final review; completion deferred until another team-lead review. Stage/call budgets still apply.` }] };
        });
        await atomicWrite(join(runDir, 'operator-note-deferral.txt'), 'New operator notes arrived during final review. The task remains In_Progress; its next counted stage is another final review.');
        return;
      }
      await commitResult(root, task, result, config, runDir, evidence);
    });
    return;
  }
  await commitResult(root, task, result, config, runDir, evidence);
}

async function commitResult(root: string, task: FactoryTask, result: AgentResult, config: FactoryConfig, runDir: string, evidence?: Verification): Promise<void> {
  await updateBoard(root, tasks => {
    assertSameTask(tasks.find(item => item.id === task.id), task);
    const next = applyResult(tasks, task.id, result, config, evidence);
    const updated = next.find(item => item.id === task.id)!;
    const heading = `### ${new Date().toISOString()} · ${task.id} · ${task.assigned_to}`;
    const entries: MemoryEntry[] = [{
      section: 'Live System Logs',
      text: `${heading}\n\n${result.summary}\n\n${result.notes ?? ''}\n\nState: ${updated.status}; next: ${updated.assigned_to}; retries: ${updated.retry_count}/${Math.min(updated.max_retries, config.maxRetries)}. Evidence: ${localPath(root, runDir)}.`,
    }];
    if (task.assigned_to === 'architect' && result.outcome === 'handoff' && result.contract) entries.push({ section: 'Architectural Contracts', text: `${heading}\n\n${result.contract}` });
    if (task.assigned_to === 'ux-ui') entries.push({ section: 'UX/UI Notes', text: `${heading} (${task.phase})\n\n${result.notes ?? result.summary}` });
    if (task.assigned_to === 'skeptic' && result.outcome === 'handoff') entries.push({ section: 'Architectural Contracts', text: `${heading}\n\nAPPROVED — current contract and UX design for ${task.id}.` });
    return { tasks: next, entries };
  });
}

export async function runOneStage(root: string, config: FactoryConfig, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || existsSync(runtimePath(root, 'PAUSED.txt')) || existsSync(runtimePath(root, 'STOP'))) return false;
  await importBacklog(root, config);
  let claimed: FactoryTask | undefined;
  await updateBoard(root, tasks => {
    // Select under the board lock so a simultaneous dashboard edit/reorder is not a protocol error.
    if (signal.aborted || existsSync(runtimePath(root, 'PAUSED.txt')) || existsSync(runtimePath(root, 'STOP'))) return { tasks };
    const selected = selectTask(tasks);
    if (!selected) return { tasks };
    claimed = beginStep(selected, config);
    return { tasks: tasks.map(item => item.id === claimed!.id ? claimed! : item) };
  });
  if (!claimed) return false;
  const task = claimed;
  if (task.status === 'Blocked') return true;
  const runDir = runtimePath(root, 'runs', `${task.id}-${String(task.step_count).padStart(3, '0')}-${Date.now()}`);
  await mkdir(runDir, { recursive: true });
  console.log(`${new Date().toISOString()} ${task.id} -> ${task.assigned_to} (${task.phase}, stage ${task.step_count})`);
  const sourceBefore = await fingerprint(root);
  const protectedBefore = await fingerprint(root, true);
  let evidence = task.verification;
  const stage = new AbortController();
  const cancel = () => stage.abort(new Interrupted('Factory stopped; partial edits are preserved.'));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const deadline = setTimeout(() => stage.abort(new Error(`Stage exceeded its ${config.stageTimeoutMs}ms total time budget.`)), config.stageTimeoutMs);
  try {
    if (task.phase === 'delivery' && ['visual-qa', 'ux-ui', 'team-lead'].includes(task.assigned_to)
      && evidence?.source_hash !== sourceBefore) throw new Error('Source changed since QA. Requeue through engineer/QA; stale evidence cannot finish a task.');
    if (task.assigned_to === 'qa' || task.assigned_to === 'visual-qa') {
      const browser = task.assigned_to === 'visual-qa';
      evidence = await runChecks(root, config, runDir, browser, sourceBefore, stage.signal, task.verification);
      if (await fingerprint(root) !== sourceBefore) throw new Error('Verification modified source or control files. Refusing to approve self-changing checks.');
      if (!evidence.qa_passed || (browser && !evidence.browser_passed)) {
        const result: AgentResult = {
          task_id: task.id, outcome: 'revise', next_agent: 'engineer', followups: [],
          summary: `Executable ${browser ? 'browser' : 'type/unit/build'} gate failed. Inspect ${evidence.logs.join(', ')} and add a regression fix; do not weaken checks.`,
          notes: (await Promise.all(evidence.logs.map(file => readFile(join(root, file), 'utf8')))).map(text => text.slice(-2000)).join('\n').slice(-6000),
        };
        await atomicWrite(join(runDir, 'decision.json'), JSON.stringify(result, null, 2));
        await persistResult(root, task, result, config, runDir, evidence);
        return true;
      }
    }
    if (stage.signal.aborted) throw stage.signal.reason;
    const operatorNotes = notesForTask(await readNotes(root), task.id);
    await reserveDailyCall(root, config);
    const result = await invokeAgent(root, task, config, runDir, evidence, stage.signal, operatorNotes);
    const sourceAfter = await fingerprint(root);
    if (await fingerprint(root, true) !== protectedBefore) throw new Error('Protected factory, dependency, or verification files changed. Review the diff; the factory will not overwrite or accept it.');
    if (task.assigned_to !== 'engineer' && sourceAfter !== sourceBefore) throw new Error('A read-only review stage changed source. Approval rejected.');
    await persistResult(root, task, result, config, runDir, evidence, operatorNotes);
    return true;
  } catch (error) {
    if (error instanceof Interrupted) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    await atomicWrite(join(runDir, 'failure.txt'), reason);
    await updateBoard(root, tasks => {
      // Preserve external edits to the active task, including operator intervention.
      const current = tasks.find(item => item.id === task.id);
      if (JSON.stringify(current) !== JSON.stringify(task)) return { tasks };
      return {
        tasks: tasks.map(item => item.id === task.id ? blockTask(item, reason) : item),
        entries: [{ section: 'Live System Logs', text: `### ${new Date().toISOString()} · ${task.id} · BLOCKED\n\n${reason}\n\nEvidence: ${localPath(root, runDir)}.` }],
      };
    });
    throw error; // Circuit breaker: do not burn quota by trying every other task.
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', cancel);
  }
}