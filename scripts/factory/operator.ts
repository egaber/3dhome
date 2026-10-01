import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { z } from 'zod';
import { newTask, taskSchema } from './core';
import type { FactoryTask } from './core';
import { atomicWrite, hash, readConfig, runtimePath, updateBoard } from './runtime';
import type { MemoryEntry } from './runtime';
import { startWorker } from './lifecycle';

export class OperatorError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const taskVersion = (task: FactoryTask) => hash(JSON.stringify(task));
export const boardVersion = (tasks: FactoryTask[]) => hash(JSON.stringify(tasks));

// Strip defaults for PATCH: omitted fields must stay omitted, never clear existing work.
const editableSchema = z.object({
  title: taskSchema.shape.title, description: taskSchema.shape.description.removeDefault(),
  kind: taskSchema.shape.kind.removeDefault(), enabled: z.boolean(),
  acceptance_criteria: taskSchema.shape.acceptance_criteria.removeDefault(),
  depends_on: taskSchema.shape.depends_on.removeDefault(), max_retries: taskSchema.shape.max_retries.removeDefault(),
}).strict();
export const taskCreateSchema = editableSchema.partial().extend({ title: taskSchema.shape.title }).strict();
const editSchema = z.object({ expected_version: z.string().length(64), changes: editableSchema.partial() }).strict();
const versionSchema = z.object({ expected_version: z.string().length(64) }).strict();
const moveSchema = z.object({ expected_board_version: z.string().length(64), direction: z.enum(['up', 'down']) }).strict();

const audit = (text: string): MemoryEntry => ({ section: 'Live System Logs', text: `- ${new Date().toISOString()} operator: ${text}` });
const locate = (tasks: FactoryTask[], id: string) => {
  const task = tasks.find(item => item.id === id);
  if (!task) throw new OperatorError('Task not found.', 404);
  return task;
};
function checkVersion(task: FactoryTask, expected: string): void {
  if (taskVersion(task) !== expected) throw new OperatorError('This task changed since the form was opened. Reload it before saving; your draft has not been overwritten.');
}

export async function createTask(root: string, input: unknown): Promise<FactoryTask> {
  const fields = taskCreateSchema.parse(input);
  const config = await readConfig(root);
  let created: FactoryTask | undefined;
  await updateBoard(root, tasks => {
    if (tasks.length >= config.maxBacklogSize) throw new OperatorError('Backlog size limit reached.');
    if ((fields.max_retries ?? config.maxRetries) > config.maxRetries) throw new OperatorError('Task retries cannot exceed the configured factory limit.', 400);
    created = taskSchema.parse({ ...newTask(tasks, fields.title, config.maxRetries), enabled: false, ...fields });
    return { tasks: [...tasks, created], entries: [audit(`created ${created.id}${created.enabled ? ' and enabled automation' : ' (disabled draft)'}.`)] };
  });
  return created!;
}

export async function editTask(root: string, id: string, input: unknown): Promise<void> {
  const { expected_version, changes } = editSchema.parse(input);
  const config = await readConfig(root);
  await updateBoard(root, tasks => {
    const task = locate(tasks, id);
    checkVersion(task, expected_version);
    if (!['Todo', 'Blocked'].includes(task.status)) throw new OperatorError('Only queued or blocked tasks can be edited. Stop and replan active work first.');
    if ((changes.max_retries ?? task.max_retries) > config.maxRetries) throw new OperatorError('Task retries cannot exceed the configured factory limit.', 400);
    return { tasks: tasks.map(item => item.id === id ? taskSchema.parse({ ...item, ...changes }) : item), entries: [audit(`edited ${id}; status and approvals were not bypassed.`)] };
  });
}

export async function moveTask(root: string, id: string, input: unknown): Promise<void> {
  const { direction, expected_board_version } = moveSchema.parse(input);
  await updateBoard(root, tasks => {
    if (boardVersion(tasks) !== expected_board_version) throw new OperatorError('The queue changed. Refresh it before reordering.');
    if (locate(tasks, id).status !== 'Todo') throw new OperatorError('Only queued tasks can be reordered.');
    const index = tasks.findIndex(task => task.id === id);
    const neighbor = index + (direction === 'up' ? -1 : 1);
    if (neighbor >= 0 && neighbor < tasks.length) [tasks[index], tasks[neighbor]] = [tasks[neighbor], tasks[index]];
    return { tasks, entries: [audit(`moved ${id} ${direction} in the queue.`)] };
  });
}

export async function replanTask(root: string, id: string, input: unknown, resetBlocked = false): Promise<void> {
  const { expected_version } = versionSchema.parse(input);
  const config = await readConfig(root);
  await updateBoard(root, tasks => {
    const task = locate(tasks, id);
    checkVersion(task, expected_version);
    // The lock spans a whole runner lifetime: a pause is not proof its active stage finished.
    if (existsSync(runtimePath(root, 'runner.lock')) || existsSync(runtimePath(root, 'child.json'))) throw new OperatorError('Stop the worker and wait for it to exit before replanning or retrying work.');
    if (resetBlocked ? task.status !== 'Blocked' : task.status !== 'In_Progress') throw new OperatorError(resetBlocked ? 'Only a reviewed Blocked task can be retried.' : 'Only active work needs replanning.');
    if (!resetBlocked && (task.retry_count >= Math.min(task.max_retries, config.maxRetries) || task.step_count >= config.maxStepsPerTask)) throw new OperatorError('This task has exhausted its repair/stage budget. Review it rather than bypassing the limit.');
    const updated: FactoryTask = {
      ...task, status: 'Todo', assigned_to: 'pm', phase: 'plan', enabled: true,
      retry_count: resetBlocked ? 0 : task.retry_count + 1,
      step_count: resetBlocked ? 0 : task.step_count,
      contract: '', approvals: [], verification: undefined, last_error: undefined,
    };
    return { tasks: tasks.map(item => item.id === id ? updated : item), entries: [audit(`${resetBlocked ? 'explicitly reviewed and requeued' : 'requested replanning for'} ${id}; design approvals and QA evidence cleared${resetBlocked ? ', repair/stage budgets reset' : ', one repair consumed'}.`)] };
  });
}

export const controlSchema = z.object({ action: z.enum(['start', 'pause', 'resume', 'stop']) }).strict();
export async function controlWorker(root: string, input: unknown): Promise<string> {
  const { action } = controlSchema.parse(input);
  await mkdir(runtimePath(root), { recursive: true });
  switch (action) {
    case 'start': return `Worker started (PID ${await startWorker(root)}). An existing pause remains in effect until Resume.`;
    case 'pause': await atomicWrite(runtimePath(root, 'PAUSED.txt'), 'Operator pause. Current stage may finish; no new stage starts.'); return 'Pause requested. The active stage can finish.';
    case 'resume': await rm(runtimePath(root, 'PAUSED.txt'), { force: true }); return 'Pause cleared. Start the worker separately if stopped.';
    case 'stop': await atomicWrite(runtimePath(root, 'STOP'), 'Operator requested stop.'); return 'Stop requested. Active subprocesses will exit; partial changes are preserved.';
  }
}