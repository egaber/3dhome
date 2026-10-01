import { expect, test, type Page } from '@playwright/test';

const key = 'dori-solar-studio-v1';
const mode = (page: Page) => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).view.renderMode as string, key);
const enable = (page: Page) => page.getByRole('group', { name: 'סגנון תצוגה', exact: true }).getByRole('button', { name: 'ריאליסטי', exact: true }).click();
const ready = (page: Page) => expect(page.locator('.asset-status')).toContainText('חומרי PBR וריהוט מוכנים');
const pixels = (page: Page) => page.locator('.viewer canvas').evaluate(element => {
  const sample = document.createElement('canvas'); sample.width = sample.height = 48;
  const context = sample.getContext('2d')!; context.drawImage(element as HTMLCanvasElement, 0, 0, 48, 48);
  const bytes = context.getImageData(0, 0, 48, 48).data, colours = new Set<string>();
  for (let i = 0; i < bytes.length; i += 4) colours.add(`${bytes[i]},${bytes[i + 1]},${bytes[i + 2]}`);
  return colours.size;
});

test('real local PBR and GLB assets render, cache across edits, persist, and support undo', async ({ page }, testInfo) => {
  const errors: string[] = [], assetRequests: string[] = [], external: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => {
    if (r.url().includes('/assets/realism/')) assetRequests.push(r.url());
    if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== '127.0.0.1') external.push(r.url());
  });
  await page.goto('/');
  await expect(page.locator('.viewer canvas')).toBeVisible();
  const size = await page.locator('.viewer canvas').evaluate(el => {
    const canvas = el.getBoundingClientRect(), host = el.parentElement!.getBoundingClientRect();
    return { width: canvas.width - host.width, height: canvas.height - host.height };
  });
  expect(Math.abs(size.width)).toBeLessThanOrEqual(1); expect(Math.abs(size.height)).toBeLessThanOrEqual(1);
  expect(assetRequests).toEqual([]);
  await enable(page); await ready(page);
  await expect.poll(() => pixels(page)).toBeGreaterThan(30);
  expect(new Set(assetRequests).size).toBe(17);
  expect(assetRequests.filter(url => url.endsWith('.glb'))).toHaveLength(2);
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => mode(page)).toBe('model'); await expect(page.locator('.asset-status')).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await ready(page); await expect.poll(() => mode(page)).toBe('realistic');
  expect(assetRequests).toHaveLength(17);
  await page.getByRole('combobox', { name: 'בחרו קומה לצפייה', exact: true }).selectOption('ground');
  await page.getByRole('button', { name: 'מבט על', exact: true }).click();
  await page.getByRole('button', { name: 'סגירת הצ׳אט' }).click();
  await expect.poll(() => pixels(page)).toBeGreaterThan(30);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-realistic-ground.png`), fullPage: true });
  await page.getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await expect.poll(() => pixels(page)).toBeGreaterThan(30);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-realistic-interior.png`), fullPage: true });
  expect(assetRequests).toHaveLength(17);
  await page.reload(); await ready(page); await expect.poll(() => mode(page)).toBe('realistic');
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('materials library has credits, fits RTL screens, traps focus and enables the real viewer', async ({ page }, testInfo) => {
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'חומרים וריהוט', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'חומרים וריהוט מציאותיים', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'CC BY 4.0', exact: true })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
  await expect(dialog.locator('.material-grid img')).toHaveCount(5);
  const overflow = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, viewport: innerWidth, overflow: el.scrollWidth - el.clientWidth }));
  expect(overflow.width).toBeLessThanOrEqual(overflow.viewport); expect(overflow.overflow).toBeLessThanOrEqual(1);
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-material-library.png`), fullPage: true });
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await trigger.click(); await dialog.getByRole('button', { name: 'הפעלת חומרים וריהוט ריאליסטיים' }).click();
  await expect(dialog).toHaveCount(0); await ready(page);
});

test('missing local textures and models show a usable fallback without losing project edits', async ({ page }) => {
  const unhandled: string[] = []; page.on('pageerror', e => unhandled.push(e.message));
  await page.route('**/assets/realism/**', route => route.abort());
  await page.goto('/');
  const design = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).design, key);
  await enable(page);
  await expect(page.locator('.asset-status')).toContainText('מוצג גיבוי בסיסי');
  await expect.poll(() => pixels(page)).toBeGreaterThan(30);
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).design, key)).toEqual(design);
  await page.getByRole('button', { name: 'מודל', exact: true }).click();
  await expect(page.locator('.asset-status')).toHaveCount(0); expect(unhandled).toEqual([]);
});

test('real furniture and material detail are visible from an interior camera', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const project = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
  project.northBearing = 0;
  Object.assign(project.buildings.north, { x: 0, z: 0, rotation: 0 });
  Object.assign(project.view, { renderMode: 'realistic', mode: 'walk', isolateFloor: 'ground', planVisible: false, grid: false, path: false });
  project.design.addedFurniture.push({ id: 'materials-preview-chair', kind: 'armchair', unit: 'north', floor: 'ground',
    center: [11.1, 2.95], rotation: 0, width: .7, height: .85, depth: .8, source: 'added' });
  const data = { format: 'dori-solar-workspace', version: 1, project,
    session: { camera: { position: [10, 1.4, .3], target: [10, .48, 2.95], up: [0, 1, 0], zoom: 1 }, selectedRoom: 'a-living', selectedUnit: 'north' } };
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'materials-preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await ready(page); await page.getByRole('button', { name: 'סגירת הצ׳אט' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera.position)).toEqual([10, 1.4, .3]);
  await expect.poll(() => pixels(page)).toBeGreaterThan(100);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-furniture-detail.png`), fullPage: true });
  expect(errors).toEqual([]);
});