import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTask } from './core';
import { addNote, notesForTask, readNotes } from './notes';
import { boardVersion, controlWorker, createTask, editTask, moveTask, replanTask, taskVersion } from './operator';
import { readBoard } from './runtime';
import { formatLive } from './live';
import { displayText, getSnapshot, parseActivity } from './status';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'factory-operator-'));
  await mkdir(join(root, '.factory'));
  await writeFile(join(root, 'factory.config.json'), '{}');
  await writeFile(join(root, 'tasks.json'), JSON.stringify([newTask([], 'Existing task', 3)]));
  await writeFile(join(root, 'MEMORY.md'), '# Memory\n## Live System Logs\nReady\n');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('operator task control', () => {
  it('creates a disabled draft by default and preserves untouched fields on PATCH', async () => {
    const created = await createTask(root, { title: 'New draft', description: 'Keep this', kind: 'bug', acceptance_criteria: ['Important behavior'] });
    expect(created.enabled).toBe(false);
    await editTask(root, created.id, { expected_version: taskVersion(created), changes: { title: 'Updated title' } });
    const task = (await readBoard(root))[1];
    expect(task.description).toBe('Keep this');
    expect(task.kind).toBe('bug');
    expect(task.acceptance_criteria).toEqual(['Important behavior']);
    expect(task.enabled).toBe(false);
  });

  it('rejects stale updates, unknown fields, invalid dependencies, and forced Done', async () => {
    const [task] = await readBoard(root);
    await editTask(root, task.id, { expected_version: taskVersion(task), changes: { description: 'Saved by another tab' } });
    await expect(editTask(root, task.id, { expected_version: taskVersion(task), changes: { title: 'Stale draft' } })).rejects.toThrow('changed');
    const [updated] = await readBoard(root);
    await expect(editTask(root, task.id, { expected_version: taskVersion(updated), changes: { status: 'Done' } })).rejects.toThrow();
    await expect(editTask(root, task.id, { expected_version: taskVersion(updated), changes: { depends_on: ['TASK-404'] } })).rejects.toThrow('Unknown dependency');
    await expect(createTask(root, { title: 'Too many retries', max_retries: 9 })).rejects.toThrow('configured factory limit');
    expect((await readBoard(root))[0].description).toBe('Saved by another tab');
  });

  it('requires stopping and replanning before editing active requirements', async () => {
    const [fresh] = await readBoard(root);
    const task = { ...fresh, status: 'In_Progress' as const, assigned_to: 'engineer' as const, contract: 'Old contract', approvals: ['plan' as const], step_count: 6 };
    await writeFile(join(root, 'tasks.json'), JSON.stringify([task]));
    await expect(editTask(root, task.id, { expected_version: taskVersion(task), changes: { title: 'New scope' } })).rejects.toThrow(/stop and replan/i);
    await mkdir(join(root, '.factory', 'runner.lock'));
    await expect(replanTask(root, task.id, { expected_version: taskVersion(task) })).rejects.toThrow('Stop the worker');
    await rm(join(root, '.factory', 'runner.lock'), { recursive: true });
    await replanTask(root, task.id, { expected_version: taskVersion(task) });
    const [replanned] = await readBoard(root);
    expect(replanned.status).toBe('Todo');
    expect(replanned.assigned_to).toBe('pm');
    expect(replanned.approvals).toEqual([]);
    expect(replanned.retry_count).toBe(1);
    expect(replanned.step_count).toBe(6);
  });

  it('reorders queued work under optimistic concurrency without bypassing the active task', async () => {
    const second = await createTask(root, { title: 'Second', enabled: true });
    const board = await readBoard(root);
    await moveTask(root, second.id, { expected_board_version: boardVersion(board), direction: 'up' });
    expect((await readBoard(root))[0].id).toBe(second.id);
    await expect(moveTask(root, second.id, { expected_board_version: boardVersion(board), direction: 'down' })).rejects.toThrow('queue changed');
  });

  it('adds concurrent notes without modifying active task state, and supports global notes', async () => {
    const before = await readFile(join(root, 'tasks.json'), 'utf8');
    await Promise.all(['First note', 'Second note'].map(text => addNote(root, { task_id: 'TASK-001', text })));
    const global = await addNote(root, { task_id: null, text: 'Preserve Hebrew RTL support.' });
    const notes = await readNotes(root);
    expect(notes).toHaveLength(3);
    expect(notesForTask(notes, 'TASK-002')).toEqual([global]);
    expect(await readFile(join(root, 'tasks.json'), 'utf8')).toBe(before);
    await expect(addNote(root, { task_id: 'TASK-404', text: 'Unknown' })).rejects.toThrow('Unknown task');
    await expect(addNote(root, { task_id: null, text: ' ' })).rejects.toThrow();
    const repeated = await addNote(root, { id: global.id, task_id: null, text: global.text });
    expect(repeated.id).toBe(global.id);
    expect(await readNotes(root)).toHaveLength(3);
  });

  it('provides fixed pause/resume/stop controls, not arbitrary commands', async () => {
    await controlWorker(root, { action: 'pause' });
    expect((await getSnapshot(root)).worker.pause_reason).toContain('Operator pause');
    await controlWorker(root, { action: 'resume' });
    expect((await getSnapshot(root)).worker.pause_reason).toBe('');
    await controlWorker(root, { action: 'stop' });
    expect(await readFile(join(root, '.factory', 'STOP'), 'utf8')).toContain('stop');
    await expect(controlWorker(root, { action: 'shell', command: 'anything' })).rejects.toThrow();
  });
});

describe('public live monitoring', () => {
  it('does not show raw prompts, tool arguments/results, or private reasoning', () => {
    const events = [
      { type: 'assistant.reasoning', data: { content: 'PRIVATE' } },
      { type: 'assistant.message', data: { content: 'PRIVATE' } },
      { type: 'tool.execution_start', timestamp: '2026-09-07T12:00:00Z', data: { toolName: 'view', arguments: { path: 'PRIVATE' } } },
      { type: 'tool.execution_complete', data: { success: false, result: { content: 'PRIVATE' } } },
      { type: 'result', exitCode: 0 },
    ];
    const activity = parseActivity(events.map(event => JSON.stringify(event)).join('\n'));
    expect(activity.map(event => event.text)).toEqual(['Using view', 'Tool reported a failure', 'Agent session finished']);
    expect(JSON.stringify(activity)).not.toContain('PRIVATE');
    expect(displayText('\x1b[31mHello\x1b[0m\x1b]2;title\x07')).not.toContain('\x1b');
  });

  it('handles an idle factory and renders bounded terminal lines with no state mutation', async () => {
    const before = await readFile(join(root, 'tasks.json'), 'utf8');
    const snapshot = await getSnapshot(root);
    const view = formatLive(snapshot, 80, 30);
    expect(snapshot.worker.running).toBe(false);
    expect(view).toContain('Ctrl+C closes this monitor only');
    expect(view.split('\n').every(line => Array.from(line).length <= 78)).toBe(true);
    expect(await readFile(join(root, 'tasks.json'), 'utf8')).toBe(before);
  });
});