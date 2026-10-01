import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema, newTask } from './core';
import type { AgentResult, FactoryTask, Role, Verification } from './core';
import { readBoard } from './runtime';
import { runOneStage } from './worker';
import { addNote } from './notes';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), checks: vi.fn(), fingerprint: vi.fn() }));
vi.mock('./runtime', async importOriginal => ({
  ...await importOriginal<typeof import('./runtime')>(),
  invokeAgent: mocks.invoke, runChecks: mocks.checks, fingerprint: mocks.fingerprint,
}));

let root: string;
const config = configSchema.parse({});
const signal = new AbortController().signal;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'house-factory-worker-'));
  await mkdir(join(root, '.factory'));
  await writeFile(join(root, 'tasks.json'), JSON.stringify([newTask([], 'Small feature', 3)]));
  await writeFile(join(root, 'MEMORY.md'), '## Tech Stack\nTypeScript\n## Architectural Contracts\nNone\n## UX/UI Notes\nNone\n## Live System Logs\nReady\n');
  await writeFile(join(root, 'BACKLOG.md'), '# Empty inbox\n');
  mocks.fingerprint.mockImplementation(async (_root: string, protectedOnly: boolean) => protectedOnly ? 'controls' : 'source');
  mocks.checks.mockImplementation(async (_root: string, _config: unknown, _dir: string, browser: boolean): Promise<Verification> => ({
    source_hash: 'source', qa_passed: true, browser_passed: browser, logs: [], screenshots: browser ? ['desktop.png', 'mobile.png'] : [],
  }));
  mocks.invoke.mockImplementation(async (_root: string, task: FactoryTask): Promise<AgentResult> => {
    const routes: Record<Role, Role> = { pm: 'architect', architect: 'ux-ui', 'ux-ui': task.phase === 'plan' ? 'skeptic' : 'team-lead', skeptic: 'team-lead', 'team-lead': 'engineer', engineer: 'qa', qa: 'visual-qa', 'visual-qa': 'ux-ui' };
    return {
      task_id: task.id, summary: 'Specific verified result.', followups: [],
      outcome: task.assigned_to === 'team-lead' && task.phase === 'delivery' ? 'done' : 'handoff',
      next_agent: routes[task.assigned_to],
      ...(task.assigned_to === 'pm' ? { acceptance_criteria: ['Feature works and rejects invalid input.'] } : {}),
      ...(task.assigned_to === 'architect' ? { contract: 'Exact TypeScript interfaces and files.' } : {}),
    };
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('supervisor integration with a simulated native harness', () => {
  it('persists the entire graph, executable evidence, approvals, and final Done', async () => {
    for (let stage = 0; stage < 10; stage++) expect(await runOneStage(root, config, signal)).toBe(true);
    const [task] = await readBoard(root);
    expect(task.status).toBe('Done');
    expect(task.step_count).toBe(10);
    expect(mocks.invoke).toHaveBeenCalledTimes(10);
    expect(mocks.checks).toHaveBeenCalledTimes(2);
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('APPROVED');
    expect(await runOneStage(root, config, signal)).toBe(false);
  });

  it('does not invoke an agent for an idle or disabled backlog', async () => {
    await writeFile(join(root, 'tasks.json'), JSON.stringify([{ ...newTask([], 'Example only', 3), enabled: false }]));
    expect(await runOneStage(root, config, signal)).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('passes operator notes to the next stage without invalidating active task state', async () => {
    await addNote(root, { task_id: 'TASK-001', text: 'Keep the task scope small.' });
    await addNote(root, { task_id: null, text: 'Preserve accessibility.' });
    await runOneStage(root, config, signal);
    const suppliedNotes = mocks.invoke.mock.calls[0][6] as { text: string }[];
    expect(suppliedNotes.map(note => note.text)).toEqual(['Keep the task scope small.', 'Preserve accessibility.']);
    expect((await readBoard(root))[0].assigned_to).toBe('architect');
  });

  it('does not mark Done if a new operator note arrives during the final review', async () => {
    for (let stage = 0; stage < 9; stage++) await runOneStage(root, config, signal);
    mocks.invoke.mockImplementation(async (_root: string, task: FactoryTask) => {
      await addNote(root, { task_id: task.id, text: 'Review the newest boundary case before finishing.' });
      return { task_id: task.id, outcome: 'done', summary: 'Reviewed earlier context', followups: [] };
    });
    await runOneStage(root, config, signal);
    expect((await readBoard(root))[0].status).toBe('In_Progress');
    expect((await readBoard(root))[0].assigned_to).toBe('team-lead');
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('completion deferred');
  });

  it('does not claim a task while paused or after a stop request', async () => {
    await writeFile(join(root, '.factory', 'PAUSED.txt'), 'Operator pause');
    expect(await runOneStage(root, config, signal)).toBe(false);
    expect((await readBoard(root))[0].step_count).toBe(0);
    await rm(join(root, '.factory', 'PAUSED.txt'));
    await writeFile(join(root, '.factory', 'STOP'), 'Stop');
    expect(await runOneStage(root, config, signal)).toBe(false);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('blocks a malformed/infrastructure result and preserves diagnostic artifacts', async () => {
    mocks.invoke.mockRejectedValue(new Error('CLI authentication failed'));
    await expect(runOneStage(root, config, signal)).rejects.toThrow('authentication');
    expect((await readBoard(root))[0].status).toBe('Blocked');
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('CLI authentication failed');
  });

  it('routes a failed executable gate back to engineer and records real failure output', async () => {
    for (let stage = 0; stage < 6; stage++) await runOneStage(root, config, signal);
    await writeFile(join(root, '.factory', 'failed-unit.log'), 'Expected validated input; received an unchecked value.');
    mocks.checks.mockResolvedValue({ source_hash: 'source', qa_passed: false, browser_passed: false, screenshots: [], logs: ['.factory/failed-unit.log'] });
    await runOneStage(root, config, signal);
    const [task] = await readBoard(root);
    expect(task.assigned_to).toBe('engineer');
    expect(task.retry_count).toBe(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(6);
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('received an unchecked value');
  });

  it('rejects protected-file edits and preserves conflicting active-task edits', async () => {
    mocks.invoke.mockImplementation(async () => {
      const [task] = await readBoard(root);
      await writeFile(join(root, 'tasks.json'), JSON.stringify([{ ...task, title: 'Human-edited title' }]));
      return { task_id: task.id, outcome: 'handoff', next_agent: 'architect', summary: 'Scope', acceptance_criteria: ['Observable'], followups: [] };
    });
    await expect(runOneStage(root, config, signal)).rejects.toThrow('changed externally');
    expect((await readBoard(root))[0].title).toBe('Human-edited title');
    mocks.invoke.mockResolvedValue({ task_id: 'TASK-001', outcome: 'blocked', summary: 'Stop', followups: [] });
    mocks.fingerprint.mockResolvedValueOnce('source').mockResolvedValueOnce('before').mockResolvedValueOnce('source').mockResolvedValueOnce('after');
    await expect(runOneStage(root, config, signal)).rejects.toThrow('Protected factory');
    expect((await readBoard(root))[0].status).toBe('Blocked');
  });

  it('does not finish using stale source evidence or spend above the daily invocation budget', async () => {
    for (let stage = 0; stage < 7; stage++) await runOneStage(root, config, signal);
    mocks.fingerprint.mockResolvedValue('changed-after-qa');
    await expect(runOneStage(root, config, signal)).rejects.toThrow('Source changed');
    expect((await readBoard(root))[0].status).toBe('Blocked');
    await writeFile(join(root, 'tasks.json'), JSON.stringify([newTask([], 'Another feature', 3)]));
    await writeFile(join(root, '.factory', 'usage.json'), JSON.stringify({ date: new Date().toISOString().slice(0, 10), calls: 40 }));
    await expect(runOneStage(root, config, signal)).rejects.toThrow('Daily agent-call budget');
    expect(mocks.invoke).toHaveBeenCalledTimes(7);
  });
});