import { expect, test, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const sessionKey = 'dori-solar-studio-session-v1', projectKey = 'dori-solar-studio-v1';
type Camera = { position: number[]; target: number[]; up: number[]; zoom?: number };
const read = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).camera as Camera, sessionKey);
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), projectKey);
async function settle(page: Page, milliseconds = 240) {
  await page.evaluate(ms => new Promise<void>(resolve => {
    const start = performance.now(); const frame = () => performance.now() - start >= ms ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame);
  }), milliseconds);
}
const plan = (p: number[], bearing: number) => {
  const a = bearing * Math.PI / 180;
  return [p[0] * Math.cos(a) + p[2] * Math.sin(a), -p[0] * Math.sin(a) + p[2] * Math.cos(a)];
};
async function fixture(page: Page, upper = false) {
  await page.goto('/'); await expect(page.locator('.viewer canvas')).toBeVisible();
  await expect.poll(() => read(page)).not.toBeNull();
  const bearing = await page.evaluate(({ projectKey, sessionKey, upper }) => {
    const s = JSON.parse(localStorage.getItem(projectKey)!) as SimulationState;
    s.view = { ...s.view, mode: 'walk', quality: 'standard', renderMode: 'model', planVisible: false, path: false };
    const a = s.northBearing * Math.PI / 180;
    const world = (x: number, z: number) => [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
    const x = upper ? 5.7875 : 4.5925, z = upper ? 10.45 : 10.45, y = upper ? 5.02 : 1.62;
    const p = world(x, z), t = world(x, z - 2);
    const old = JSON.parse(localStorage.getItem(sessionKey)!);
    localStorage.setItem(projectKey, JSON.stringify(s));
    localStorage.setItem(sessionKey, JSON.stringify({ ...old, selectedUnit: 'south', selectedRoom: 'b-living', camera: { position: [p[0], y, p[1]], target: [t[0], y - .1, t[1]], up: [0, 1, 0], zoom: 1 } }));
    return s.northBearing;
  }, { projectKey, sessionKey, upper });
  await page.reload(); await expect(page.locator('.viewer canvas')).toBeVisible(); await page.locator('.viewer canvas').focus(); await settle(page);
  return bearing;
}
async function taps(page: Page, key: string, count: number) {
  for (let i = 0; i < count; i++) await page.keyboard.press(key);
  await settle(page);
}
async function walkTo(page: Page, bearing: number, axis: 0 | 1, target: number, positiveKey: string, negativeKey: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const delta = target - plan((await read(page)).position, bearing)[axis];
    if (Math.abs(delta) < .065) return;
    await taps(page, delta > 0 ? positiveKey : negativeKey, Math.max(1, Math.min(5, Math.floor(Math.abs(delta) / .09))));
  }
  expect(plan((await read(page)).position, bearing)[axis]).toBeCloseTo(target, 1);
}
async function stepAfterRebuild(page: Page, before: Camera, bearing: number) {
  await settle(page);
  expect(await read(page), 'A rebuild must preserve the entire camera, not just its position').toEqual(before);
  await page.locator('.viewer canvas').focus(); await taps(page, 'ArrowUp', 1);
  const after = await read(page);
  expect(plan(after.position, bearing)[1]).toBeLessThan(plan(before.position, bearing)[1] - .03);
  expect(after.up).toEqual(before.up); expect(after.zoom).toBe(before.zoom);
  after.target.forEach((value, i) => expect(value - after.position[i]).toBeCloseTo(before.target[i] - before.position[i], 7));
  await expect(page.locator('.notice')).not.toContainText('המיקום אינו תקף');
  return after;
}
async function turnAround(page: Page) {
  const before = await read(page);
  // Manual FPS canvas turn, exactly pi, no camera injection between movements.
  const segment = Math.PI / .004 / 16;
  const point = await page.locator('.viewer canvas').evaluate((canvas, segment) => {
    const r = canvas.getBoundingClientRect();
    for (let y = r.y + 20; y < r.bottom - 20; y += 15) for (let x = r.x + 20; x < r.right - segment - 20; x += 15) {
      if ([0, .25, .5, .75, 1].every(t => document.elementFromPoint(x + segment * t, y) === canvas)) return { x, y };
    }
    return null;
  }, segment);
  expect(point, 'A real unobstructed canvas gesture must remain reachable').not.toBeNull();
  const { x, y } = point!;
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + segment, y, { steps: 3 }); await page.mouse.up();
  }
  await settle(page);
  const after = await read(page);
  expect(after.position).toEqual(before.position);
  const a = before.target.map((v, i) => v - before.position[i]), b = after.target.map((v, i) => v - after.position[i]);
  expect(a[0] * b[0] + a[2] * b[2]).toBeLessThan(0);
}

test('real forward taps climb all U risers, manual canvas U turn exits first floor and restores context', async ({ page }, info) => {
  const bearing = await fixture(page);
  await walkTo(page, bearing, 1, 7.4, 'ArrowDown', 'ArrowUp');
  const landing = await read(page);
  expect(landing.position[1]).toBeCloseTo(3.32, 1);
  expect(Math.abs(plan(landing.position, bearing)[1] - 7.4)).toBeLessThan(.065);
  await page.screenshot({ path: info.outputPath('stairs-landing.png'), fullPage: true });
  await page.reload(); await page.locator('.viewer canvas').focus(); await settle(page);
  expect((await read(page)).position).toEqual(landing.position);
  await walkTo(page, bearing, 0, 5.7875, 'ArrowRight', 'ArrowLeft');
  await turnAround(page);
  await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
  await page.locator('.viewer canvas').focus();
  await page.screenshot({ path: info.outputPath('stairs-upper-flight-facing.png'), fullPage: true });
  await walkTo(page, bearing, 1, 10.45, 'ArrowUp', 'ArrowDown');
  const final = await read(page);
  expect(final.position[1]).toBeCloseTo(5.02, 2);
  const facing = final.target.map((v, i) => v - final.position[i]);
  expect(facing[1]).toBeCloseTo(-.1, 5); expect(final.up).toEqual([0, 1, 0]); expect(final.zoom).toBe(1);
  await expect(page.locator('.notice')).toContainText('קומה ראשונה');
  await page.reload(); await settle(page);
  expect((await read(page)).position).toEqual(final.position);
  await expect(page.locator('.notice')).toContainText('קומה ראשונה');
  await page.screenshot({ path: info.outputPath('stairs-first-floor.png'), fullPage: true });
});

test('upper-floor bookmark descends with manual turn and exits to ground without selecting another room', async ({ page }, info) => {
  const bearing = await fixture(page, true);
  await expect(page.locator('.notice')).toContainText('קומה ראשונה');
  await walkTo(page, bearing, 1, 7.4, 'ArrowDown', 'ArrowUp');
  expect((await read(page)).position[1]).toBeCloseTo(3.32, 1);
  await walkTo(page, bearing, 0, 4.5925, 'ArrowRight', 'ArrowLeft');
  await turnAround(page);
  await walkTo(page, bearing, 1, 10.45, 'ArrowUp', 'ArrowDown');
  expect((await read(page)).position[1]).toBeCloseTo(1.62, 2);
  await expect(page.locator('.notice')).toContainText('קומת קרקע');
  await page.screenshot({ path: info.outputPath('stairs-ground-floor.png'), fullPage: true });
});

test('held touch moves, release and measurement cancel it; explicit free height does not snap down', async ({ page, isMobile }) => {
  await fixture(page);
  const initial = await read(page), button = page.getByRole('button', { name: 'קדימה', exact: true });
  const box = (await button.boundingBox())!;
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  else { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); }
  await settle(page, 350);
  if (touch) await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up();
  await settle(page);
  const moved = await read(page); expect(moved.position).not.toEqual(initial.position);
  await settle(page); expect(await read(page)).toEqual(moved);
  await page.locator('.viewer canvas').focus();
  await page.keyboard.down('PageUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('PageUp'); await settle(page);
  const free = await read(page); expect(free.position[1]).toBeGreaterThan(moved.position[1]);
  await settle(page); expect((await read(page)).position).toEqual(free.position);
  await page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true }).click();
  await page.keyboard.press('ArrowUp'); await settle(page); expect((await read(page)).position).toEqual(free.position);
  await page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true }).click();
  if (touch) {
    const again = (await button.boundingBox())!;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: again.x + again.width / 2, y: again.y + again.height / 2 }] });
    await settle(page, 80);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await settle(page); const cancelled = await read(page); await settle(page); expect(await read(page)).toEqual(cancelled);
  }
  await touch?.detach();
});

test('held keyboard movement stops on blur, dialogs ignore keys, and free height persists away from stairs', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await settle(page);
  const start = await read(page);
  await page.keyboard.down('w'); await settle(page, 350); await page.keyboard.up('w'); await settle(page);
  expect((await read(page)).position).not.toEqual(start.position);
  await page.keyboard.down('s'); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await settle(page);
  const stopped = await read(page); await settle(page); expect(await read(page)).toEqual(stopped); await page.keyboard.up('s');
  await page.locator('.viewer canvas').focus();
  await page.keyboard.press('PageUp'); await settle(page);
  const up = await read(page); expect(up.position[1]).toBeGreaterThan(stopped.position[1]);
  await page.reload(); await settle(page); expect((await read(page)).position).toEqual(up.position);
  await page.getByRole('button', { name: 'עורך 2D', exact: true }).click();
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('PageDown'); await settle(page);
  expect((await read(page)).position).toEqual(up.position);
});

for (const location of ['mid-flight', 'upper-floor'] as const) test(`${location} camera survives in-session time, model and render rebuilds and still walks`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const bearing = await fixture(page, location === 'upper-floor');
  if (location === 'mid-flight') {
    await walkTo(page, bearing, 1, 8.8, 'ArrowDown', 'ArrowUp');
    expect((await read(page)).position[1]).toBeGreaterThan(2);
    expect((await read(page)).position[1]).toBeLessThan(3.32);
    await expect(page.locator('.notice')).toContainText('מדרגות');
  }
  let before = await read(page);
  const evidence: { rebuild: string; before: Camera; after: Camera }[] = [];
  const nextDate = (await saved(page)).date === '2026-09-12' ? '2026-09-13' : '2026-09-12';
  await page.getByLabel('תאריך הסימולציה', { exact: true }).fill(nextDate);
  await expect.poll(async () => (await saved(page)).date).toBe(nextDate);
  let after = await stepAfterRebuild(page, before, bearing);
  evidence.push({ rebuild: 'date', before, after }); before = after;
  const minutes = (await saved(page)).minutes === 511 ? 512 : 511;
  await page.getByLabel('שעה מקומית בירושלים', { exact: true }).fill(minutes === 511 ? '08:31' : '08:32');
  await expect.poll(async () => (await saved(page)).minutes).toBe(minutes);
  after = await stepAfterRebuild(page, before, bearing);
  evidence.push({ rebuild: 'time', before, after }); before = after;
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  const parapet = (await saved(page)).buildings.south.parapet + .05;
  await page.getByRole('spinbutton', { name: /גובה מעקה גג.*ערך מספרי/ }).fill(String(parapet));
  await expect.poll(async () => (await saved(page)).buildings.south.parapet).toBe(parapet);
  after = await stepAfterRebuild(page, before, bearing);
  evidence.push({ rebuild: 'model', before, after }); before = after;
  await page.getByRole('tab', { name: 'מגרש', exact: true }).click();
  const grid = (await saved(page)).view.grid;
  await page.getByRole('checkbox', { name: 'הצגת רשת מגרש', exact: true }).click();
  await expect.poll(async () => (await saved(page)).view.grid).toBe(!grid);
  after = await stepAfterRebuild(page, before, bearing);
  evidence.push({ rebuild: 'render', before, after });
  expect(errors).toEqual([]);
  await info.attach('rebuild-cameras', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('rebuild-walk.png'), fullPage: true });
});

for (const entry of ['כניסה לחדר', 'סיור בחדר'] as const) test(`moving the occupied stair stops without relocation; explicit ${entry} recovers movement`, async ({ page }, info) => {
  const bearing = await fixture(page);
  await walkTo(page, bearing, 1, 8.8, 'ArrowDown', 'ArrowUp');
  const before = await read(page);
  await expect(page.locator('.notice')).toContainText('מדרגות');
  await page.getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await editor.getByLabel('יחידה לעריכה', { exact: true }).selectOption('south');
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('stair:stair-south-ground');
  await editor.getByLabel('מרכז מדרגות X', { exact: false }).fill('8');
  await editor.getByLabel('מרכז מדרגות Z', { exact: false }).fill('11');
  await editor.getByRole('button', { name: 'הזזת מדרגות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings.south.stairPosition).toEqual([8, 11]);
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('המיקום אינו תקף להליכה');
  await page.locator('.viewer canvas').focus();
  for (const key of ['ArrowUp', 'PageUp', 'ArrowRight']) await taps(page, key, 1);
  expect(await read(page)).toEqual(before);
  // Even restoring the geometry does not silently clear the invalid latch.
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await page.locator('.viewer canvas').focus(); await taps(page, 'ArrowUp', 1);
  expect(await read(page)).toEqual(before);
  await expect(page.locator('.notice')).toContainText('המיקום אינו תקף להליכה');
  await page.getByRole('button', { name: entry === 'כניסה לחדר' ? 'כניסה לחדר סלון · יחידה ב׳ · קדמית · קומת קרקע' : entry, exact: true }).click(); await settle(page);
  const recovered = await read(page);
  expect(recovered.position).not.toEqual(before.position);
  expect(recovered.position[1]).toBeCloseTo(1.62, 7);
  await expect(page.locator('.notice')).toContainText('קומת קרקע');
  await page.locator('.viewer canvas').focus(); await taps(page, 'ArrowUp', 1);
  expect((await read(page)).position).not.toEqual(recovered.position);
  await page.screenshot({ path: info.outputPath('explicit-recovery.png'), fullPage: true });
});

test('in-session workspace import reconciles an actually walked mid-stair camera before subsequent movement', async ({ page }, info) => {
  const bearing = await fixture(page);
  await walkTo(page, bearing, 1, 8.8, 'ArrowDown', 'ArrowUp');
  const reached = await read(page);
  const session = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), sessionKey);
  const project = await saved(page);
  // Legacy workspace import exercises the real UI without unrelated asset IO.
  // The bookmark comes from actual walking, never a fabricated progress pose.
  const buffer = Buffer.from(JSON.stringify({ format: 'dori-solar-workspace', version: 1, project, session }));
  await page.getByRole('button', { name: 'מבט על', exact: true }).click(); await settle(page);
  expect((await read(page)).position).not.toEqual(reached.position);
  await page.locator('.toolbar input[type=file]').setInputFiles({ name: 'walked-mid-stair.json', mimeType: 'application/json', buffer });
  await expect.poll(async () => (await saved(page)).view.mode).toBe('walk');
  await expect.poll(() => read(page)).toEqual(reached);
  await expect(page.locator('.notice')).toContainText('מדרגות');
  await stepAfterRebuild(page, reached, bearing);
  await page.screenshot({ path: info.outputPath('import-reconciled.png'), fullPage: true });
});

for (const location of ['last-tread', 'near-exit-floor'] as const) test(`PageUp on ${location} keeps an elevated bookmark and returns to floor walking`, async ({ page }) => {
  const bearing = await fixture(page, true);
  await walkTo(page, bearing, 1, location === 'last-tread' ? 9.87556 : 10.15, 'ArrowDown', 'ArrowUp');
  const start = await read(page); expect(start.position[1]).toBeCloseTo(5.02, 7);
  await expect(page.locator('.notice')).toContainText(location === 'last-tread' ? 'מדרגות' : 'קומה ראשונה');
  await taps(page, 'PageUp', 1);
  const up = await read(page); expect(up.position[1]).toBeGreaterThanOrEqual(5.10 - 1e-7);
  await settle(page); expect(await read(page)).toEqual(up);
  await page.reload(); await settle(page); expect(await read(page)).toEqual(up);
  await page.locator('.viewer canvas').focus();
  await walkTo(page, bearing, 1, 10.45, 'ArrowDown', 'ArrowUp');
  expect((await read(page)).position[1]).toBeCloseTo(up.position[1], 7);
  await expect(page.locator('.notice')).toContainText('קומה ראשונה');
  await taps(page, 'PageDown', 3);
  expect((await read(page)).position[1]).toBeCloseTo(5.02, 7);
  const grounded = await read(page); await taps(page, 'ArrowDown', 1);
  const moved = await read(page);
  expect(moved.position).not.toEqual(grounded.position); expect(moved.position[1]).toBeCloseTo(5.02, 7);
});
