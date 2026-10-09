import { expect, test, type Page, type Locator } from '@playwright/test';

const key = 'dori-home-v2-design-library';
async function clickPlan(page: Page, drawing: Locator, x: number, y: number) {
  const point = await drawing.evaluate((element, p) => {
    const next = new DOMPoint(p.x, p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: next.x, y: next.y };
  }, { x, y });
  await page.mouse.click(point.x, point.y);
}

test('JPEG assisted tracing retains its calibrated image and never replaces the original house', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light#v2');
  await expect(page.locator('.showroom-app')).toBeVisible();
  await page.getByRole('button', { name: 'ייבוא תוכנית', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'מתוכנית לבית · ייבוא וכיול', exact: true });
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; context.fillRect(0, 0, 400, 300);
    context.strokeStyle = '#000'; context.lineWidth = 3; context.strokeRect(40, 40, 320, 220);
    return canvas.toDataURL('image/jpeg', .94).split(',')[1];
  });
  await dialog.getByLabel('קובץ תוכנית', { exact: true }).setInputFiles({ name: 'calibrated-room.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
  const drawing = dialog.getByLabel('תצוגה מקדימה לכיול ועריכת התוכנית', { exact: true });
  await expect(drawing.locator('image')).toHaveCount(1);
  await expect(drawing.locator('line')).toHaveCount(4);
  await clickPlan(page, drawing, 40, 40); await clickPlan(page, drawing, 360, 40);
  await dialog.getByLabel('המרחק האמיתי בין הנקודות (מטרים)', { exact: true }).fill('6.4');
  await dialog.getByLabel('שם החלופה', { exact: true }).fill('תוכנית JPEG מכוילת');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'יצירת חלופה ב־2D וב־3D', exact: true }).click();
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).options.length, key)).toBe(2);
  const archive = await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!), key);
  expect(archive.options[0].project.design.importedPlan).toBeUndefined();
  expect(archive.options[1].project.design.importedPlan.image).toMatch(/^data:image\/jpeg;base64,/);
  expect(archive.options[1].project.design.importedPlan.imageWidth).toBeCloseTo(8, 4);
  expect(archive.options[1].project.design.importedPlan.imageDepth).toBeCloseTo(6, 4);
  await page.getByRole('button', { name: 'עריכת 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await expect(editor.locator('.cad-canvas image')).toHaveCount(1);
  await expect(editor.locator('.cad-wall-polygon')).toHaveCount(4);
  await page.screenshot({ path: info.outputPath('v2-jpeg-editable-plan.png'), fullPage: true });
  expect(await page.evaluate(() => localStorage.getItem('dori-solar-studio-v1'))).toBeNull();
  expect(errors).toEqual([]);
});

test('unsupported PDF input reports an error instead of creating a guessed design', async ({ page }) => {
  await page.goto('/?clawpilotTheme=light#v2');
  await page.getByRole('button', { name: 'ייבוא תוכנית', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'מתוכנית לבית · ייבוא וכיול', exact: true });
  await dialog.getByLabel('קובץ תוכנית', { exact: true }).setInputFiles({ name: 'encrypted.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n/Encrypt 2 0 R\n') });
  await expect(dialog.getByRole('alert')).toContainText('מוצפן');
  await expect(dialog.getByRole('button', { name: 'יצירת חלופה ב־2D וב־3D', exact: true })).toBeDisabled();
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)!).options.length, key)).toBe(1);
});
