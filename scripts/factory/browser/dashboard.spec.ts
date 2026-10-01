import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboard } from '../server';
import { newTask } from '../core';
import { addNote } from '../notes';
import { editTask, taskVersion } from '../operator';
import { readBoard } from '../runtime';

let root: string;
let dashboard: Awaited<ReturnType<typeof startDashboard>>;
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'factory-ui-browser-'));
  await mkdir(join(root, '.factory'));
  await writeFile(join(root, 'factory.config.json'), '{}');
  await writeFile(join(root, 'tasks.json'), JSON.stringify([{ ...newTask([], 'Keyboard navigation in walking mode', 3), enabled: false }]));
  await writeFile(join(root, 'MEMORY.md'), '## Live System Logs\nReady\n');
  dashboard = await startDashboard({ root, port: 0, intervalMs: 150 });
});
test.afterEach(async () => { await dashboard.close(); await rm(root, { recursive: true, force: true }); });

test('live dashboard edits tasks, adds notes, controls pause, and fits the viewport', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(dashboard.origin);
  await expect(page.getByRole('heading', { name: 'Software factory', exact: true })).toBeVisible();
  await expect(page.locator('#connection')).toContainText('Live');
  await page.getByText('Edit task', { exact: true }).click();
  await page.locator('#edit-form').getByLabel('Description', { exact: true }).fill('Keep the navigation accessible in Hebrew.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#description')).toHaveText('Keep the navigation accessible in Hebrew.');
  await page.getByLabel('Your note', { exact: true }).fill('Use Page Up and Page Down for vertical movement.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('#notes')).toContainText('Use Page Up and Page Down');
  expect(JSON.parse(await readFile(join(root, '.factory', 'operator-notes.json'), 'utf8'))).toHaveLength(1);

  await page.getByRole('button', { name: '+ New task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('בדיקת מקלדת <img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await expect(page.locator('#selected-title')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#selected-title img')).toHaveCount(0);
  expect((await readBoard(root))[1].enabled).toBe(false);
  await addNote(root, { task_id: null, text: 'New global note arrives live.' });
  await expect(page.locator('#notes')).toContainText('New global note arrives live.');

  // Simulate a live worker in this isolated fixture; controls never touch the real worker.
  await writeFile(join(root, '.factory', 'state.json'), JSON.stringify({ pid: process.pid, stopped: false, heartbeat: new Date().toISOString(), started: new Date().toISOString() }));
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#worker-state')).toHaveText('paused');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#worker-state')).toHaveText('running');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });
  expect(errors).toEqual([]);
});

test('live refresh preserves drafts and prevents stale-tab overwrites', async ({ page }) => {
  await page.goto(dashboard.origin);
  await expect(page.locator('#connection')).toContainText('Live');
  await page.getByText('Edit task', { exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('My unsaved draft');
  await page.getByLabel('Your note', { exact: true }).fill('My unsent note');
  const [task] = await readBoard(root);
  await editTask(root, task.id, { expected_version: taskVersion(task), changes: { title: 'Changed in another tab' } });
  await expect(page.locator('#selected-title')).toHaveText('Changed in another tab');
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('My unsaved draft');
  await expect(page.getByLabel('Your note', { exact: true })).toHaveValue('My unsent note');
  await expect(page.locator('#draft-warning')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reload task', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Changed in another tab');
  await page.getByLabel('Your note', { exact: true }).fill('');
});

test('active tasks cannot be edited or forced Done and show live public tool events', async ({ page }) => {
  const [task] = await readBoard(root);
  await writeFile(join(root, 'tasks.json'), JSON.stringify([{ ...task, status: 'In_Progress', assigned_to: 'architect', step_count: 2 }]));
  const run = join(root, '.factory', 'runs', 'TASK-001-002-123');
  await mkdir(run, { recursive: true });
  await writeFile(join(run, 'copilot.jsonl'), JSON.stringify({ type: 'tool.execution_start', timestamp: new Date().toISOString(), data: { toolName: 'view', arguments: { secret: 'NOT_FOR_UI' } } }) + '\n');
  await page.goto(dashboard.origin);
  await expect(page.locator('#active-role')).toHaveText('architect');
  await expect(page.locator('#activity')).toContainText('Using view');
  await expect(page.locator('body')).not.toContainText('NOT_FOR_UI');
  await page.getByText('Edit task', { exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /force done/i })).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Replan task', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeEnabled();
  expect((await readBoard(root))[0].assigned_to).toBe('pm');
});

test('reconnects after a dashboard restart and refreshes its write session', async ({ page }) => {
  await page.goto(dashboard.origin);
  await expect(page.locator('#connection')).toContainText('Live');
  const port = Number(new URL(dashboard.origin).port);
  await dashboard.close();
  await expect(page.locator('#connection')).toContainText('Disconnected');
  dashboard = await startDashboard({ root, port, intervalMs: 150 });
  await expect(page.locator('#connection')).toContainText('Live', { timeout: 15_000 });
  await page.getByLabel('Your note', { exact: true }).fill('Saved after reconnect.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('#notes')).toContainText('Saved after reconnect.');
  await expect(page.locator('#error')).toBeHidden();
  const board = await readFile(join(root, 'tasks.json'), 'utf8');
  await writeFile(join(root, 'tasks.json'), 'temporarily invalid');
  await expect(page.locator('#connection')).toContainText('State unavailable');
  await expect(page.getByRole('button', { name: '+ New task', exact: true })).toBeDisabled();
  await writeFile(join(root, 'tasks.json'), board);
  await expect(page.locator('#connection')).toContainText('Live');
  await expect(page.getByRole('button', { name: '+ New task', exact: true })).toBeEnabled();
});