import { expect, test, type Locator, type Page } from '@playwright/test';
import * as THREE from 'three';
import type { SimulationState } from '../src/model/types';

const KEY = 'dori-solar-studio-v1', SESSION = 'dori-solar-studio-session-v1';
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
const dimensions = (page: Page) => page.locator('.cad-overall-dimensions');
const sizes = (project: string) => project === 'mobile' ? [{ width: 360, height: 800 }, { width: 393, height: 851 }] : [{ width: 1440, height: 1000 }];
async function openEditor(page: Page) {
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  return page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
}
async function expand(editor: Locator) {
  const button = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await button.isVisible() && await button.getAttribute('aria-expanded') === 'false') await button.click();
}
async function noOverlap(a: Locator, b: Locator) {
  // Chromium's protocol box inflates SVG text by model-scaled stroke even with
  // non-scaling-stroke. Client rect + explicit 2px halo matches painted bounds.
  const rect = (locator: Locator) => locator.evaluate(e => {
    const r = e.getBoundingClientRect(), halo = e instanceof SVGGraphicsElement && !(e instanceof SVGSVGElement) ? 2 : 0;
    return { x: r.x - halo, y: r.y - halo, width: r.width + 2 * halo, height: r.height + 2 * halo };
  });
  const x = await rect(a), y = await rect(b);
  expect(x).not.toBeNull(); expect(y).not.toBeNull();
  expect(Math.min(x.x + x.width, y.x + y.width) <= Math.max(x.x, y.x) + .5 ||
    Math.min(x.y + x.height, y.y + y.height) <= Math.max(x.y, y.y) + .5, `${await a.getAttribute('class')} overlaps ${await b.getAttribute('class')}`).toBe(true);
}
/** Visibility includes clipping ancestors and actual hit testing, not just a DOM box. */
async function reachable(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(await locator.evaluate(e => {
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const target = document.elementFromPoint(x, y);
    if (!target || !(e.contains(target) || target.contains(e))) return false;
    for (let parent = e.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), p = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < p.top - 1 || r.bottom > p.bottom + 1)) return false;
    }
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  })).toBe(true);
}
async function fitBounds(page: Page, editor: Locator) {
  await editor.getByRole('button', { name: 'התאמה', exact: true }).click();
  await expect(dimensions(page).locator('text')).toHaveCount(2);
  await expect.poll(() => dimensions(page).locator('path, text').evaluateAll(elements => elements.every(e => {
    const r = e.getBoundingClientRect(), svg = (e as SVGGraphicsElement).ownerSVGElement!.getBoundingClientRect();
    // Leave stroke/halo breathing room; no fragile expected screenshot coordinates.
    return r.left >= svg.left + 2 && r.right <= svg.right - 2 && r.top >= svg.top + 2 && r.bottom <= svg.bottom - 2;
  }))).toBe(true);
  const metrics = await editor.locator('.cad-canvas').evaluate(e => {
    const svg = e as SVGSVGElement, m = svg.getScreenCTM()!, style = getComputedStyle(svg);
    return { x: m.a, y: m.d, padding: style.padding, height: svg.getBoundingClientRect().height };
  });
  expect(metrics.x / metrics.y).toBeCloseTo(1, 6); expect(metrics.padding).toBe('0px'); expect(metrics.height).toBeGreaterThan(140);
  for (const text of await dimensions(page).locator('text').all()) {
    expect(await text.evaluate(e => parseFloat(getComputedStyle(e).fontSize) * Math.hypot((e as SVGGraphicsElement).getScreenCTM()!.a, (e as SVGGraphicsElement).getScreenCTM()!.b))).toBeGreaterThanOrEqual(11.9);
  }
  await noOverlap(editor.locator('.cad-pan-buttons'), editor.locator('.cad-canvas'));
  for (const annotation of await dimensions(page).locator('path, text').all()) await noOverlap(editor.locator('.cad-pan-buttons'), annotation);
  for (const button of await editor.locator('.cad-pan-buttons button').all()) {
    const r = (await button.boundingBox())!; expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44); await reachable(button);
  }
}

for (const theme of ['light', 'dark']) test(`CAD annotation Fit and kitchen ${theme}`, async ({ page }, info) => {
  for (const size of sizes(info.project.name)) {
    await page.setViewportSize(size); await page.goto(`/?clawpilotTheme=${theme}`);
    const editor = await openEditor(page), before = await saved(page);
    await expand(editor); await fitBounds(page, editor);
    await page.screenshot({ path: info.outputPath(`overview-${size.width}-${theme}.png`), scale: 'css' });
    await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('room:a-wc');
    const room = editor.locator('.cad-room-label[aria-label="חדר שירותי אורחים"]');
    await expect(room).toHaveAttribute('data-label-culled', 'true'); await expect(room.locator('text')).toHaveCount(0);
    await expect(editor.locator('.cad-properties')).toContainText('שירותי אורחים');
    await expect(editor.locator('[data-object-id="a-wc-toilet"]')).toHaveCount(1);
    await expect(editor.locator('[data-object-id="a-wc-basin"]')).toHaveCount(1);
    await editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption('');
    const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
    if (await toggle.isVisible()) await toggle.click();
    await editor.getByRole('button', { name: 'התאמה', exact: true }).click();
    const svg = editor.locator('.cad-canvas');
    const anchor = await editor.locator('[data-object-id="a-kitchen-cooktop"]').evaluate(e => {
      const p = new DOMPoint().matrixTransform((e as SVGGraphicsElement).getScreenCTM()!); return { x: p.x, y: p.y };
    });
    await svg.evaluate((e, p) => { for (let i = 0; i < 10; i++) e.dispatchEvent(new WheelEvent('wheel', { clientX: p.x, clientY: p.y, deltaY: -100, bubbles: true, cancelable: true })); }, anchor);
    const grid = await svg.locator('pattern[id$="grid"] path').evaluate(e => ({ effect: getComputedStyle(e).vectorEffect, width: parseFloat(getComputedStyle(e).strokeWidth), opacity: Number(getComputedStyle(e).strokeOpacity) }));
    expect(grid.effect).toBe('non-scaling-stroke'); expect(grid.width).toBeLessThanOrEqual(1); expect(grid.opacity).toBeLessThan(.7);
    await page.screenshot({ path: info.outputPath(`kitchen-${size.width}-${theme}.png`), scale: 'css' });
    await expect.poll(() => saved(page)).toEqual(before);
    await editor.getByRole('button', { name: 'סגירת עורך' }).click();
    const transformed = structuredClone(before); Object.assign(transformed.buildings.north, { rotation: 31, width: 17, depth: 5 });
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state: transformed });
    await page.reload(); const rotated = await openEditor(page); await expand(rotated); await fitBounds(page, rotated);
    await page.screenshot({ path: info.outputPath(`fit-transformed-${size.width}-${theme}.png`), scale: 'css' });
    await rotated.getByRole('button', { name: 'סגירת עורך' }).click();
    await page.evaluate(() => localStorage.clear());
  }
});

async function setupViewer(page: Page, theme: string) {
  await page.goto(`/?clawpilotTheme=${theme}`); const s = await saved(page);
  s.northBearing = 0; s.view.mode = 'plan'; s.view.isolateFloor = 'ground'; s.view.planVisible = false; s.view.path = false; s.view.dimensions = false;
  s.buildings.north.stairLayout = 'straight';
  await page.evaluate(({ s, KEY, SESSION }) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem(SESSION, JSON.stringify({ camera: { position: [6, 30, 3], target: [6, 0, 3], up: [0, 0, -1] }, selectedUnit: 'north', selectedRoom: 'a-living', selectedOpening: null, chat: [] }));
  }, { s, KEY, SESSION });
  await page.reload(); await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
  return s;
}
async function screenPoint(page: Page, point: number[]) {
  const bookmark = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).camera as { position: number[]; target: number[]; up: number[]; zoom?: number }, SESSION);
  const box = (await page.locator('.viewer canvas').boundingBox())!;
  const camera = new THREE.PerspectiveCamera(48, box.width / box.height, .05, 500);
  camera.position.fromArray(bookmark.position); camera.up.fromArray(bookmark.up); camera.lookAt(new THREE.Vector3().fromArray(bookmark.target));
  camera.zoom = bookmark.zoom ?? 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const p = new THREE.Vector3().fromArray(point).project(camera);
  return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 };
}
async function controlsClear(page: Page, panel: Locator) {
  for (const selector of ['.zoom-controls', '.view-modes', '.render-modes', '.viewer-measure-toggle', '.stage-status']) await noOverlap(panel, page.locator(selector));
  for (const selector of ['.view-modes', '.render-modes', '.zoom-controls', '.viewer-measure-toggle']) {
    await noOverlap(page.locator(selector), page.locator('.site-warning'));
  }
  if (await page.locator('.hint').isVisible()) await noOverlap(page.locator('.hint'), page.locator('.notice'));
  await reachable(page.getByRole('button', { name: 'התקרבות', exact: true }));
  await reachable(page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true }));
  await reachable(page.locator('.site-warning summary'));
}
for (const theme of ['light', 'dark']) test(`CAD quick stairs and measurement slots ${theme}`, async ({ page }, info) => {
  for (const size of sizes(info.project.name)) {
    await page.setViewportSize(size); const s = await setupViewer(page, theme);
    const editor = await openEditor(page);
    const center = await editor.locator('[data-object-id="stair-north-ground"] rect').first().evaluate(e => {
      const shape = e as SVGGraphicsElement, b = shape.getBBox();
      const p = new DOMPoint(b.x + b.width / 2, b.y + b.height / 2).matrixTransform(shape.getScreenCTM()!).matrixTransform(shape.ownerSVGElement!.getScreenCTM()!.inverse());
      return [p.x, p.y];
    });
    await editor.getByRole('button', { name: 'סגירת עורך' }).click();
    const point = await screenPoint(page, [center[0], s.buildings.north.groundHeight / 18, center[1]]);
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, point)).toBe('CANVAS');
    await page.mouse.dblclick(point.x, point.y);
    const quick = page.getByRole('region', { name: 'עריכה מהירה של אובייקט', exact: true }); await expect(quick).toBeVisible();
    await expect(quick.locator('.cad-object-id')).toHaveText('stair-north-ground'); await controlsClear(page, quick);
    await quick.getByRole('button', { name: 'מדרגות U', exact: false }).scrollIntoViewIfNeeded();
    await reachable(quick.getByRole('button', { name: 'סגירת עריכה מהירה' }));
    await page.screenshot({ path: info.outputPath(`quick-stairs-${size.width}-${theme}.png`), scale: 'css' });
    await page.locator('.site-warning summary').click(); await controlsClear(page, quick);
    await page.locator('.site-warning summary').click();
    await quick.getByRole('button', { name: 'סגירת עריכה מהירה' }).click();
    await page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true }).click();
    const p = page.getByRole('region', { name: 'כלי מדידה בתלת־ממד', exact: true });
    await p.locator('summary').click();
    for (const [label, value] of [['A · X', '0'], ['A · Y', '0'], ['A · Z', '0'], ['B · X', '3'], ['B · Y', '4'], ['B · Z', '0']]) await p.getByLabel(label, { exact: false }).fill(value);
    await p.getByRole('button', { name: 'מדידת XYZ', exact: true }).click();
    await expect(p.locator('.viewer-measure-result')).toContainText('5.00');
    await reachable(p.locator('.viewer-measure-result')); await reachable(p.locator('.cad-floor-levels'));
    await controlsClear(page, p);
    await page.screenshot({ path: info.outputPath(`measurement-numeric-${size.width}-${theme}.png`), scale: 'css' });
    await p.getByLabel('B · X', { exact: false }).fill('1001'); await p.getByRole('button', { name: 'מדידת XYZ', exact: true }).click();
    await expect(p.getByRole('alert')).toBeVisible(); await reachable(p.locator('.viewer-measure-result')); await expect(p.locator('.viewer-measure-result')).toContainText('5.00');
    // Choose two genuine, visible furniture surfaces and capture world markers/line.
    await p.getByRole('button', { name: 'ניקוי מדידה', exact: true }).click();
    for (const world of [[9.6, .43, 2.95], [5.85, .82, 1.9]]) {
      const target = await screenPoint(page, world);
      expect(await page.evaluate(q => document.elementFromPoint(q.x, q.y)?.tagName, target)).toBe('CANVAS');
      await page.mouse.click(target.x, target.y);
    }
    await expect(p.locator('[data-measure-point]')).toHaveCount(2);
    await reachable(p.locator('.viewer-measure-result'));
    await page.screenshot({ path: info.outputPath(`measurement-picked-${size.width}-${theme}.png`), scale: 'css' });
    await page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true }).click();
    await page.evaluate(() => localStorage.clear());
  }
});