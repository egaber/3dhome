import { expect, test, type Page, type Locator } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const saved = (page: Page): Promise<SimulationState> => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!));
const handle = (editor: Locator) => editor.getByRole('slider', { name: 'ידית סיבוב', exact: true });
async function open(page: Page, selection: string) {
  await page.goto('/');
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption(selection);
  // Keep the canvas spacious while testing direct manipulation on a phone.
  if (await toggle.isVisible()) await toggle.click();
  await expect(handle(editor)).toBeVisible();
  return editor;
}
async function turnPoints(editor: Locator, degrees: number) {
  const h = (await handle(editor).boundingBox())!;
  const pivot = await editor.locator('.cad-pivot').evaluate(element => {
    const point = new DOMPoint(0, 0).matrixTransform((element as SVGGraphicsElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  const start = { x: h.x + h.width / 2, y: h.y + h.height / 2 }, r = degrees * Math.PI / 180;
  const dx = start.x - pivot.x, dy = start.y - pivot.y;
  return { start, end: { x: pivot.x + dx * Math.cos(r) - dy * Math.sin(r), y: pivot.y + dx * Math.sin(r) + dy * Math.cos(r) } };
}
async function beginTurn(page: Page, editor: Locator, degrees = 40) {
  const { start, end } = await turnPoints(editor, degrees);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
}

for (const selection of ['furniture:a-living-sofa', 'wall:ground-wall-2-north', 'room:a-living', 'opening:added-north-east-glazing', 'stair:stair-north-ground']) {
  test(`rotation handle previews and commits one action for ${selection}`, async ({ page }, testInfo) => {
    const editor = await open(page, selection), before = await saved(page);
    const initialAngle = Number(await handle(editor).getAttribute('aria-valuenow'));
    const rect = (await handle(editor).boundingBox())!;
    expect(rect.width).toBeGreaterThanOrEqual(43.9); expect(rect.height).toBeGreaterThanOrEqual(43.9);
    expect(await handle(editor).evaluate(element => {
      const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await beginTurn(page, editor);
    await expect(editor.locator('.cad-angle-badge')).toBeVisible();
    await expect.poll(async () => Number(await handle(editor).getAttribute('aria-valuenow'))).not.toBe(initialAngle);
    expect(await saved(page)).toEqual(before);
    if (selection.startsWith('stair:')) await page.screenshot({ path: testInfo.outputPath('stair-rotation-handle.png') });
    await page.mouse.up();
    await expect.poll(() => saved(page)).not.toEqual(before);
    const after = await saved(page);
    await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
    await expect.poll(() => saved(page)).toEqual(before);
    await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
    await expect.poll(() => saved(page)).toEqual(after);
  });
}

for (const interruption of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
  test(`rotation handle cancels on ${interruption} without persisting a preview`, async ({ page }) => {
    const editor = await open(page, 'furniture:a-living-sofa'), before = await saved(page);
    await beginTurn(page, editor);
    await expect(editor.locator('.cad-angle-badge')).toBeVisible();
    if (interruption === 'Escape') await page.keyboard.press('Escape');
    else if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await editor.locator('.cad-canvas').dispatchEvent(interruption, { pointerId: 1 });
    await page.mouse.up();
    await expect(editor.locator('.cad-angle-badge')).toHaveCount(0);
    expect(await saved(page)).toEqual(before);
    await expect(editor.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeDisabled();
    await expect(editor).toBeVisible();
  });
}

test('handle click is a no-op, Shift drag snaps, and keyboard handle remains usable when zoomed', async ({ page }) => {
  const editor = await open(page, 'furniture:a-living-sofa'), before = await saved(page);
  await handle(editor).click(); expect(await saved(page)).toEqual(before);
  await page.keyboard.down('Shift'); await beginTurn(page, editor, 42); await page.mouse.up(); await page.keyboard.up('Shift');
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-living-sofa']?.rotation).toBe(45);
  await editor.getByRole('button', { name: 'התקרבות בתוכנית', exact: true }).click();
  const box = (await handle(editor).boundingBox())!;
  expect(box.width).toBeCloseTo(44, 1); expect(box.height).toBeCloseTo(44, 1);
  await handle(editor).focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-living-sofa']?.rotation).toBe(46);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-living-sofa']?.rotation).toBe(0);
});

test('stair body dragging moves its geometry, saves once, and survives reload', async ({ page }, testInfo) => {
  let editor = await open(page, 'stair:stair-north-ground');
  const before = await saved(page);
  const stair = () => editor.locator('.cad-canvas [data-object-id="stair-north-ground"] .cad-stair-boundary');
  const initialShape = await stair().getAttribute('points');
  const hit = editor.locator('.cad-stair-move-hit');
  const rect = (await hit.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 45, rect.y + rect.height / 2 + 20, { steps: 5 });
  await expect(stair()).not.toHaveAttribute('points', initialShape!);
  expect(await saved(page)).toEqual(before);
  await page.mouse.up(); await expect.poll(async () => (await saved(page)).buildings.north.stairPosition).toBeTruthy();
  const after = await saved(page), movedShape = await stair().getAttribute('points');
  expect(after.buildings.south).toEqual(before.buildings.south);
  expect(after.buildings.north.stairRotation).toBe(before.buildings.north.stairRotation);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click(); await expect.poll(() => saved(page)).toEqual(before);
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click(); await expect.poll(() => saved(page)).toEqual(after);
  await page.screenshot({ path: testInfo.outputPath('moved-stair-handles.png') });
  editor = await open(page, 'stair:stair-north-ground');
  await expect(stair()).toHaveAttribute('points', movedShape!); expect(await saved(page)).toEqual(after);
});

test('stair drag and rotation interruption cannot overwrite an undo', async ({ page }) => {
  const editor = await open(page, 'stair:stair-north-ground'), before = await saved(page);
  const rect = (await editor.locator('.cad-stair-move-hit').boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2, { steps: 3 });
  await page.keyboard.press('Escape'); await page.mouse.up(); expect(await saved(page)).toEqual(before);
  await beginTurn(page, editor); await page.mouse.up(); await expect.poll(() => saved(page)).not.toEqual(before);
  await beginTurn(page, editor, 20);
  await page.keyboard.press('Control+z'); await page.mouse.up();
  await expect.poll(() => saved(page)).toEqual(before);
});

test('rotation handle accepts touch dragging without scrolling the plan', async ({ page }) => {
  const editor = await open(page, 'furniture:a-living-sofa'), before = await saved(page);
  const { start, end } = await turnPoints(editor, 35);
  const viewport = await editor.locator('.cad-canvas').getAttribute('viewBox');
  const touch = await page.context().newCDPSession(page);
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x, y: end.y }] });
    await expect(editor.locator('.cad-angle-badge')).toBeVisible();
    expect(await saved(page)).toEqual(before);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-living-sofa']?.rotation).toBeGreaterThan(25);
    await expect(editor.locator('.cad-canvas')).toHaveAttribute('viewBox', viewport!);
  } finally { await touch.detach(); }
});