import { expect, test } from '@playwright/test';

test('static app renders and view modes work without browser errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.locator('main.app-shell')).toBeVisible();
  await expect(page.locator('.brand')).toContainText('דורי 50');
  await expect(page.locator('.solar-pill')).not.toContainText('זמן לא תקין');
  await expect(page.locator('[aria-label="תצוגת תלת־ממד אינטראקטיבית"] canvas')).toBeVisible();

  const modes = page.getByRole('group', { name: 'מצב תצוגה', exact: true });
  await modes.getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await expect(page.getByRole('button', { name: 'קדימה', exact: true })).toBeVisible();
  await modes.getByRole('button', { name: 'מבט על', exact: true }).click();
  await expect(page.getByRole('button', { name: 'קדימה', exact: true })).toHaveCount(0);
  await modes.getByRole('button', { name: 'סיבוב', exact: true }).click();
  await expect(page.locator('.notice')).toBeVisible();

  // A visible canvas can still be blank while WebGL/compositing catches up.
  await expect.poll(() => page.locator('[aria-label="תצוגת תלת־ממד אינטראקטיבית"] canvas').evaluate(element => {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 16;
    const context = sample.getContext('2d')!;
    context.drawImage(element as HTMLCanvasElement, 0, 0, 16, 16);
    const pixels = context.getImageData(0, 0, 16, 16).data;
    const colors = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return colors.size;
  }), { message: 'The WebGL view must contain rendered geometry, not a blank canvas' }).toBeGreaterThan(4);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  // A screenshot is evidence for independent visual review, not an auto-approved baseline.
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });
  expect(errors, 'Unhandled runtime errors and browser console errors').toEqual([]);
});