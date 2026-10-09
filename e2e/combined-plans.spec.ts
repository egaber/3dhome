import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const projectKey = 'dori-solar-studio-v1';

async function modelGeometry(page: Page) {
  return page.evaluate(key => {
    const { view, ...model } = JSON.parse(localStorage.getItem(key)!);
    return model;
  }, projectKey);
}

async function renderedColors(page: Page) {
  return page.locator('.viewer canvas').evaluate(element => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 32;
    const context = sample.getContext('2d')!;
    context.drawImage(element as HTMLCanvasElement, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data, colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return colors.size;
  });
}

test('combined floor sheets are read-only, accessible, and export self-contained plans', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?plans=combined&clawpilotTheme=light');
  const dialog = page.getByRole('dialog', { name: 'דו־משפחתי · שתי היחידות', exact: true });
  await expect(dialog).toBeVisible();
  const initial = await modelGeometry(page);
  await expect(dialog.locator('.combined-plan-drawing')).toHaveCount(2);
  await expect(dialog.locator('[data-plan-unit="north"]')).toHaveCount(2);
  await expect(dialog.locator('[data-plan-unit="south"]')).toHaveCount(2);
  await expect(dialog.locator('svg [role="button"], svg [tabindex="0"]')).toHaveCount(0);
  await expect(dialog.locator('.combined-room-schedules')).toContainText(['3.71 × 6.52', 'חדר שינה']);
  await expect(dialog.locator('.combined-plan-notes')).toContainText('נדרש אימות אדריכלי');
  const clipped = await dialog.locator('header button, .combined-plan-tools button, .combined-plan-tools label').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1 || rect.width < 1;
  }).map(element => element.textContent));
  expect(clipped).toEqual([]);
  await page.screenshot({ path: info.outputPath('combined-plans.png'), fullPage: true });

  await dialog.getByRole('button', { name: 'הגדלת התוכנית', exact: true }).click();
  await expect(dialog.getByLabel('קנה מידת תצוגה')).toHaveText('125%');
  await dialog.getByRole('button', { name: 'הקטנת התוכנית', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'ריהוט', exact: true }).uncheck();
  await expect(dialog.locator('.cad-furniture')).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'ריהוט', exact: true }).check();
  await dialog.getByRole('button', { name: 'קומת קרקע', exact: true }).click();
  await expect(dialog.locator('.combined-plan-drawing')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'קומה ראשונה', exact: true }).click();
  await expect(dialog.getByRole('img', { name: 'תוכנית משולבת · קומה ראשונה', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'שתי הקומות', exact: true }).click();
  await page.keyboard.press('Control+z');
  expect(await modelGeometry(page)).toEqual(initial);

  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'הורדת תוכנית SVG', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('duplex-combined-plans.svg');
  await download.saveAs(info.outputPath('duplex-combined-plans.svg'));
  const svg = await readFile(info.outputPath('duplex-combined-plans.svg'), 'utf8');
  expect(svg).toContain('3.71 × 6.52'); expect(svg).toContain('שירותי אורחים');
  expect(svg).not.toContain('var(--'); expect(svg).not.toContain('NaN');
  const exported = await page.evaluate(source => {
    const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
    return { errors: parsed.querySelectorAll('parsererror').length, sheets: parsed.querySelectorAll('svg svg').length,
      units: parsed.querySelectorAll('[data-plan-unit]').length, scripts: parsed.querySelectorAll('script, foreignObject, image').length };
  }, svg);
  expect(exported).toEqual({ errors: 0, sheets: 2, units: 4, scripts: 0 });
  if (info.project.name === 'desktop') await page.pdf({ path: info.outputPath('duplex-combined-plans.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'תוכנית משולבת', exact: true }).click();
  await page.getByRole('button', { name: 'סגירת התוכנית המשולבת', exact: true }).click();
  await expect(page.getByRole('button', { name: 'תוכנית משולבת', exact: true })).toBeFocused();
  expect(await modelGeometry(page)).toEqual(initial); expect(errors).toEqual([]);
});

test('both dwellings render in all 3D presets and PNG export without changing model geometry', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?plans=combined&clawpilotTheme=light');
  const initial = await modelGeometry(page);
  await page.getByRole('button', { name: 'הדמיה תלת־ממדית', exact: true }).click();
  const controls = page.getByRole('group', { name: 'הדמיית שתי היחידות', exact: true });
  for (const [preset, label] of [['exterior', 'מבנה מלא'], ['ground', 'קרקע'], ['first', 'קומה ראשונה']] as const) {
    await controls.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).view.isolateFloor, projectKey)).toBe(preset === 'exterior' ? 'none' : preset);
    await expect.poll(() => renderedColors(page), { message: `${preset} must contain rendered WebGL geometry` }).toBeGreaterThan(24);
    await expect(page.locator('.asset-status')).toContainText('מוכנים');
    await page.screenshot({ path: info.outputPath(`duplex-${preset}.png`), fullPage: true });
    await page.locator('.viewer canvas').screenshot({ path: info.outputPath(`duplex-${preset}-render.png`) });
    expect(await modelGeometry(page)).toEqual(initial);
  }
  const cameraBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera);
  await page.locator('.viewer canvas').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera)).not.toEqual(cameraBefore);
  const downloadEvent = page.waitForEvent('download');
  await controls.getByRole('button', { name: 'שמירת תמונת הדמיה', exact: true }).click();
  const download = await downloadEvent; await download.saveAs(info.outputPath('duplex-first-download.png'));
  expect((await readFile(info.outputPath('duplex-first-download.png'))).byteLength).toBeGreaterThan(10_000);
  const viewport = page.viewportSize()!;
  for (const button of await controls.getByRole('button').all()) {
    const rect = await button.boundingBox(); expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  expect(errors).toEqual([]);
});