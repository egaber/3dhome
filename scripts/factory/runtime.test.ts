import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configSchema, newTask } from './core';
import { appendMemory, atomicWrite, copilotArgs, hash, Interrupted, isProtected, readBoard, runProcess, updateBoard } from './runtime';
import { importBacklog } from './worker';

const config = configSchema.parse({});
const memory = '# Shared state\n\n## Architectural Contracts\n\nNone.\n\n## UX/UI Notes\n\nNone.\n\n## Live System Logs\n\nReady.\n';
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'house-factory-test-'));
  await mkdir(join(root, '.factory'));
  await writeFile(join(root, 'tasks.json'), '[]\n');
  await writeFile(join(root, 'MEMORY.md'), memory);
  await writeFile(join(root, 'BACKLOG.md'), '# Inbox\n');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('shared state durability', () => {
  it('atomically replaces files and inserts memory into the correct section', async () => {
    await atomicWrite(join(root, 'example.txt'), 'complete');
    expect(await readFile(join(root, 'example.txt'), 'utf8')).toBe('complete');
    const changed = appendMemory(memory, { section: 'Architectural Contracts', text: 'TASK-001 interface.' });
    expect(changed.indexOf('TASK-001')).toBeLessThan(changed.indexOf('## UX/UI Notes'));
    expect(changed).toContain('## Live System Logs');
  });

  it('serializes independent writers without dropping backlog additions', async () => {
    await Promise.all(['First', 'Second', 'Third'].map(title => updateBoard(root, tasks => ({ tasks: [...tasks, newTask(tasks, title, 3)] }))));
    expect(await readBoard(root)).toHaveLength(3);
    expect(existsSync(join(root, '.factory', 'transaction.json'))).toBe(false);
  });

  it('replays a crash between board and memory replacement', async () => {
    const board = JSON.stringify([newTask([], 'Recovered item', 3)]);
    const updatedMemory = appendMemory(memory, { section: 'Live System Logs', text: 'Recovered exactly once.' });
    await writeFile(join(root, '.factory', 'transaction.json'), JSON.stringify({ beforeBoardHash: hash('[]\n'), beforeMemoryHash: hash(memory), board, memory: updatedMemory }));
    await writeFile(join(root, 'tasks.json'), board); // Simulate first replacement already completed.
    await updateBoard(root, tasks => ({ tasks }));
    await updateBoard(root, tasks => ({ tasks }));
    expect(await readBoard(root)).toHaveLength(1);
    expect((await readFile(join(root, 'MEMORY.md'), 'utf8')).match(/Recovered exactly once/g)).toHaveLength(1);
  });

  it('refuses to overwrite a recovery conflict or malformed board', async () => {
    await writeFile(join(root, '.factory', 'transaction.json'), JSON.stringify({ beforeBoardHash: hash('[]\n'), beforeMemoryHash: hash(memory), board: '[]', memory }));
    await writeFile(join(root, 'MEMORY.md'), `${memory}\nHuman edit.\n`);
    await expect(updateBoard(root, tasks => ({ tasks }))).rejects.toThrow('conflicts');
    expect(await readFile(join(root, 'MEMORY.md'), 'utf8')).toContain('Human edit');
    await rm(join(root, '.factory', 'transaction.json'));
    await writeFile(join(root, 'tasks.json'), 'not json');
    await expect(updateBoard(root, tasks => ({ tasks }))).rejects.toThrow();
    expect(await readFile(join(root, 'tasks.json'), 'utf8')).toBe('not json');
  });

  it('imports unchecked backlog titles once and does not run checked items', async () => {
    await writeFile(join(root, 'BACKLOG.md'), '# Backlog\n- [ ] Add keyboard navigation\n- [x] Already handled\n- [ ] add keyboard navigation\n');
    await importBacklog(root, config);
    await importBacklog(root, config);
    const tasks = await readBoard(root);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].assigned_to).toBe('pm');
    expect(tasks[0].source_key).toBeTruthy();
  });
});

describe('subprocess and permission boundary', () => {
  it('does not enable blanket approval, delegation, remote tools, or reviewer writes', () => {
    const args = copilotArgs('engineer', 'A title with "quotes"; not a shell command', config, ['factory.config.json']);
    expect(args).toContain('--agent');
    expect(args).toContain('--deny-tool=write(factory.config.json)');
    expect(args).toContain('--deny-tool=write(tasks.json)');
    expect(args).not.toContain('--allow-all-tools');
    expect(args).not.toContain('--allow-all-paths');
    expect(args.find(item => item.startsWith('--available-tools='))).not.toMatch(/task|github|web_fetch/);
    const reviewer = copilotArgs('skeptic', 'Review only', config, []);
    expect(reviewer).toContain('--deny-tool=write');
    expect(reviewer.find(item => item.startsWith('--available-tools='))).not.toMatch(/powershell|bash|edit/);
    expect(isProtected('scripts/factory/core.ts')).toBe(true);
    expect(isProtected('package.json')).toBe(true);
    expect(isProtected('src/components/NewFeature.tsx')).toBe(false);
  });

  it('passes hostile-looking strings as argv data, not shell code', async () => {
    const text = 'quoted "text" & echo NOT_A_COMMAND; $(not_a_command)';
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text], { root, logFile: join(root, 'process.log'), timeoutMs: 5000 });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(text);
    expect(existsSync(join(root, '.factory', 'child.json'))).toBe(false);
  });

  it('propagates failure and kills timed-out subprocesses', async () => {
    const failed = await runProcess(process.execPath, ['-e', 'process.exit(2)'], { root, logFile: join(root, 'failure.log'), timeoutMs: 5000 });
    expect(failed.code).toBe(2);
    await expect(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { root, logFile: join(root, 'timeout.log'), timeoutMs: 100 })).rejects.toThrow('timed out');
    expect(existsSync(join(root, '.factory', 'child.json'))).toBe(false);
  });

  it('stops before launching a subprocess when cancellation is already requested', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runProcess(process.execPath, ['--version'], { root, logFile: join(root, 'cancel.log'), timeoutMs: 5000, signal: controller.signal })).rejects.toBeInstanceOf(Interrupted);
  });
});