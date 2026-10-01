import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { lock } from 'proper-lockfile';
import { chromium } from '@playwright/test';
import { newTask, parseAgentOutput, selectTask } from './scripts/factory/core';
import { atomicWrite, Interrupted, isAlive, readBoard, readConfig, resolveCopilot, runProcess, runtimePath, updateBoard, verifyInstallation } from './scripts/factory/runtime';
import { runOneStage } from './scripts/factory/worker';
import { startWorker } from './scripts/factory/lifecycle';
import { liveStatus } from './scripts/factory/live';
import { addNote } from './scripts/factory/notes';

const root = fileURLToPath(new URL('.', import.meta.url));
const [command = 'watch', ...args] = process.argv.slice(2);
const pauseFile = runtimePath(root, 'PAUSED.txt');
const stopFile = runtimePath(root, 'STOP');

async function watch(once: boolean): Promise<void> {
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const release = await lock(root, {
    lockfilePath: runtimePath(root, 'runner.lock'), stale: 60_000, update: 10_000, retries: 0,
    onCompromised: error => { console.error(error.message); controller.abort(); },
  });
  const started = new Date().toISOString();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stateWrites = Promise.resolve();
  const saveState = (stopped = false) => {
    stateWrites = stateWrites.then(() => atomicWrite(runtimePath(root, 'state.json'), JSON.stringify({
      pid: process.pid, started, heartbeat: new Date().toISOString(), stopped, paused: existsSync(pauseFile),
    })));
    return stateWrites;
  };
  try {
    const childFile = runtimePath(root, 'child.json');
    if (existsSync(childFile)) {
      const previous: { pid: number } = JSON.parse(await readFile(childFile, 'utf8'));
      if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0 || isAlive(previous.pid)) throw new Error('A previous child process may still be running. Inspect it before restarting; do not delete locks blindly.');
      await rm(childFile);
    }
    await rm(stopFile, { force: true });
    const config = await readConfig(root);
    await verifyInstallation(root, config);
    await updateBoard(root, tasks => ({ tasks })); // Also replay an interrupted shared-state transaction.
    await saveState();
    heartbeat = setInterval(() => { void saveState().catch(() => controller.abort()); }, 5000);
    console.log(`Factory ${process.pid} ready; polling every ${config.pollIntervalMs / 1000}s. No automatic commits or deployment.`);
    if (process.send) { process.send({ ready: true, pid: process.pid }); process.disconnect(); }
    while (!controller.signal.aborted && !existsSync(stopFile)) {
      if (!existsSync(pauseFile)) {
        try { await runOneStage(root, config, controller.signal); }
        catch (error) {
          if (error instanceof Interrupted) break;
          const message = error instanceof Error ? error.message : String(error);
          await atomicWrite(pauseFile, message);
          console.error(`Factory paused: ${message}`);
          if (once) throw error;
        }
      }
      if (once) break;
      try { await delay(config.pollIntervalMs, undefined, { signal: controller.signal }); }
      catch { break; }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await saveState(true).catch(() => undefined);
    await release();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

async function start(): Promise<void> {
  console.log(`Factory started in the background (PID ${await startWorker(root)}). Use factory:live, factory:status, factory:pause, or factory:stop.`);
}

async function status(): Promise<void> {
  let state: { pid: number; stopped: boolean; heartbeat: string } | undefined;
  if (existsSync(runtimePath(root, 'state.json'))) state = JSON.parse(await readFile(runtimePath(root, 'state.json'), 'utf8'));
  const running = state && !state.stopped && isAlive(state.pid);
  console.log(running && state ? `Running: PID ${state.pid}; heartbeat ${state.heartbeat}` : 'Factory is stopped.');
  if (existsSync(pauseFile)) console.log(`Paused: ${await readFile(pauseFile, 'utf8')}`);
  if (existsSync(stopFile) && running) console.log('Stop requested; waiting for the active process to exit.');
  console.table((await readBoard(root)).map(task => ({
    id: task.id, status: task.status, agent: task.assigned_to, enabled: task.enabled,
    retries: `${task.retry_count}/${task.max_retries}`, stages: task.step_count, title: task.title,
  })));
}

async function doctor(): Promise<void> {
  const config = await readConfig(root);
  const cli = await verifyInstallation(root, config);
  const tasks = await readBoard(root);
  if (!existsSync(chromium.executablePath())) throw new Error('Playwright Chromium is missing. Run the documented browser installation step.');
  const browser = await chromium.launch({ headless: true, timeout: 15_000 });
  await browser.close();
  console.log(`Node ${process.version}; Copilot ${cli}; 8 native profiles; board valid (${tasks.length} tasks); Chromium launch verified.`);
  console.log(`Limits: ${config.maxRetries} repairs/task, ${config.maxStepsPerTask} stages/task, ${config.maxAgentRunsPerDay} calls/day, ${config.maxAiCreditsPerStage} credits/stage (soft).`);
  if (args.includes('--probe')) {
    const result = await runProcess(resolveCopilot(config), [
      '--agent', 'pm', '--prompt', 'FACTORY_DOCTOR: this is a no-tool configuration probe, not a backlog stage. Do not inspect files, implement tasks, or delegate. Return exactly {"task_id":"PROBE-000","outcome":"blocked","summary":"FACTORY_CLI_OK"}.',
      '--available-tools=', '--output-format', 'json', '--stream', 'off', '--silent',
      '--disable-builtin-mcps', '--no-ask-user', '--no-auto-update', '--no-remote-export',
      '--max-ai-credits', String(config.maxAiCreditsPerStage),
    ], {
      root, logFile: runtimePath(root, 'doctor-probe.jsonl'), timeoutMs: 90_000, trackChild: false,
      env: { COPILOT_ALLOW_ALL: 'false', GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: 'false', GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP: 'false' },
    });
    if (result.code !== 0 || parseAgentOutput(result.stdout).summary !== 'FACTORY_CLI_OK') throw new Error('Authenticated custom-agent probe failed; inspect the local probe log.');
    console.log('Authenticated pm custom-agent probe passed. No backlog task was executed.');
  } else console.log('Authentication/model access is not tested by --help. The optional --probe makes one billable, no-tool request.');
}

async function main(): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or newer is required.');
  await mkdir(runtimePath(root), { recursive: true });
  switch (command) {
    case 'watch': return watch(false);
    case 'once': return watch(true);
    case 'start': return start();
    case 'status': return args.includes('--watch') ? liveStatus(root) : status();
    case 'live': return liveStatus(root);
    case 'web': {
      const port = args.length ? Number(args[0]) : 4318;
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a local dashboard port between 1024 and 65535.');
      const { serveDashboard } = await import('./scripts/factory/server');
      return serveDashboard(root, port);
    }
    case 'note': {
      const note = await addNote(root, { task_id: args[0] === 'all' ? null : args[0], text: args.slice(1).join(' ') });
      console.log(`Note saved for ${note.task_id ?? 'all tasks'}. Available to upcoming agent stages.`);
      break;
    }
    case 'doctor': return doctor();
    case 'pause': await atomicWrite(pauseFile, 'Operator pause. Active stage may finish; no new stage will start.'); break;
    case 'resume': await rm(pauseFile, { force: true }); console.log('Pause cleared. If stopped, start the factory separately.'); break;
    case 'stop': await atomicWrite(stopFile, 'Stop requested by operator.'); console.log('Stop requested. Active child processes are terminated; partial edits are preserved.'); break;
    case 'dry-run': {
      const task = selectTask(await readBoard(root));
      console.log(task ? `Would run ${task.assigned_to} for ${task.id}: ${task.title}` : 'No enabled, dependency-ready task. Disabled examples will not run.');
      console.log('Dry run does not import backlog, mutate the board, or invoke an agent.');
      break;
    }
    case 'add': {
      const config = await readConfig(root);
      const title = args.join(' ').trim();
      await updateBoard(root, tasks => {
        if (tasks.length >= config.maxBacklogSize) throw new Error('Backlog size limit reached.');
        const task = newTask(tasks, title, config.maxRetries);
        console.log(`Added ${task.id}: ${task.title}`);
        return { tasks: [...tasks, task] };
      });
      break;
    }
    case 'retry': {
      if (!existsSync(pauseFile)) throw new Error('Pause the factory before requeueing reviewed work.');
      await updateBoard(root, tasks => {
        const task = tasks.find(item => item.id === args[0]);
        if (!task || task.status !== 'Blocked') throw new Error('Specify a Blocked task ID.');
        return {
          tasks: tasks.map(item => item === task ? {
            ...item, status: 'Todo', assigned_to: 'pm', phase: 'plan', enabled: true,
            retry_count: 0, step_count: 0, approvals: [], contract: '', verification: undefined, last_error: undefined,
          } : item),
          entries: [{ section: 'Live System Logs', text: `- ${new Date().toISOString()} operator explicitly requeued ${task.id}; repair/stage budgets reset after review.` }],
        };
      });
      break;
    }
    default: throw new Error('Commands: watch, start, once, dry-run, doctor [--probe], status [--watch], live, web [port], note <task-id|all> <text>, pause, resume, stop, add <title>, retry <blocked-id>.');
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });