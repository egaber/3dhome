import { expect, test, type Page, type Locator } from '@playwright/test';

const key = 'dori-home-v2-design-library', classicKey = 'dori-solar-studio-v1';
const library = (page: Page) => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
async function ready(page: Page) {
  await page.goto('/?clawpilotTheme=light#v2');
  await expect(page.locator('.showroom-app')).toBeVisible();
  await expect(page.locator('.viewer canvas')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('.asset-status')).toContainText('מוכנים');
  await expect.poll(async () => (await library(page))?.options.length).toBeGreaterThan(0);
}
async function svgClick(page: Page, svg: Locator, x: number, y: number) {
  const p = await svg.evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const position = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: position.x, y: position.y };
  }, { x, y });
  await page.mouse.click(p.x, p.y);
}
const pdfContent = '20 20 m 420 20 l 420 320 l 20 320 l h S';
const vectorPdf = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [0 0 500 400] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length ${pdfContent.length} >>\nstream\n${pdfContent}\nendstream\nendobj\n%%EOF`;

test('V2 renders a furnished walk, tracks position/heading, and keeps classic storage independent', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), classicKey)).toBeNull();
  const marker = page.getByTestId('visitor-marker'), before = await marker.getAttribute('data-x'), heading = await marker.getAttribute('data-heading');
  await page.locator('.viewer canvas').focus();
  await page.keyboard.press('d');
  await expect(marker).not.toHaveAttribute('data-x', before!);
  await page.keyboard.press('q');
  await expect(marker).not.toHaveAttribute('data-heading', heading!);
  const minimap = await page.locator('.walk-minimap').boundingBox(), canvas = await page.locator('.showroom-stage').boundingBox();
  expect(minimap!.x).toBeGreaterThan(canvas!.x + canvas!.width / 2);
  expect(minimap!.y + minimap!.height).toBeLessThan(canvas!.y + canvas!.height);
  const colors = await page.locator('.viewer canvas').evaluate(element => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 48;
    const context = sample.getContext('2d')!; context.drawImage(element as HTMLCanvasElement, 0, 0, 48, 48);
    const data = context.getImageData(0, 0, 48, 48).data, colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return colors.size;
  });
  expect(colors).toBeGreaterThan(100);
  expect(await page.locator('.showroom-header button, .showroom-footer button').evaluateAll(elements => elements.filter(element => {
    const r = element.getBoundingClientRect(); return r.x < 0 || r.right > innerWidth + 1;
  }).map(element => element.textContent))).toEqual([]);
  await page.screenshot({ path: info.outputPath('v2-walkthrough.png'), fullPage: true });
  await page.getByRole('button', { name: 'אפשרויות סיור', exact: true }).click();
  const stable = await marker.getAttribute('data-x');
  await page.getByLabel('גובה העיניים (מטרים)', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  expect(await marker.getAttribute('data-x')).toBe(stable);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'אפשרויות סיור', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});

test('named alternatives survive reload, isolate edits, and retain CAD copy/paste and undo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  const original = (await library(page)).options[0].project;
  await page.getByRole('button', { name: /^חלופות/ }).click();
  await page.getByLabel('שם החלופה', { exact: true }).fill('חלופת בדיקה');
  await page.getByRole('button', { name: 'שמירה כחלופה חדשה', exact: true }).click();
  await expect.poll(async () => (await library(page)).options.length).toBe(2);
  await page.getByRole('button', { name: 'עריכת 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות', exact: true });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('furniture:a-living-sofa');
  await editor.getByRole('button', { name: 'העתקה', exact: true }).click();
  await editor.getByRole('button', { name: 'הדבקה', exact: true }).click();
  await expect.poll(async () => (await library(page)).options[1].project.design.addedFurniture.length).toBe(1);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await library(page)).options[1].project.design.addedFurniture.length).toBe(0);
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
  await page.reload();
  await expect(page.locator('.showroom-option-name')).toHaveText('חלופת בדיקה');
  const saved = await library(page);
  expect(saved.options[0].project).toEqual(original);
  expect(saved.options[1].project.design.addedFurniture).toHaveLength(1);
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), classicKey)).toBeNull();
  expect(errors).toEqual([]);
});

test('vector PDF import requires calibration and review then creates editable 2D/3D geometry', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'ייבוא תוכנית', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'מתוכנית לבית · ייבוא וכיול', exact: true });
  await dialog.getByLabel('קובץ תוכנית', { exact: true }).setInputFiles({ name: 'measured-floor.pdf', mimeType: 'application/pdf', buffer: Buffer.from(vectorPdf) });
  const drawing = dialog.getByLabel('תצוגה מקדימה לכיול ועריכת התוכנית', { exact: true });
  await expect(drawing.locator('line:not(.calibration)')).toHaveCount(4);
  const apply = dialog.getByRole('button', { name: 'יצירת חלופה ב־2D וב־3D', exact: true });
  await expect(apply).toBeDisabled();
  await svgClick(page, drawing, 20, 80); await svgClick(page, drawing, 420, 80);
  await dialog.getByLabel('המרחק האמיתי בין הנקודות (מטרים)', { exact: true }).fill('8');
  await expect(apply).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await expect(apply).toBeEnabled();
  await page.screenshot({ path: info.outputPath('v2-plan-calibration.png'), fullPage: true });
  await apply.click();
  await expect.poll(async () => (await library(page)).options.length).toBe(2);
  const imported = (await library(page)).options[1].project;
  expect(imported.design.addedWalls).toHaveLength(4);
  expect(imported.design.addedWalls[0].b[0] - imported.design.addedWalls[0].a[0]).toBeCloseTo(8, 5);
  await page.getByRole('button', { name: 'עריכת 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await expect(editor.locator('.cad-wall-polygon')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('v2-reconstructed-plan.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('corrupt saved alternatives are reported and never silently overwritten', async ({ page }) => {
  await page.addInitScript(storageKey => localStorage.setItem(storageKey, '{broken-library'), key);
  await page.goto('/?clawpilotTheme=light#v2');
  await expect(page.getByRole('alert')).toContainText('הנתונים הקיימים לא שונו');
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBe('{broken-library');
});
