import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTask } from './core';
import { startDashboard } from './server';
import { resolveRunFile } from './status';

let root: string;
let dashboard: Awaited<ReturnType<typeof startDashboard>>;
let token: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'factory-dashboard-api-'));
  await mkdir(join(root, '.factory', 'runs', 'TASK-001-001-123'), { recursive: true });
  await writeFile(join(root, 'factory.config.json'), '{}');
  await writeFile(join(root, 'tasks.json'), JSON.stringify([newTask([], 'Queued item', 3)]));
  await writeFile(join(root, 'MEMORY.md'), '# Memory\n## Live System Logs\nReady\n');
  dashboard = await startDashboard({ root, port: 0, intervalMs: 50 });
  token = (await (await fetch(`${dashboard.origin}/api/session`)).json() as { csrf_token: string }).csrf_token;
});
afterEach(async () => { await dashboard.close(); await rm(root, { recursive: true, force: true }); });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${dashboard.origin}${path}`, {
  method: 'POST', headers: { Origin: dashboard.origin, 'Content-Type': 'application/json', 'X-Factory-Token': token, ...headers }, body: JSON.stringify(body),
});

describe('loopback dashboard API', () => {
  it('serves the themed UI with a CSP and sanitized snapshots', async () => {
    const response = await fetch(dashboard.origin);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toContain('--cp-accent');
    const snapshot = await (await fetch(`${dashboard.origin}/api/status`)).json() as { tasks: { id: string }[] };
    expect(snapshot.tasks[0].id).toBe('TASK-001');
    expect((await fetch(`${dashboard.origin}/client.js`)).status).toBe(200);
  });

  it('rejects cross-origin mutation, absent CSRF, and DNS-rebinding Host headers', async () => {
    expect((await post('/api/tasks', { title: 'Forbidden' }, { Origin: 'https://attacker.invalid' })).status).toBe(403);
    expect((await post('/api/tasks', { title: 'Forbidden' }, { 'X-Factory-Token': 'wrong' })).status).toBe(403);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(dashboard.origin, { headers: { Host: 'attacker.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    expect(status).toBe(403);
    expect(JSON.parse(await readFile(join(root, 'tasks.json'), 'utf8'))).toHaveLength(1);
  });

  it('creates tasks and notes through validated routes, and rejects malformed or oversized input', async () => {
    expect((await post('/api/tasks', { title: 'New task' })).status).toBe(201);
    expect((await post('/api/notes', { task_id: 'TASK-001', text: 'A saved note.' })).status).toBe(201);
    expect((await post('/api/tasks', { title: '', status: 'Done' })).status).toBe(400);
    expect((await post('/api/control', { action: 'deploy' })).status).toBe(400);
    expect((await post('/api/notes', { task_id: null, text: 'x'.repeat(140 * 1024) })).status).toBe(413);
    expect((await post('/api/tasks', { title: 'Unsupported encoding' }, { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('streams live snapshots and changes after a task is added', async () => {
    const controller = new AbortController();
    const response = await fetch(`${dashboard.origin}/api/events`, { signal: controller.signal });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');
    await post('/api/tasks', { title: 'Appears live' });
    let found = false;
    for (let index = 0; index < 10 && !found; index++) found = new TextDecoder().decode((await reader.read()).value).includes('Appears live');
    expect(found).toBe(true);
    controller.abort();
  });

  it('does not expose arbitrary local files or symlink escapes as evidence', async () => {
    expect((await fetch(`${dashboard.origin}/api/artifact?path=../../package.json`)).status).toBe(403);
    expect((await fetch(`${dashboard.origin}/.factory/doctor-probe.jsonl`)).status).toBe(404);
    await expect(resolveRunFile(root, '.factory/runs/TASK-001-001-123/../../state.json')).rejects.toThrow('Invalid artifact');
    await mkdir(join(root, 'outside'));
    await writeFile(join(root, 'outside', 'secret.log'), 'not evidence');
    await symlink(join(root, 'outside'), join(root, '.factory', 'runs', 'TASK-001-001-123', 'escape'), 'junction');
    await expect(resolveRunFile(root, '.factory/runs/TASK-001-001-123/escape/secret.log')).rejects.toThrow('outside');
  });
});