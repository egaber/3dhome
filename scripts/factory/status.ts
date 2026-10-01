import { existsSync } from 'node:fs';
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, join, relative, isAbsolute, sep } from 'node:path';
import { z } from 'zod';
import type { FactoryConfig, FactoryTask } from './core';
import { isAlive, readBoard, readConfig, runtimePath } from './runtime';
import { readNotes } from './notes';
import type { OperatorNote } from './notes';
import { boardVersion, taskVersion } from './operator';

const stateSchema = z.object({ pid: z.number().int().positive(), stopped: z.boolean(), heartbeat: z.string().datetime(), started: z.string().datetime() });
const childSchema = z.object({ pid: z.number().int().positive(), owner: z.number().int().positive(), started_at: z.string().optional(), label: z.string().optional(), log_file: z.string().optional() });
const usageSchema = z.object({ date: z.string(), calls: z.number().int().nonnegative() });

export interface Activity { at: string; text: string; level: 'info' | 'error' }
export interface FactorySnapshot {
  generated_at: string;
  project: string;
  worker: { running: boolean; state: 'running' | 'paused' | 'pausing' | 'stopping' | 'stopped' | 'stale'; pid?: number; heartbeat?: string; pause_reason: string; active_process?: { label: string; started_at?: string } };
  tasks: (FactoryTask & { version: string })[];
  board_version: string;
  notes: OperatorNote[];
  activity: Activity[];
  latest_run?: string;
  calls_today: number;
  limits: Pick<FactoryConfig, 'maxRetries' | 'maxStepsPerTask' | 'maxFollowUpsPerRoot' | 'maxAgentRunsPerDay' | 'maxAiCreditsPerStage'>;
}

async function optionalFile(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

export function displayText(text: string): string {
  // Never allow log/notes to emit terminal control sequences or directional overrides.
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '');
}

export async function readTail(file: string, maxBytes = 128 * 1024): Promise<string> {
  let handle;
  try { handle = await open(file, 'r'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
  try {
    const size = (await handle.stat()).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return start ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { await handle.close(); }
}

/** Whitelist public progress metadata. Never expose raw tool arguments, outputs or reasoning. */
export function parseActivity(text: string): Activity[] {
  const activity: Activity[] = [];
  for (const line of text.split(/\r?\n/)) {
    let event: { type?: string; timestamp?: string; data?: { toolName?: string; success?: boolean }; exitCode?: number };
    try { event = JSON.parse(line); } catch { continue; }
    const at = typeof event.timestamp === 'string' ? event.timestamp : '';
    if (event.type === 'tool.execution_start' && typeof event.data?.toolName === 'string') activity.push({ at, text: `Using ${displayText(event.data.toolName).slice(0, 80)}`, level: 'info' });
    if (event.type === 'tool.execution_complete') activity.push({ at, text: event.data?.success === false ? 'Tool reported a failure' : 'Tool finished', level: event.data?.success === false ? 'error' : 'info' });
    if (event.type === 'assistant.turn_start') activity.push({ at, text: 'Agent is working on the next response', level: 'info' });
    if (event.type === 'result') activity.push({ at, text: event.exitCode === 0 ? 'Agent session finished' : 'Agent session failed', level: event.exitCode === 0 ? 'info' : 'error' });
    if (event.type === 'session.error') activity.push({ at, text: 'Copilot reported an error; inspect the local stage log', level: 'error' });
  }
  return activity.slice(-20);
}

/** Realpath containment protects against traversal and symlink/junction escapes. */
export async function resolveRunFile(root: string, requested: string): Promise<string> {
  if (!/^\.factory\/runs\/[A-Z][A-Z0-9]*-\d+-\d+-\d+\//.test(requested)
    || requested.includes('\\') || requested.split('/').some(part => part === '..' || part === '.') || isAbsolute(requested)) throw new Error('Invalid artifact path.');
  const base = await realpath(runtimePath(root, 'runs'));
  const target = await realpath(join(root, requested));
  const within = relative(base, target);
  if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error('Artifact is outside the run directory.');
  if (!(await stat(target)).isFile()) throw new Error('Artifact must be a file.');
  return target;
}

export async function getSnapshot(root: string): Promise<FactorySnapshot> {
  const [tasks, config, notes, stateText, childText, usageText, pauseText] = await Promise.all([
    readBoard(root), readConfig(root), readNotes(root), optionalFile(runtimePath(root, 'state.json')),
    optionalFile(runtimePath(root, 'child.json')), optionalFile(runtimePath(root, 'usage.json')), optionalFile(runtimePath(root, 'PAUSED.txt')),
  ]);
  const state = stateText ? stateSchema.parse(JSON.parse(stateText)) : undefined;
  const child = childText ? childSchema.parse(JSON.parse(childText)) : undefined;
  const usage = usageText ? usageSchema.parse(JSON.parse(usageText)) : undefined;
  const running = !!state && !state.stopped && isAlive(state.pid);
  const childRunning = !!child && isAlive(child.pid);
  const stale = running && Date.now() - Date.parse(state!.heartbeat) > 20_000;
  const workerState = !running ? 'stopped' : stale ? 'stale' : existsSync(runtimePath(root, 'STOP')) ? 'stopping'
    : pauseText !== undefined ? (childRunning ? 'pausing' : 'paused') : 'running';
  const active = tasks.find(task => task.status === 'In_Progress');
  let latestRun: string | undefined;
  let activity: Activity[] = [];
  if (active && existsSync(runtimePath(root, 'runs'))) {
    const runs = (await readdir(runtimePath(root, 'runs'))).filter(name => new RegExp(`^${active.id}-\\d+-\\d+$`).test(name)).sort();
    latestRun = runs.at(-1);
    if (latestRun) {
      try { activity = parseActivity(await readTail(await resolveRunFile(root, `.factory/runs/${latestRun}/copilot.jsonl`))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  if (childRunning && child?.log_file && !child.log_file.endsWith('copilot.jsonl')) {
    const file = await resolveRunFile(root, child.log_file);
    activity = (await readTail(file, 16 * 1024)).split(/\r?\n/).filter(line => line.trim()).slice(-12)
      .map(line => ({ at: '', text: displayText(line).slice(0, 400), level: 'info' }));
  }
  return {
    generated_at: new Date().toISOString(), project: basename(root),
    worker: { running, state: workerState, pid: state?.pid, heartbeat: state?.heartbeat, pause_reason: pauseText ?? '',
      active_process: childRunning ? { label: child?.label ?? 'Agent or quality check', started_at: child?.started_at } : undefined },
    tasks: tasks.map(task => ({ ...task, version: taskVersion(task) })), board_version: boardVersion(tasks), notes,
    activity, latest_run: latestRun,
    calls_today: usage?.date === new Date().toISOString().slice(0, 10) ? usage.calls : 0,
    limits: { maxRetries: config.maxRetries, maxStepsPerTask: config.maxStepsPerTask, maxFollowUpsPerRoot: config.maxFollowUpsPerRoot, maxAgentRunsPerDay: config.maxAgentRunsPerDay, maxAiCreditsPerStage: config.maxAiCreditsPerStage },
  };
}