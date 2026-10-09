import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const projectKey = 'dori-solar-studio-v1';
const sessionKey = 'dori-solar-studio-session-v1';
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), projectKey);
const session = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}') as {
  selectedUnit?: string; selectedRoom?: string; camera?: { position: number[]; target: number[] };
}, sessionKey);

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    const start = performance.now();
    const frame = () => performance.now() - start > 300 ? resolve() : requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  }));
}

async function activateNorth(page: Page) {
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  await page.getByRole('combobox', { name: /חלופת קומה א׳ בבית הצפוני/ }).selectOption('bedrooms');
  await page.getByRole('button', { name: 'מדרגות מול הכניסה', exact: true }).click();
}

async function editorFor(page: Page, floor: 'ground' | 'first') {
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await editor.getByLabel('יחידה לעריכה', { exact: true }).selectOption('north');
  await editor.getByLabel('קומה לעריכה', { exact: true }).selectOption(floor);
  const expand = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות', exact: true });
  if (await expand.isVisible() && await expand.getAttribute('aria-expanded') === 'false') await expand.click();
  return editor;
}

async function closeEditor(editor: Locator) {
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
}

async function renderedColors(page: Page) {
  return page.locator('.viewer canvas').evaluate(element => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 40;
    const context = sample.getContext('2d')!;
    context.drawImage(element as HTMLCanvasElement, 0, 0, 40, 40);
    const pixels = context.getImageData(0, 0, 40, 40).data, colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return colors.size;
  });
}

test('northern bedroom variant and independent stair preset preserve other work and shared undo history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light');
  const before = await saved(page);
  await activateNorth(page);
  const configured = await saved(page);
  expect(configured.buildings.south).toEqual(before.buildings.south);
  expect(configured.design).toEqual(before.design);
  expect(configured.buildings.north).toMatchObject({ firstFloorVariant: 'bedrooms', stairRailing: true, stairOpeningGlass: true,
    stairPaths: { ground: { turn: 'right', landingAfter: 7, secondLanding: { turn: 'right', landingAfter: 11 } },
      basement: { turn: 'straight', rotation: 90, offset: [.3, .39] } } });
  const editor = await editorFor(page, 'first');
  await expect(editor.locator('.cad-furniture[data-kind="bed"]')).toHaveCount(3);
  await expect(editor.locator('.cad-furniture[data-kind="shower"]')).toHaveCount(3);
  await expect(editor.locator('.cad-furniture[data-kind="washer-dryer"]')).toHaveCount(1);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings.north.stairPaths).toBeUndefined();
  expect((await saved(page)).buildings.north.firstFloorVariant).toBe('bedrooms');
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings).toEqual(configured.buildings);
  await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('furniture:north-bedrooms-master-bed');
  await editor.getByLabel('רוחב פריט', { exact: false }).fill('1.7');
  await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['north-bedrooms-master-bed']?.width).toBe(1.7);
  await closeEditor(editor);
  await page.getByRole('combobox', { name: /חלופת קומה א׳ בבית הצפוני/ }).selectOption('original');
  const originalEditor = await editorFor(page, 'first');
  await expect(originalEditor.locator('[data-object-id="north-bedrooms-master-bed"]')).toHaveCount(0);
  await closeEditor(originalEditor);
  await page.getByRole('combobox', { name: /חלופת קומה א׳ בבית הצפוני/ }).selectOption('bedrooms');
  await page.reload();
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  const restoredEditor = await editorFor(page, 'first');
  await restoredEditor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('furniture:north-bedrooms-master-bed');
  await expect(restoredEditor.getByLabel('רוחב פריט', { exact: false })).toHaveValue('1.7');
  expect(errors).toEqual([]);
});

test('attached northern rooms and stairs render in a responsive first-floor view', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light');
  await activateNorth(page);
  const editor = await editorFor(page, 'first');
  await editor.locator('.cad-canvas').screenshot({ path: info.outputPath('north-bedrooms-plan.png') });
  await closeEditor(editor);
  await page.getByRole('button', { name: 'תוכנית משולבת', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('יחידות בתוכנית', { exact: true }).selectOption('north');
  await dialog.getByRole('button', { name: 'קומה ראשונה', exact: true }).click();
  await expect(dialog.locator('.plan-svg-subtitle')).toContainText('צפונית לפי התמונה המצורפת');
  await expect(dialog.locator('.combined-plan-notes')).toContainText('האגף הדרום־מזרחי משויך לצפונית בחלופה זו בלבד');
  await dialog.getByRole('region', { name: 'גיליון קומה ראשונה', exact: true }).getByRole('button', { name: 'תלת־ממד לקומה', exact: true }).click();
  await expect(page.locator('.notice[role="status"]')).toContainText('קומה א׳ צפונית לפי התמונה המצורפת');
  await expect(page.locator('.asset-status')).toContainText('חומרי PBR וריהוט מוכנים');
  await expect.poll(() => renderedColors(page)).toBeGreaterThan(24);
  await page.screenshot({ path: info.outputPath('north-bedrooms-first.png'), fullPage: true });
  await page.locator('.viewer canvas').screenshot({ path: info.outputPath('north-bedrooms-first-render.png') });
  const camera = (await session(page)).camera;
  await page.locator('.viewer canvas').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await session(page)).camera).not.toEqual(camera);
  expect(errors).toEqual([]);
});

test('round dining-table palette validates diameter, preserves a circle under scaling and supports edit history', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light');
  const initial = await saved(page);
  initial.buildings.north.width = 15.46; initial.buildings.north.depth = 5.13;
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: projectKey, state: initial });
  await page.reload();
  const editor = await editorFor(page, 'ground'), before = await saved(page);
  await editor.getByText('הוספת ריהוט ומכשירים', { exact: true }).click();
  await editor.getByRole('combobox', { name: 'פריט להוספה', exact: true }).selectOption('round-dining-table');
  await expect(editor.getByLabel(/^עומק חדש/)).toHaveCount(0);
  await editor.getByLabel(/^קוטר חדש/).fill('0');
  await editor.getByRole('button', { name: 'הוספת פריט', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible();
  expect((await saved(page)).design).toEqual(before.design);
  await editor.getByLabel(/^קוטר חדש/).fill('1.5');
  await editor.getByRole('button', { name: 'הוספת פריט', exact: true }).click();
  const table = (await saved(page)).design.addedFurniture.at(-1)!;
  expect(table).toMatchObject({ kind: 'dining-table', shape: 'round', unit: 'north', floor: 'ground' });
  expect(table.width * initial.buildings.north.width / 11.89).toBeCloseTo(1.5, 6);
  expect(table.depth * initial.buildings.north.depth / 6.84).toBeCloseTo(1.5, 6);
  await expect(editor.getByLabel('בחירת אובייקט', { exact: true })).toHaveValue(`furniture:${table.id}`);
  await page.screenshot({ path: info.outputPath('round-table-controls.png'), fullPage: true });
  await editor.getByRole('button', { name: 'מחיקת אובייקט', exact: true }).click();
  await expect(editor.locator(`[data-object-id="${table.id}"]`)).toHaveCount(0);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(editor.locator(`.cad-furniture[data-object-id="${table.id}"]`)).toHaveCount(1);
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect(editor.locator(`[data-object-id="${table.id}"]`)).toHaveCount(0);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await closeEditor(editor); await page.reload();
  const restored = await editorFor(page, 'ground');
  await expect(restored.locator(`.cad-furniture[data-object-id="${table.id}"]`)).toHaveCount(1);
  expect((await saved(page)).design.addedFurniture.at(-1)).toEqual(table);
  expect(errors).toEqual([]);
});

test('tour-unit selector is adjacent, leaves orbit alone and enters the chosen available unit despite floor isolation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light');
  const initial = await saved(page);
  initial.view.isolateFloor = 'first'; initial.view.cutaway = 'first';
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: projectKey, state: initial });
  await page.reload(); await settle(page);
  const modes = page.getByRole('group', { name: 'מצב תצוגה', exact: true });
  const selector = modes.getByLabel('יחידה לסיור', { exact: true });
  await expect(selector).toBeVisible();
  const camera = (await session(page)).camera;
  await selector.selectOption('south'); await settle(page);
  expect((await session(page)).camera).toEqual(camera);
  expect((await saved(page)).view.mode).toBe('orbit');
  await modes.getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await expect.poll(async () => (await session(page)).selectedRoom).toBe('b-living');
  expect((await saved(page)).view).toMatchObject({ mode: 'walk', cutaway: 'ground', isolateFloor: 'none' });
  await expect.poll(async () => (await session(page)).camera).not.toEqual(camera);
  await settle(page);
  const southCamera = (await session(page)).camera;
  await selector.selectOption('north');
  await expect.poll(async () => (await session(page)).selectedRoom).toBe('a-living');
  await expect.poll(async () => (await session(page)).camera).not.toEqual(southCamera);
  await expect.poll(() => renderedColors(page)).toBeGreaterThan(24);
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
  const obstructed = await modes.locator('button, select').evaluateAll(elements => elements.filter(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left < 0 || bounds.right > innerWidth || bounds.bottom > innerHeight || element.scrollWidth > element.clientWidth + 2
      || !element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  }).map(element => element.getAttribute('aria-label') ?? element.textContent));
  expect(obstructed).toEqual([]);
  await page.screenshot({ path: info.outputPath('tour-unit-controls.png'), fullPage: true });
  await page.reload();
  await expect(selector).toHaveValue('north');
  expect((await session(page)).selectedRoom).toBe('a-living');
  const disabled = await saved(page); disabled.buildings.south.enabled = false;
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: projectKey, state: disabled });
  await page.reload();
  await expect(selector.locator('option[value="south"]')).toHaveJSProperty('disabled', true);
  expect(errors).toEqual([]);
});