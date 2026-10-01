import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { SimulationState } from '../src/model/types';

const key = 'dori-solar-studio-v1';
const saved = (page: Page): Promise<SimulationState> => page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
const library = async (page: Page) => {
  await page.getByRole('button', { name: 'חומרים וריהוט', exact: true }).click();
  return page.getByRole('dialog', { name: 'חומרים וריהוט מציאותיים', exact: true });
};
const ready = (page: Page) => expect(page.locator('.asset-status')).toContainText('חומרי PBR וריהוט מוכנים');
async function addModel(page: Page, search: string, name: string) {
  const dialog = await library(page);
  await dialog.getByRole('button', { name: /קטלוג ריהוט ומכשירים/ }).click();
  await dialog.getByRole('textbox', { name: 'חיפוש ריהוט' }).fill(search);
  await dialog.getByRole('button', { name: `הוספת ${name}`, exact: true }).click();
  await ready(page);
}

test('independent floor/ceiling/object materials, uploaded image, undo and persistence', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  const initial = await saved(page), furniture = initial.design.addedFurniture;
  const dialog = await library(page);
  for (const [target, material] of [['floor-north-ground', 'wood'], ['ceiling-north-ground', 'dark'], ['stair-stair-north-ground', 'stone']] as const) {
    await dialog.getByRole('combobox', { name: 'אובייקט לחומר' }).selectOption(target);
    await dialog.getByRole('combobox', { name: 'חומר האובייקט', exact: true }).selectOption(material);
    await dialog.getByRole('button', { name: 'החלת חומר' }).click();
    await expect.poll(async () => (await saved(page)).appearance?.assignments[target]?.material).toBe(material);
  }
  await dialog.getByRole('combobox', { name: 'אובייקט לחומר' }).selectOption('floor-north-ground');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#aa7733'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#663311'; ctx.fillRect(0, 0, 64, 64);
    return c.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('תמונת חומר', { exact: true }).setInputFiles({ name: 'my-wood.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect.poll(async () => (await saved(page)).appearance?.images.length).toBe(1);
  const withImage = await saved(page), id = withImage.appearance!.images[0].id;
  expect(withImage.appearance!.assignments['floor-north-ground'].material).toBe(id);
  expect(withImage.appearance!.images[0].image).toMatch(/^data:image\/webp;base64,/);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-custom-material.png`), fullPage: true });
  await page.keyboard.press('Escape');
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).appearance?.images.length).toBe(0);
  await page.locator('.topbar').getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await page.reload();
  await expect.poll(async () => (await saved(page)).appearance).toEqual(withImage.appearance);
  expect((await saved(page)).design.addedFurniture).toEqual(furniture);
  expect(errors).toEqual([]);
});

test('catalogue appliances can be duplicated, moved, resized, rotated, materialized and removed independently', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/'); await addModel(page, 'מקרר רחב', 'מקרר רחב');
  const original = (await saved(page)).design.addedFurniture.at(-1)!;
  const editor = page.getByRole('region', { name: 'עריכה מהירה של אובייקט' });
  await expect(editor).toBeVisible();
  await editor.getByRole('combobox', { name: 'חומר האובייקט', exact: true }).selectOption('metal');
  await editor.getByRole('button', { name: 'החלת חומר' }).click();
  await editor.getByRole('button', { name: 'שכפול אובייקט' }).click();
  const state = await saved(page), copy = state.design.addedFurniture.at(-1)!;
  expect(copy.id).not.toBe(original.id); expect(state.appearance!.models[copy.id]).toBe('kenney-kitchenFridgeLarge');
  expect(state.appearance!.assignments[`furniture-${copy.id}`].material).toBe('metal');
  const x = editor.getByRole('spinbutton', { name: 'מרכז X', exact: false }).first();
  await x.fill('5');
  await editor.getByRole('spinbutton', { name: 'רוחב פריט', exact: false }).fill('1.2');
  await editor.getByRole('spinbutton', { name: 'סיבוב מקומי', exact: false }).fill('45');
  await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.furnitureEdits[copy.id]?.rotation).toBe(45);
  expect((await saved(page)).design.furnitureEdits[original.id]).toBeUndefined();
  await page.screenshot({ path: info.outputPath(`${info.project.name}-appliance-editor.png`), fullPage: true });
  await editor.getByRole('button', { name: 'מחיקת אובייקט', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.furnitureEdits[copy.id]?.deleted).toBe(true);
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.furnitureEdits[copy.id]?.deleted).toBe(false);
  expect(errors).toEqual([]);
});

test('portable backup embeds models and restores into an empty cache without asset network access', async ({ page }, info) => {
  await page.goto('/'); await addModel(page, 'מכונת כביסה', 'מכונת כביסה');
  const original = await saved(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'שמירת קובץ', exact: true }).click();
  const download = await downloading, path = info.outputPath('portable-backup.json'); await download.saveAs(path);
  const buffer = await readFile(path), bundle = JSON.parse(buffer.toString());
  expect(bundle.resources.files['catalog/washer.glb']).toMatch(/^data:/);
  expect(Object.keys(bundle.resources.files).length).toBe(18);
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('dori-realism-assets-v1'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Database still open')); });
  });
  await page.reload();
  await page.route('**/assets/realism/**', route => route.abort());
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'portable.json', mimeType: 'application/json', buffer });
  await ready(page);
  await expect.poll(async () => (await saved(page)).appearance).toEqual(original.appearance);
  await page.reload(); await ready(page);
  await expect.poll(async () => (await saved(page)).design.addedFurniture).toEqual(original.design.addedFurniture);
});

test('PBR modern chair resolves cached local glTF dependencies', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await addModel(page, 'PBR', 'כורסה מודרנית · עץ ועור PBR');
  await page.screenshot({ path: info.outputPath(`${info.project.name}-modern-pbr-chair.png`), fullPage: true });
  expect(errors).toEqual([]);
});

test('missing catalogue model has a visible fallback and does not discard its editable record', async ({ page }) => {
  await page.goto('/');
  await page.route('**/assets/realism/catalog/kitchenFridgeLarge.glb', route => route.abort());
  const dialog = await library(page); await dialog.getByRole('button', { name: /קטלוג ריהוט ומכשירים/ }).click();
  await dialog.getByRole('textbox', { name: 'חיפוש ריהוט' }).fill('מקרר רחב');
  await dialog.getByRole('button', { name: 'הוספת מקרר רחב', exact: true }).click();
  await expect(page.locator('.asset-status')).toContainText('מוצג גיבוי בסיסי');
  expect((await saved(page)).design.addedFurniture.at(-1)?.kind).toBe('fridge');
  await expect(page.getByRole('button', { name: 'שכפול אובייקט', exact: true })).toBeVisible();
});

test('invalid image and tampered backup leave the existing project unchanged', async ({ page }) => {
  await page.goto('/'); const before = await saved(page), dialog = await library(page);
  await dialog.getByLabel('תמונת חומר', { exact: true }).setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('<svg/>') });
  await expect(dialog.getByRole('alert')).toBeVisible(); expect(await saved(page)).toEqual(before);
  await page.keyboard.press('Escape');
  const bad = { format: 'dori-solar-workspace', version: 1, project: before, resources: { version: 1, files: { 'catalog/washer.glb': 'data:application/octet-stream;base64,AAAA' } } };
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.locator('.notice')).toContainText('checksum'); expect(await saved(page)).toEqual(before);
});

test('user-authorized file backup writes serially and includes later material edits', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { writes: [] as string[], active: 0, max: 0 };
    Object.assign(window, { backupTest: state, showSaveFilePicker: async () => ({ name: 'test-backup.json', createWritable: async () => ({
      write: async (data: string) => { state.active++; state.max = Math.max(state.max, state.active); state.writes.push(data); },
      close: async () => { state.active--; }, abort: async () => { state.active--; },
    }) }) });
  });
  await page.goto('/'); const dialog = await library(page);
  await dialog.getByRole('button', { name: 'בחירת קובץ לגיבוי מתעדכן' }).click();
  await expect(dialog.getByText('גיבוי עודכן:', { exact: false })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'חומר האובייקט', exact: true }).selectOption('stone');
  await dialog.getByRole('button', { name: 'החלת חומר' }).click();
  await expect.poll(() => page.evaluate(() => {
    const t = (window as unknown as { backupTest: { writes: string[] } }).backupTest;
    return JSON.parse(t.writes.at(-1)!).project.appearance?.assignments['floor-north-ground']?.material;
  })).toBe('stone');
  expect(await page.evaluate(() => (window as unknown as { backupTest: { max: number } }).backupTest.max)).toBe(1);
});

test('file-write denial is visible and does not claim the backup was saved', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { showSaveFilePicker: async () => ({ name: 'denied.json', createWritable: async () => { throw new Error('Permission denied'); } }) }));
  await page.goto('/'); const dialog = await library(page);
  await dialog.getByRole('button', { name: 'בחירת קובץ לגיבוי מתעדכן' }).click();
  await expect(dialog.getByText('גיבוי הקובץ נכשל:', { exact: false })).toBeVisible();
  await expect(dialog.getByText('גיבוי עודכן:', { exact: false })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'ניתוק גיבוי מתעדכן' }).click();
});

test('catalogue search and material targeting remain usable in narrow dark RTL layout', async ({ page }, info) => {
  await page.goto('/?clawpilotTheme=dark'); const dialog = await library(page);
  await dialog.getByRole('button', { name: /קטלוג ריהוט ומכשירים/ }).click();
  await dialog.getByRole('textbox', { name: 'חיפוש ריהוט' }).fill('no-matching-furniture');
  await expect(dialog.getByText('לא נמצאו פריטים.', { exact: false })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'חיפוש ריהוט' }).fill('');
  await expect(dialog.locator('.catalog-card')).toHaveCount(33);
  const size = await dialog.evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth, right: el.getBoundingClientRect().right, width: innerWidth }));
  expect(size.overflow).toBeLessThanOrEqual(1); expect(size.right).toBeLessThanOrEqual(size.width);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-modern-catalogue-dark.png`), fullPage: true });
});