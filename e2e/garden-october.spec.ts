import { expect, test, type Page } from '@playwright/test';

const storageKey = 'dori-home-v2-design-library';
const saved = (page: Page) => page.evaluate(key => {
  const library = JSON.parse(localStorage.getItem(key)!);
  return library.options.find((option: { id: string }) => option.id === library.activeId).project;
}, storageKey);
async function seed(page: Page) {
  await page.goto('/?clawpilotTheme=light&plan=october-2026#v2');
  await expect(page.locator('.showroom-option-name')).toHaveText('קומת קרקע · 08.10.2026');
  await expect(page.locator('.asset-status')).toContainText('מוכנים');
}
async function moveUntil(page: Page, key: string, predicate: () => Promise<boolean>, maxSteps = 75) {
  await page.locator('.viewer canvas').focus();
  const session = await page.context().newCDPSession(page), keyCode = key === 'ArrowUp' ? 38 : 40;
  try {
    for (let i = 0; i < maxSteps; i += 5) {
      if (await predicate()) return;
      // Keep real trusted input ordered, without a round trip and layout read per 8cm tap.
      const events = Array.from({ length: Math.min(5, maxSteps - i) }, () => [
        session.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode }),
        session.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode }),
      ]).flat();
      await Promise.all(events);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    }
    expect(await predicate(), `Walking with ${key} must reach the destination`).toBe(true);
  } finally { await session.detach(); }
}
async function planCoordinate(page: Page, coordinate: 'data-x' | 'data-z') {
  return Number(await page.getByTestId('visitor-marker').getAttribute(coordinate));
}

test('supplied PDF creates an independent named option and reopening it preserves edits', async ({ page }, info) => {
  await page.goto('/?clawpilotTheme=light#v2');
  await expect(page.locator('.showroom-save')).toContainText('נשמר');
  const original = await saved(page);
  await page.getByRole('button', { name: /^חלופות/ }).click();
  await page.getByRole('button', { name: 'פתיחת חלופת 8 באוקטובר', exact: true }).click();
  await expect(page.locator('.showroom-option-name')).toHaveText('קומת קרקע · 08.10.2026');
  const library = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(library.options).toHaveLength(2);
  expect(library.options[0].project).toEqual(original);
  expect(library.options[1].project.design.groundPlan).toBe('october-2026');
  await page.getByRole('button', { name: 'עריכת 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await expect(editor.locator('.cad-canvas image')).toHaveCount(1);
  await expect(editor.locator('[data-object-id="october-ground-1-north"]')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('october-ground-plan.png'), fullPage: true });
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: /^חלופות/ }).click();
  await page.getByRole('button', { name: 'פתיחת חלופת 8 באוקטובר', exact: true }).click();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).options.length, storageKey)).toBe(2);
});

test('walks from the garden through a closed glazing after F, then exits, closes and persists it', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await page.getByRole('button', { name: 'סיור בגינה', exact: true }).click();
  await expect(page.locator('.showroom-live')).toContainText('גינה וחוץ');
  await expect(page.locator('.walk-minimap')).toContainText('גינה וחוץ');
  const initialView = await page.getByTestId('walk-minimap').getAttribute('viewBox');
  await moveUntil(page, 'ArrowUp', async () => await page.locator('.door-prompt').isVisible());
  const prompt = page.locator('.door-prompt'), openingId = await prompt.getAttribute('data-opening-id');
  await expect(prompt).toHaveAttribute('data-open', 'false');
  await page.locator('.viewer canvas').focus(); await page.keyboard.press('f');
  await expect.poll(async () => (await saved(page)).openings[openingId!]?.open).toBe(true);
  await expect(prompt).toHaveAttribute('data-open', 'true');
  await moveUntil(page, 'ArrowUp', async () => await planCoordinate(page, 'data-z') > .5);
  await expect(page.locator('.showroom-live')).toContainText('קומת קרקע');
  expect(await page.getByTestId('walk-minimap').getAttribute('viewBox')).not.toBe(initialView);
  await moveUntil(page, 'ArrowDown', async () => await planCoordinate(page, 'data-z') < -.6);
  await expect(page.locator('.showroom-live')).toContainText('גינה וחוץ');
  await prompt.click();
  await expect.poll(async () => (await saved(page)).openings[openingId!]?.open).toBe(false);
  await page.screenshot({ path: info.outputPath('garden-door-closed.png'), fullPage: true });
  await page.reload();
  expect((await saved(page)).openings[openingId!].open).toBe(false);
  expect(errors).toEqual([]);
});

test('plants and trees are editable independent records, stay deleted, and preserve keyboard input', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page);
  await page.getByRole('button', { name: 'צמחייה', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'גינה וצמחייה', exact: true });
  await expect(dialog.locator('[data-landscape-id]')).toHaveCount(3);
  await dialog.getByLabel('סוג צמח להוספה', { exact: true }).selectOption('olive-tree');
  await dialog.getByRole('button', { name: 'הוספת עץ זית', exact: true }).click();
  const added = (await saved(page)).design.landscape.at(-1);
  expect(added.kind).toBe('olive-tree');
  await dialog.getByLabel(/^מיקום צמח X/).fill('5.5');
  await dialog.getByLabel(/^מיקום צמח Z/).fill('-6');
  await dialog.getByLabel(/^גובה צמח/).fill('4.1');
  await dialog.getByLabel(/^רוחב צמח/).fill('2.8');
  await dialog.getByLabel('סיבוב צמח', { exact: true }).fill('35');
  await dialog.getByRole('button', { name: 'החלת שינוי בצמח', exact: true }).click();
  const item = (await saved(page)).design.landscape.find((item: { id: string }) => item.id === added.id);
  expect(item).toMatchObject({ center: [5.5, -6], height: 4.1, spread: 2.8, rotation: 35 });
  await dialog.getByLabel(/^גובה צמח/).fill('0');
  await dialog.getByRole('button', { name: 'החלת שינוי בצמח', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await saved(page)).design.landscape.find((item: { id: string }) => item.id === added.id).height).toBe(4.1);
  await dialog.getByRole('button', { name: 'מחיקת הצמח', exact: true }).click();
  await expect(dialog.locator(`[data-landscape-id="${added.id}"]`)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(dialog.locator(`[data-landscape-id="${added.id}"]`)).toHaveCount(1);
  await dialog.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect(dialog.locator(`[data-landscape-id="${added.id}"]`)).toHaveCount(0);
  await dialog.getByLabel('סוג צמח להוספה', { exact: true }).selectOption('potted-plant');
  await dialog.getByRole('button', { name: 'הוספת עציץ עלים', exact: true }).click();
  const pot = (await saved(page)).design.landscape.at(-1);
  expect(pot.kind).toBe('potted-plant');
  await dialog.getByRole('button', { name: 'מחיקת הצמח', exact: true }).click();
  expect((await saved(page)).design.landscape.some((item: { id: string }) => item.id === pot.id)).toBe(false);
  await page.screenshot({ path: info.outputPath('editable-garden.png'), fullPage: true });
  await dialog.getByRole('button', { name: 'סגירת גינה וצמחייה', exact: true }).click();
  await page.reload();
  expect((await saved(page)).design.landscape.some((item: { id: string }) => item.id === added.id)).toBe(false);
  await page.getByRole('button', { name: 'צמחייה', exact: true }).click();
  await expect(dialog.locator('[data-landscape-id]')).toHaveCount(3);
  expect(errors).toEqual([]);
});
