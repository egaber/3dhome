import { expect, test, type Page, type Locator } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const saved = (page: Page): Promise<SimulationState> => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!));
const editorFor = (page: Page) => page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית' });
async function openEditor(page: Page) {
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = editorFor(page); await expect(editor).toBeVisible(); return editor;
}
async function expand(editor: Locator) {
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
async function historyCount(page: Page, editor: Locator, count: number) {
  await editor.getByRole('button', { name: 'היסטוריית פעולות', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'היסטוריית פעולות', exact: true });
  await expect(history.getByRole('listitem')).toHaveCount(count);
  await history.getByRole('button', { name: 'סגירת היסטוריה' }).click();
  await expect(editor.getByRole('button', { name: 'היסטוריית פעולות', exact: true })).toBeFocused();
}
async function select(editor: Locator, value: string) { await expand(editor); await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption(value); }
async function wallPoint(editor: Locator) {
  return editor.locator('.editor-wall').first().evaluate(element => {
    const polygon = element as SVGPolygonElement, p = polygon.points, matrix = polygon.getScreenCTM()!;
    const center = new DOMPoint(Array.from(p).reduce((n, p) => n + p.x, 0) / p.length, Array.from(p).reduce((n, p) => n + p.y, 0) / p.length).matrixTransform(matrix);
    return { x: center.x, y: center.y };
  });
}

for (const interruption of ['click', 'Escape', 'pointercancel', 'lostpointercapture', 'blur']) test(`CAD local draft cancellation: ${interruption}`, async ({ page }) => {
  await page.goto('/'); const editor = await openEditor(page), before = await saved(page);
  const svg = editor.locator('.cad-canvas');
  const p = await wallPoint(editor);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  if (interruption !== 'click') {
    await page.mouse.move(p.x + 30, p.y + 20, { steps: 4 });
    await expect.poll(() => saved(page)).toEqual(before);
    if (interruption === 'Escape') await page.keyboard.press('Escape');
    else if (interruption === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await svg.dispatchEvent(interruption, { pointerId: 1 });
  }
  await page.mouse.up(); await expect.poll(() => saved(page)).toEqual(before);
  await expect(editor).toBeVisible(); await historyCount(page, editor, 1);
});

test('CAD committed drag and interrupted undo share history across reopen', async ({ page }) => {
  await page.goto('/'); const editor = await openEditor(page), before = await saved(page);
  const p = await wallPoint(editor);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 32, p.y + 24, { steps: 5 });
  await expect.poll(() => saved(page)).toEqual(before); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).design).not.toEqual(before.design);
  const after = await saved(page); await historyCount(page, editor, 2);
  // Undo during a subsequent draft must not be overwritten by the eventual release.
  const q = await wallPoint(editor);
  await page.mouse.move(q.x, q.y); await page.mouse.down(); await page.mouse.move(q.x + 30, q.y + 20);
  await page.keyboard.press('Control+z'); await page.mouse.up();
  await expect.poll(() => saved(page)).toEqual(before);
  await editor.getByRole('button', { name: 'סגירת עורך' }).click();
  await expect(page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true })).toBeFocused();
  await openEditor(page); await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(after);
});

test('CAD numeric measurement, units, layers and fit are local', async ({ page }) => {
  await page.goto('/'); const initial = await saved(page);
  initial.buildings.north.width = 17; initial.buildings.north.depth = 5; initial.buildings.north.rotation = 31;
  await page.evaluate(state => localStorage.setItem('dori-solar-studio-v1', JSON.stringify(state)), initial);
  await page.reload(); const editor = await openEditor(page), before = await saved(page);
  await editor.getByRole('button', { name: 'מדידה', exact: true }).click();
  await editor.getByLabel('מדידה A · X', { exact: false }).fill('0'); await editor.getByLabel('מדידה A · Z', { exact: false }).fill('0');
  await editor.getByLabel('מדידה B · X', { exact: false }).fill('3'); await editor.getByLabel('מדידה B · Z', { exact: false }).fill('4');
  await editor.getByRole('button', { name: 'מדידת נקודות', exact: true }).click();
  await expect(editor.locator('.cad-measure-result')).toHaveText('מרחק 5.00 מ׳');
  await editor.getByRole('button', { name: 'התקרבות בתוכנית' }).click(); await editor.getByRole('button', { name: 'התאמה', exact: true }).click();
  await expect(editor.locator('.cad-measure-result')).toHaveText('מרחק 5.00 מ׳');
  await editor.getByLabel('יחידות תצוגה').selectOption('mm');
  await expect(editor.locator('.cad-measure-result')).toHaveText('מרחק 5000 מ״מ');
  await editor.getByLabel('ריהוט', { exact: true }).uncheck(); await expect(editor.locator('.cad-furniture')).toHaveCount(0);
  await expect(editor.getByLabel('בחירת אובייקט', { exact: true }).locator('option[value^="furniture:"]')).toHaveCount(0);
  await editor.getByLabel('קירות ופתחים', { exact: true }).uncheck(); await expect(editor.locator('.editor-wall')).toHaveCount(0);
  await editor.getByLabel('קירות ופתחים', { exact: true }).check();
  await editor.getByLabel('יחידות תצוגה').selectOption('m');
  await expect.poll(() => saved(page)).toEqual(before); await historyCount(page, editor, 1);
  await editor.getByLabel('קומה לעריכה').selectOption('first'); await expect(editor.locator('.cad-measurement circle')).toHaveCount(0);
});

test('CAD clicked measurement uses actual transformed model metres and is local', async ({ page }) => {
  await page.goto('/'); const initial = await saved(page);
  initial.buildings.north.width = 17; initial.buildings.north.depth = 5; initial.buildings.north.rotation = 31;
  await page.evaluate(state => localStorage.setItem('dori-solar-studio-v1', JSON.stringify(state)), initial);
  await page.reload(); const editor = await openEditor(page), before = await saved(page);
  await editor.getByRole('button', { name: 'מדידה', exact: true }).click();
  // Both clicks use real SVG inverse screen mapping. The expected value comes from markers, not screenshot pixels.
  await editor.getByLabel('הצמדה ל־25 ס״מ').uncheck();
  const svg = editor.locator('.cad-canvas'), box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .45);
  await page.mouse.click(box.x + box.width * .65, box.y + box.height * .6);
  const distance = await editor.locator('.cad-measurement circle').evaluateAll(circles => {
    const [a, b] = circles.map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    return Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(2);
  });
  await expect(editor.locator('.cad-measure-result')).toHaveText(`מרחק ${distance} מ׳`);
  await expect.poll(() => saved(page)).toEqual(before); await historyCount(page, editor, 1);
  await editor.getByLabel('קומה לעריכה').selectOption('first'); await expect(editor.locator('.cad-measurement circle')).toHaveCount(0);
});

test('CAD independent furniture drafts reject invalid input and keep typing shortcuts native', async ({ page }) => {
  await page.goto('/'); const editor = await openEditor(page), before = await saved(page);
  await select(editor, 'furniture:a-kitchen-sink');
  const width = editor.getByLabel('רוחב פריט', { exact: false });
  await width.fill('-1'); await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect(editor.getByRole('alert')).toBeVisible(); await expect.poll(() => saved(page)).toEqual(before);
  const prevented = await width.evaluate(element => {
    const events = ['Delete', 'ArrowUp', '+', 'z'].map(key => new KeyboardEvent('keydown', { key, ctrlKey: key === 'z', bubbles: true, cancelable: true }));
    events.forEach(e => element.dispatchEvent(e)); return events.map(e => e.defaultPrevented);
  });
  expect(prevented).toEqual([false, false, false, false]);
  await width.fill('0.75'); await editor.getByLabel('מרכז X', { exact: false }).fill('2.5');
  await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-kitchen-sink']?.width).toBe(.75);
  const after = await saved(page); expect(Object.keys(after.design.furnitureEdits)).toEqual(['a-kitchen-sink']);
  expect(after.design.roomEdits).toEqual(before.design.roomEdits); expect(after.design.wallEdits).toEqual(before.design.wallEdits);
  await historyCount(page, editor, 2);
  await editor.getByText('הוספת ריהוט ומכשירים', { exact: true }).click(); await editor.getByLabel('פריט להוספה').selectOption('armchair');
  await editor.getByRole('button', { name: 'הוספת פריט', exact: true }).click();
  await expect.poll(async () => (await saved(page)).design.addedFurniture.at(-1)?.kind).toBe('armchair');
  await editor.getByRole('button', { name: 'מחיקת אובייקט', exact: true }).click();
  await expect(editor.locator('.cad-furniture[data-kind="armchair"]')).toHaveCount(0);
});

test('CAD hosted window add edit delete persists after reload', async ({ page }) => {
  await page.goto('/'); const editor = await openEditor(page);
  await select(editor, 'wall:ground-wall-2-north');
  await editor.getByRole('button', { name: 'הוספת חלון לקיר' }).click();
  const id = (await saved(page)).addedOpenings.find(o => o.id.startsWith('cad-window-'))?.id;
  expect(id).toBeTruthy();
  await editor.getByLabel('רוחב פתח', { exact: false }).fill('0.8'); await editor.getByLabel('גובה אדן', { exact: false }).fill('1.1');
  await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).openings[id!]?.width).toBe(.8);
  await editor.getByRole('button', { name: 'מחיקת אובייקט', exact: true }).click();
  await expect(editor.locator(`[data-object-id="${id}"]`)).toHaveCount(0);
  await page.reload(); const reopened = await openEditor(page);
  await expect(reopened.locator(`[data-object-id="${id}"]`)).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).openings[id!]?.width).toBe(0);
});

test('CAD stair alternatives share scale and change both connections', async ({ page }, testInfo) => {
  await page.goto('/'); const editor = await openEditor(page); await expand(editor);
  await editor.getByRole('button', { name: 'גרם ישר רציף', exact: false }).click();
  await expect.poll(async () => (await saved(page)).buildings.north.stairLayout).toBe('straight');
  await editor.getByLabel('חיבור מדרגות').selectOption('basement');
  await expect(editor.getByRole('button', { name: 'גרם ישר רציף', exact: false })).toHaveAttribute('aria-pressed', 'true');
  const scales = await editor.locator('.cad-stair-options svg').evaluateAll(elements => elements.map(e => e.getAttribute('viewBox')));
  expect(scales[0]).toBe(scales[1]);
  await expect(editor.locator('.cad-floor-levels')).toContainText('גובה פנוי');
  await page.screenshot({ path: testInfo.outputPath('cad-straight-plan.png') });
});

for (const width of [393, 360]) test(`CAD viewport-contained modal and reachable actions at ${width}`, async ({ page }, testInfo) => {
  await page.goto('/'); const editor = await openEditor(page);
  await page.setViewportSize({ width, height: 851 }); await expand(editor);
    const box = (await editor.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(851);
    expect((await editor.locator('.cad-canvas').boundingBox())!.height).toBeGreaterThan(140);
    const rectangles = await editor.locator('.cad-top-controls button, .cad-tools button, .cad-pan-buttons button, .cad-details-toggle').evaluateAll(buttons => buttons.map(button => {
      const r = button.getBoundingClientRect(); return { x: r.x, width: r.width, height: r.height };
    }));
    expect(rectangles.length).toBeGreaterThan(10);
    for (const rect of rectangles) {
      expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    }
  await page.screenshot({ path: testInfo.outputPath(`cad-${width}.png`) });
});

test('CAD keyboard focus remains inside the ordinary modal', async ({ page }) => {
  await page.goto('/'); const editor = await openEditor(page); await expand(editor);
  await editor.getByRole('button', { name: 'סגירת עורך' }).focus();
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await editor.evaluate(e => e.contains(document.activeElement))).toBe(true); }
});

test('CAD disables unavailable units and floors', async ({ page }) => {
  await page.goto('/');
  const state = await saved(page); state.buildings.north.storeys = 1; state.buildings.south.enabled = false;
  await page.evaluate(s => localStorage.setItem('dori-solar-studio-v1', JSON.stringify(s)), state); await page.reload();
  const editor = await openEditor(page);
  // Playwright's ARIA disabled matcher does not reflect native option.disabled here.
  await expect(editor.getByLabel('קומה לעריכה').locator('option[value="first"]')).toHaveJSProperty('disabled', true);
  await expect(editor.getByLabel('יחידה לעריכה').locator('option[value="south"]')).toHaveJSProperty('disabled', true);
  await editor.getByLabel('קומה לעריכה').focus(); await page.keyboard.press('End');
  await expect(editor.getByLabel('קומה לעריכה')).toHaveValue('ground');
});

test('CAD unchanged transformed numeric drafts and zero translations do not add history', async ({ page }) => {
  await page.goto('/'); const state = await saved(page);
  state.buildings.north.rotation = 27; state.buildings.north.width = 16.37; state.buildings.north.depth = 5.23;
  await page.evaluate(s => localStorage.setItem('dori-solar-studio-v1', JSON.stringify(s)), state); await page.reload();
  const editor = await openEditor(page), before = await saved(page);
  await select(editor, 'wall:ground-wall-2-north'); await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await editor.getByRole('button', { name: 'הזזת קיר', exact: true }).click();
  await select(editor, 'furniture:a-kitchen-sink'); await editor.getByLabel('יחידות תצוגה').selectOption('mm');
  await editor.getByRole('button', { name: 'החלת מידות', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(before); await historyCount(page, editor, 1);
});

for (const theme of ['light', 'dark']) test(`CAD ${theme} drafting closeup and cursor zoom/pan remain local`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/?clawpilotTheme=${theme}`); const editor = await openEditor(page), before = await saved(page);
  const svg = editor.locator('.cad-canvas');
  // Locate the kitchen appliance in model SVG space, not by screenshot measurements.
  const anchor = await editor.locator('[data-object-id="a-kitchen-cooktop"]').evaluate(element => {
    const matrix = (element as SVGGraphicsElement).getScreenCTM()!, p = new DOMPoint(0, 0).matrixTransform(matrix);
    // WheelEvent inherits integer client coordinates from MouseEvent. Use that same
    // physical cursor for the before/after comparison, not a fractional SVG center.
    return { x: Math.trunc(p.x), y: Math.trunc(p.y) };
  });
  const modelPoint = () => svg.evaluate((element, p) => {
    const q = new DOMPoint(p.x, p.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!.inverse()); return [q.x, q.y];
  }, anchor);
  const beforePoint = await modelPoint();
  await page.mouse.move(anchor.x, anchor.y);
  await svg.evaluate((element, p) => {
    for (let i = 0; i < 12; i++) element.dispatchEvent(new WheelEvent('wheel', { clientX: p.x, clientY: p.y, deltaY: -100, bubbles: true, cancelable: true }));
  }, anchor);
  const afterPoint = await modelPoint(); expect(afterPoint[0]).toBeCloseTo(beforePoint[0], 6); expect(afterPoint[1]).toBeCloseTo(beforePoint[1], 6);
  await expect(svg).toHaveAttribute('viewBox', /./);
  const zoomedWidth = await svg.evaluate(e => (e as SVGSVGElement).viewBox.baseVal.width); expect(zoomedWidth).toBeLessThan(4);
  const background = await svg.evaluate(e => ({ actual: getComputedStyle(e).backgroundColor, token: getComputedStyle(document.documentElement).getPropertyValue('--cp-surface').trim() }));
  expect(background.token).not.toBe('');
  await page.screenshot({ path: testInfo.outputPath(`cad-kitchen-${theme}.png`) });
  const viewBeforePan = await svg.getAttribute('viewBox');
  await editor.getByRole('button', { name: 'מבט שמאלה', exact: true }).click(); await expect(svg).not.toHaveAttribute('viewBox', viewBeforePan!);
  await editor.getByRole('button', { name: 'התאמה', exact: true }).click();
  expect(await svg.evaluate(e => (e as SVGSVGElement).viewBox.baseVal.width)).toBeGreaterThan(zoomedWidth);
  await expect.poll(() => saved(page)).toEqual(before); expect(errors).toEqual([]);
});