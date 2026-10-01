import { expect, test, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

// Browser tests must not import the Vite-only plan image dependency graph.
const PROJECT_STORAGE_KEY = 'dori-solar-studio-v1';
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROJECT_STORAGE_KEY);
const toolbar = (page: Page) => page.locator('.topbar');
const undo = (page: Page) => toolbar(page).getByRole('button', { name: 'ביטול פעולה', exact: true });
const redo = (page: Page) => toolbar(page).getByRole('button', { name: 'ביצוע מחדש', exact: true });
const openHistory = async (page: Page) => {
  await toolbar(page).getByRole('button', { name: 'היסטוריית פעולות', exact: true }).click();
  return page.getByRole('dialog', { name: 'היסטוריית פעולות', exact: true });
};
const command = async (page: Page, text: string) => {
  await page.getByRole('textbox', { name: 'פקודה לעדכון המודל' }).fill(text);
  await page.getByRole('button', { name: 'ביצוע הפקודה', exact: true }).click();
};

test('history traverses edits, branches, resets and imports; restored model persists', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  const initial = await saved(page);
  const empty = await openHistory(page);
  await expect(empty.getByText('אין פעולות עדיין.', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar(page).getByRole('button', { name: 'היסטוריית פעולות', exact: true })).toBeFocused();

  await command(page, 'גובה קומת קרקע 4.2 ביחידה א');
  await expect.poll(async () => (await saved(page)).buildings.north.groundHeight).toBe(4.2);
  await command(page, 'גובה שכן מזרח 12');
  await expect.poll(async () => (await saved(page)).neighbors.find(item => item.id === 'east')?.height).toBe(12);
  await undo(page).click();
  await expect.poll(async () => (await saved(page)).neighbors).toEqual(initial.neighbors);
  await page.keyboard.press('Control+z');
  await expect.poll(() => saved(page)).toEqual(initial);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await saved(page)).buildings.north.groundHeight).toBe(4.2);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await saved(page)).neighbors.find(item => item.id === 'east')?.height).toBe(12);

  const dialog = await openHistory(page);
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'שחזור שלב 0:', exact: false }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
  await expect(dialog.locator('[aria-current="step"]')).toContainText('מצב התחלתי');
  await dialog.getByRole('button', { name: 'שחזור שלב 2:', exact: false }).click();
  await expect.poll(async () => (await saved(page)).neighbors.find(item => item.id === 'east')?.height).toBe(12);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-action-history.png`), fullPage: true });
  await dialog.getByRole('button', { name: 'שחזור שלב 1:', exact: false }).click();
  await dialog.getByRole('button', { name: 'סגירת היסטוריה' }).click();
  await command(page, 'אין פקודה כזו');
  await expect(redo(page)).toBeEnabled();
  await command(page, 'גובה שכן מערב 13');
  await expect(redo(page)).toBeDisabled();
  const branched = await saved(page);

  await toolbar(page).getByRole('button', { name: 'איפוס', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings.north.groundHeight).not.toBe(4.2);
  await undo(page).click();
  await expect.poll(() => saved(page)).toEqual(branched);

  const file = page.locator('.toolbar input[type=file]');
  await file.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('.notice')).not.toContainText('יובאו ונשמרו בהצלחה');
  await expect.poll(() => saved(page)).toEqual(branched);
  await expect(redo(page)).toBeEnabled();
  const imported = { ...branched, minutes: branched.minutes === 620 ? 630 : 620 };
  await file.setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect.poll(() => saved(page)).toEqual(imported);
  await expect(redo(page)).toBeDisabled();
  await undo(page).click();
  await expect.poll(() => saved(page)).toEqual(branched);
  await redo(page).click();
  await expect.poll(() => saved(page)).toEqual(imported);
  await page.reload();
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  await expect.poll(() => saved(page)).toEqual(imported);
  expect(errors).toEqual([]);
});

test('continuous inspector edits are one action; native editing and view selection do not consume undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  const number = page.getByRole('spinbutton', { name: /גובה קומת קרקע.*ערך מספרי/ }).first();
  const original = await number.inputValue();
  await number.fill('4');
  await number.fill('4.1');
  await number.fill('4.3');
  await number.press('Tab');
  const dialog = await openHistory(page);
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await undo(page).click();
  await expect(number).toHaveValue(original);
  await redo(page).click();
  await expect(number).toHaveValue('4.3');

  const current = await saved(page);
  const input = page.getByRole('textbox', { name: 'פקודה לעדכון המודל' });
  await input.focus();
  await input.pressSequentially('draft');
  await input.press('Control+z');
  await expect.poll(() => saved(page)).toEqual(current);
  // Check that global handlers do not prevent native editable events, including IME.
  const prevented = await input.evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.getByRole('tab', { name: 'שמש', exact: true }).click();
  await expect(redo(page)).toBeDisabled();
  await undo(page).click();
  await expect.poll(async () => (await saved(page)).buildings.north.groundHeight).toBe(Number(original));
});

test('2D gestures share the stack across closing and reopening the editor', async ({ page }, testInfo) => {
  await page.goto('/');
  await command(page, 'גובה שכן מזרח 12');
  const beforeDrag = await saved(page);
  await toolbar(page).getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית' });
  const wall = editor.locator('.editor-wall').first();
  // Real pointer events in both viewports exercise capture/move/end grouping.
  const box = await wall.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).design).toEqual(beforeDrag.design);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 32, y + 24, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).design).not.toEqual(beforeDrag.design);
  const afterDrag = await saved(page);
  await editor.getByRole('button', { name: 'היסטוריית פעולות', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'היסטוריית פעולות', exact: true });
  await expect(dialog.getByRole('listitem')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-2d-history.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(beforeDrag);
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
  await redo(page).click();
  await expect.poll(() => saved(page)).toEqual(afterDrag);
  await toolbar(page).getByRole('button', { name: 'עורך 2D', exact: true }).click();
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(beforeDrag);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).neighbors.find(item => item.id === 'east')?.height).not.toBe(12);
});

test('history controls fit narrow RTL screens and dialog keyboard focus stays contained', async ({ page }, testInfo) => {
  await page.goto('/');
  for (const width of [393, 360]) {
    await page.setViewportSize({ width, height: 851 });
    for (const button of await toolbar(page).getByRole('button').all()) {
      const rect = await button.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    }
    const dialog = await openHistory(page);
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    const rect = await dialog.boundingBox();
    expect(rect!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-history-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});