import { expect, test } from '@playwright/test';

test('south family option preserves north, exports both plans, and renders both floors', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?plans=combined&clawpilotTheme=light');
  const previousNorth = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!).buildings.north);
  await page.getByRole('dialog').getByRole('button', { name: 'חלופה דרומית', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'יחידה דרומית · קרקע וקומה ראשונה', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('יחידות בתוכנית', { exact: true })).toHaveValue('south');
  await expect(dialog.locator('[data-plan-unit="south"]')).toHaveCount(2);
  await expect(dialog.locator('[data-plan-unit="north"]')).toHaveCount(0);
  const first = dialog.getByRole('region', { name: 'גיליון קומה ראשונה', exact: true });
  await expect(first.locator('[data-room-id="south-family-master"]')).toHaveCount(1);
  await expect(first.locator('[data-room-id^="south-family-child-"]')).toHaveCount(2);
  await expect(first.locator('[data-kind="bathtub"]')).toHaveCount(1);
  await expect(first.locator('[data-kind="shower"]')).toHaveCount(1);
  const ground = dialog.getByRole('region', { name: 'גיליון קומת קרקע', exact: true });
  for (const kind of ['fridge', 'cooktop', 'sink', 'dishwasher', 'oven-tower', 'washer-dryer', 'tv-console', 'kitchen-island']) {
    await expect(ground.locator(`[data-kind="${kind}"]`)).toHaveCount(1);
  }
  await expect(first.locator('[data-kind="desk"]')).toHaveCount(2);
  await expect(first.locator('[data-kind="bed"]')).toHaveCount(3);
  await expect(dialog.locator('.combined-plan-notes')).toContainText('20 רומים');
  await expect(dialog.locator('.combined-plan-notes')).toContainText('המעטפת החיצונית');
  await expect(first.locator('.combined-suite-size')).toContainText('5.90 × 3.65');
  await page.screenshot({ path: info.outputPath('south-family-plans.png'), fullPage: true });
  await dialog.getByRole('img', { name: 'תוכנית משולבת · קומת קרקע', exact: true }).screenshot({ path: info.outputPath('south-ground-plan.png') });
  await dialog.getByRole('img', { name: 'תוכנית משולבת · קומה ראשונה', exact: true }).screenshot({ path: info.outputPath('south-first-plan.png') });
  const downloadEvent = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'הורדת תוכנית SVG', exact: true }).click();
  await (await downloadEvent).saveAs(info.outputPath('south-family-plans.svg'));
  if (info.project.name === 'desktop') await page.pdf({ path: info.outputPath('south-family-plans.pdf'), preferCSSPageSize: true, printBackground: true });
  await first.getByRole('button', { name: 'תלת־ממד לקומה', exact: true }).click();
  const controls = page.getByRole('group', { name: 'הדמיית שתי היחידות', exact: true });
  await expect(controls.getByLabel('יחידות בהדמיה', { exact: true })).toHaveValue('south');
  await expect(page.locator('.model-chat')).toHaveCount(0);
  for (const [floor, label] of [['first', 'קומה ראשונה'], ['ground', 'קרקע']] as const) {
    await controls.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.asset-status')).toContainText('מוכנים');
    await expect.poll(() => page.locator('.viewer canvas').evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const context = canvas.getContext('2d')!; context.drawImage(element as HTMLCanvasElement, 0, 0, 32, 32);
      const data = context.getImageData(0, 0, 32, 32).data, colors = new Set<string>();
      for (let index = 0; index < data.length; index += 4) colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      return colors.size;
    })).toBeGreaterThan(24);
    await page.screenshot({ path: info.outputPath(`south-${floor}-screen.png`), fullPage: true });
    const imageEvent = page.waitForEvent('download');
    await controls.getByRole('button', { name: 'שמירת תמונת הדמיה', exact: true }).click();
    await (await imageEvent).saveAs(info.outputPath(`south-${floor}-3d.png`));
  }
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera);
  await page.locator('.viewer canvas').click(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera)).not.toEqual(before);
  await page.getByRole('button', { name: 'הערות למודל', exact: true }).click();
  await page.getByRole('textbox', { name: 'פקודה לעדכון המודל', exact: true }).fill('טיוטה');
  await controls.getByRole('button', { name: 'קומה ראשונה', exact: true }).click();
  await expect(page.locator('.model-chat')).toHaveCount(0);
  await page.getByRole('button', { name: 'הערות למודל', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'פקודה לעדכון המודל', exact: true })).toHaveValue('טיוטה');
  await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!).buildings.north)).toEqual(previousNorth);
  const clipping = await page.locator('.topbar button, .duplex-presentation-controls select').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1;
  }).map(element => element.textContent));
  expect(clipping).toEqual([]);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!).buildings.south.southLayout)).toBe('family');
  expect(errors).toEqual([]);
});