import { expect, test } from '@playwright/test';

test('a canvas click opens the visible door leaf, not a look drag, and the south garden keeps its unit context', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?clawpilotTheme=light&plan=october-2026#v2');
  await expect(page.locator('.asset-status')).toContainText('מוכנים');
  await page.getByRole('button', { name: /הבית הצפוני/ }).click();
  const rooms = page.getByRole('dialog', { name: 'בחרו לאן ללכת', exact: true });
  await rooms.getByRole('button', { name: 'הבית הדרומי', exact: true }).click();
  await rooms.getByRole('button', { name: 'כניסה לסיור בגינה', exact: true }).click();
  await expect(page.locator('.walk-minimap')).toContainText('הבית הדרומי');
  await expect(page.locator('.showroom-live')).toContainText('גינה וחוץ');
  await expect(page.getByRole('button', { name: 'הבית הדרומי · גינה וחוץ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'הבית הדרומי · גינה וחוץ', exact: true }).click();
  await rooms.getByRole('button', { name: 'מבואה', exact: true }).click();
  await expect(page.locator('.showroom-live')).toContainText('קומת קרקע');
  const canvas = page.locator('.viewer canvas');
  await canvas.focus();
  const marker = page.getByTestId('visitor-marker'), heading = await marker.getAttribute('data-heading');
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-home-v2-design-library')!));
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-home-v2-design-library')!));
  expect(after.options.find((option: { id: string }) => option.id === after.activeId).project.openings)
    .toEqual(before.options.find((option: { id: string }) => option.id === before.activeId).project.openings);
  await expect(marker).not.toHaveAttribute('data-heading', heading!);
  const x = Number(await marker.getAttribute('data-x')), z = Number(await marker.getAttribute('data-z'));
  const dx = 9.38 - x, dz = 10.99 - z, dy = 1.15 - 1.62;
  const desired = Math.atan2(dx, -dz);
  for (let i = 0; i < 18; i++) {
    const current = await marker.getAttribute('data-heading');
    const delta = Math.atan2(Math.sin(desired - Number(current) * Math.PI / 180), Math.cos(desired - Number(current) * Math.PI / 180));
    if (Math.abs(delta) < .08) break;
    await page.keyboard.press(delta < 0 ? 'q' : 'e');
    await expect(marker).not.toHaveAttribute('data-heading', current!);
  }
  const yaw = Number(await marker.getAttribute('data-heading')) * Math.PI / 180;
  const pitch = Math.atan2(-.18, Math.hypot(7.725 - x, 11.23 - z));
  const along = dx * Math.sin(yaw) - dz * Math.cos(yaw), side = dx * Math.cos(yaw) + dz * Math.sin(yaw);
  const depth = along * Math.cos(pitch) + dy * Math.sin(pitch), up = -along * Math.sin(pitch) + dy * Math.cos(pitch);
  const tangent = Math.tan(65 * Math.PI / 360);
  const click = { x: box.width * (.5 + side / (depth * tangent * (box.width / box.height)) / 2), y: box.height * (.5 - up / (depth * tangent) / 2) };
  expect(click.x).toBeGreaterThan(0); expect(click.x).toBeLessThan(box.width);
  expect(click.y).toBeGreaterThan(0); expect(click.y).toBeLessThan(box.height);
  await canvas.click({ position: click });
  await expect.poll(() => page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('dori-home-v2-design-library')!);
    return library.options.find((option: { id: string }) => option.id === library.activeId).project.openings['october-ground-12-south-opening-0']?.open;
  })).toBe(true);
  expect(errors).toEqual([]);
});
