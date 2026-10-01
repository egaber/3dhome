import { expect, test, type Page } from '@playwright/test';
import * as THREE from 'three';
import type { SimulationState } from '../src/model/types';

const KEY = 'dori-solar-studio-v1', SESSION = 'dori-solar-studio-session-v1';
const MIGRATION_KEYS = ['dori-south-attic-v1', 'dori-south-east-room-windows-v1', 'dori-north-corner-glazing-v1'];
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY);
const panel = (page: Page) => page.getByRole('region', { name: 'כלי מדידה בתלת־ממד', exact: true });
const measure = (page: Page) => page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true });
const quick = (page: Page) => page.getByRole('region', { name: 'עריכה מהירה של אובייקט', exact: true });

/** Seed only public persistence, never inject runtime/test-only hooks. A downward
 * camera and isolated ground expose genuine CAD meshes at desktop AND mobile. */
async function setup(page: Page, transform = false) {
  // Only type imports from the app: its image dependency graph is Vite-only.
  await page.goto('/'); await expect(page.locator('.viewer canvas')).toBeVisible();
  const s = await saved(page);
  s.northBearing = transform ? 42 : 0;
  s.view.mode = 'plan'; s.view.isolateFloor = 'ground'; s.view.planVisible = false; s.view.path = false; s.view.dimensions = false;
  if (transform) Object.assign(s.buildings.north, { rotation: 27, width: 16, depth: 5, x: 2, z: -3 });
  const center = worldPoint([6, 3], 0, s);
  const camera = { position: [center[0], 30, center[2]], target: [center[0], 0, center[2]], up: [0, 0, -1] };
  await page.evaluate(({ s, camera, KEY, SESSION, migrations }) => {
    localStorage.setItem(KEY, JSON.stringify(s));
    localStorage.setItem(SESSION, JSON.stringify({ camera, selectedUnit: 'north', selectedRoom: 'a-living', selectedOpening: null, chat: [] }));
    for (const key of migrations) localStorage.setItem(key, 'done');
  }, { s, camera, KEY, SESSION, migrations: [...MIGRATION_KEYS] });
  await page.reload(); await expect(page.locator('.viewer canvas')).toBeVisible();
  await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(s);
  return s;
}
function worldPoint(point: [number, number], y: number, s: SimulationState): [number, number, number] {
  const b = s.buildings.north, r = b.rotation * Math.PI / 180, n = s.northBearing * Math.PI / 180;
  const x = point[0] * b.width / 11.89, z = (point[1] - 6.84) * b.depth / 6.84;
  const px = x * Math.cos(r) - z * Math.sin(r) + b.x, pz = x * Math.sin(r) + z * Math.cos(r) + 6.84 + b.z;
  return [px * Math.cos(n) - pz * Math.sin(n), y, px * Math.sin(n) + pz * Math.cos(n)];
}
async function cameraFor(page: Page) {
  const bookmark = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).camera as { position: number[]; target: number[]; up: number[]; zoom?: number }, SESSION);
  const box = (await page.locator('.viewer canvas').boundingBox())!;
  const camera = new THREE.PerspectiveCamera(48, box.width / box.height, .05, 500);
  camera.position.fromArray(bookmark.position); camera.up.fromArray(bookmark.up); camera.lookAt(new THREE.Vector3().fromArray(bookmark.target));
  camera.zoom = bookmark.zoom ?? 1; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { camera, box };
}
async function screenPoint(page: Page, point: THREE.Vector3) {
  const { camera, box } = await cameraFor(page), p = point.clone().project(camera);
  return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 };
}
/** Known public model coordinates, projected through the saved camera; no runtime
 * hooks or test-only pick targets. The real browser must select the expected ID. */
async function objectPoint(page: Page, id: string) {
  const s = await saved(page);
  if (id === 'a-living-sofa') return screenPoint(page, new THREE.Vector3(...worldPoint([9.6, 2.95], .43, s)));
  if (id === 'a-kitchen-sink') return screenPoint(page, new THREE.Vector3(...worldPoint([.73, 3.002], .96, s)));
  if (id === 'a-dining-table') return screenPoint(page, new THREE.Vector3(...worldPoint([5.85, 1.9], .82, s)));
  // Read precise plan wall/stair geometry from the actual accessible 2D editor,
  // not guessed image pixels; the SVG root is plan metres after house transforms.
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  const selector = id.startsWith('stair') ? `[data-object-id="${id}"] rect` : `[data-object-id="${id}"]`;
  const plan = await editor.locator(`.cad-canvas ${selector}`).first().evaluate(element => {
    const shape = element as SVGGraphicsElement, root = shape.ownerSVGElement!, bounds = shape.getBBox();
    const p = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      .matrixTransform(shape.getScreenCTM()!).matrixTransform(root.getScreenCTM()!.inverse());
    return [p.x, p.y];
  });
  await editor.getByRole('button', { name: 'סגירת עורך' }).click();
  const r = s.northBearing * Math.PI / 180;
  const y = id.startsWith('stair') ? s.buildings.north.groundHeight / 18 : id.startsWith('added') ? 2.65 : s.buildings.north.groundHeight;
  const world = new THREE.Vector3(plan[0] * Math.cos(r) - plan[1] * Math.sin(r), y, plan[0] * Math.sin(r) + plan[1] * Math.cos(r));
  if (id.startsWith('added')) {
    // A top ray correctly hits the lintel, not glass beneath it. Use a genuine
    // horizontal east-facade view for opening selection, and remove neighbor
    // obstruction through its ordinary persisted setting.
    const target = world.clone(); target.y = 1.3;
    const camera = { position: target.clone().add(new THREE.Vector3(6, 0, 0)).toArray(), target: target.toArray(), up: [0, 1, 0] };
    s.neighbors.forEach(n => { n.enabled = false; });
    await page.evaluate(({ s, camera, KEY, SESSION }) => {
      localStorage.setItem(KEY, JSON.stringify(s)); const session = JSON.parse(localStorage.getItem(SESSION)!);
      localStorage.setItem(SESSION, JSON.stringify({ ...session, camera }));
    }, { s, camera, KEY, SESSION });
    await page.reload(); await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
    return screenPoint(page, target);
  }
  return screenPoint(page, world);
}
async function numeric345(page: Page) {
  const p = panel(page); await p.locator('summary').click();
  for (const [label, value] of [['A · X', '0'], ['A · Y', '0'], ['A · Z', '0'], ['B · X', '3'], ['B · Y', '4'], ['B · Z', '0']]) await p.getByLabel(label, { exact: false }).fill(value);
  await p.getByRole('button', { name: 'מדידת XYZ', exact: true }).click();
  await expect(p.locator('.viewer-measure-result')).toHaveText('מרחק XYZ 5.00 מ׳ · אופקי 3.00 מ׳ · אנכי 4.00 מ׳');
}

test('3D numeric 3-4-5, floor heights, finite errors, zoom and history reset', async ({ page }, info) => {
  const before = await setup(page, true); await measure(page).click(); const p = panel(page);
  await expect(p.locator('.cad-floor-levels')).toContainText('גובה קומה 3.40 מ׳'); await expect(p.locator('.cad-floor-levels')).toContainText('גובה פנוי 3.16 מ׳');
  await numeric345(page);
  await page.getByRole('button', { name: 'התקרבות', exact: true }).click();
  await expect(p.locator('.viewer-measure-result')).toContainText('5.00');
  await p.getByLabel('B · X', { exact: false }).fill('1001'); await p.getByRole('button', { name: 'מדידת XYZ', exact: true }).click();
  await expect(p.getByRole('alert')).toBeVisible(); await expect(p.locator('.viewer-measure-result')).toContainText('5.00');
  await p.getByLabel('B · X', { exact: false }).fill(''); await p.getByRole('button', { name: 'מדידת XYZ', exact: true }).click();
  await expect(p.getByRole('alert')).toBeVisible(); await expect.poll(() => saved(page)).toEqual(before);
  await p.getByLabel('קומה למדידה').selectOption('basement'); await expect(p.locator('[data-measure-point]')).toHaveCount(0);
  await expect(p.locator('.cad-floor-levels')).toContainText('2.71');
  await p.getByLabel('קומה למדידה').selectOption('first'); await expect(p.locator('.cad-floor-levels')).toContainText('2.86');
  await p.getByLabel('קומה למדידה').selectOption('ground');
  await p.locator('summary').click(); // Collapse before helper reopens.
  await numeric345(page);
  await page.locator('.topbar').getByRole('button', { name: 'היסטוריית פעולות', exact: true }).click();
  const history = page.getByRole('dialog', { name: 'היסטוריית פעולות', exact: true }); await expect(history.getByRole('listitem')).toHaveCount(1);
  await history.getByRole('button', { name: 'סגירת היסטוריה' }).click();
  await page.screenshot({ path: info.outputPath('cad-viewer-measurement.png') });
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  await page.getByRole('button', { name: 'גרם ישר רציף', exact: false }).click();
  await expect(p.locator('[data-measure-point]')).toHaveCount(0);
  await p.locator('summary').click(); await numeric345(page);
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(p.locator('[data-measure-point]')).toHaveCount(0);
});

test('3D real transformed picks, miss and drag keep draft; measurement owns input', async ({ page }) => {
  const before = await setup(page, true);
  await measure(page).click(); const p = panel(page), canvas = page.locator('.viewer canvas');
  const a = await objectPoint(page, 'a-living-sofa'), b = await objectPoint(page, 'a-dining-table');
  // Pick above the panel where necessary by temporarily collapsing nothing: the
  // projected points are asserted canvas-reachable rather than click-forced.
  for (const point of [a, b]) expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName, point)).toBe('CANVAS');
  await page.mouse.click(a.x, a.y); await expect(p.locator('[data-measure-point]')).toHaveCount(1);
  const first = await p.locator('[data-measure-point="A"]').innerText();
  await page.mouse.move(b.x, b.y); await page.mouse.down(); await page.mouse.move(b.x + 24, b.y + 12, { steps: 5 }); await page.mouse.up();
  await expect(p.locator('[data-measure-point]')).toHaveCount(1); await expect(p.locator('[data-measure-point="A"]')).toHaveText(first);
  const zoom = page.getByRole('slider', { name: 'זום', exact: true }), previousZoom = await zoom.inputValue();
  await zoom.fill('0');
  await expect.poll(async () => (await cameraFor(page)).camera.position.y).toBeGreaterThan(110);
  const { camera, box } = await cameraFor(page), ray = new THREE.Raycaster();
  let miss: { x: number; y: number } | null = null;
  for (const [x, y] of [[4, box.height - 10], [box.width - 4, box.height - 10], [4, 4], [box.width - 4, 4]]) {
    ray.setFromCamera(new THREE.Vector2(x / box.width * 2 - 1, 1 - y / box.height * 2), camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3())!;
    const r = before.northBearing * Math.PI / 180, localX = hit.x * Math.cos(r) + hit.z * Math.sin(r), localZ = -hit.x * Math.sin(r) + hit.z * Math.cos(r);
    const point = { x: box.x + x, y: box.y + y };
    if ((localX < -55 || localX > 65 || localZ < -50 || localZ > 60) && await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS', point)) { miss = point; break; }
  }
  expect(miss).not.toBeNull(); await page.mouse.click(miss!.x, miss!.y);
  await expect(p.locator('p[role="status"]')).toContainText('לא נבחר משטח גלוי');
  await expect(p.locator('[data-measure-point="A"]')).toHaveText(first);
  await zoom.fill(previousZoom); await expect.poll(async () => (await cameraFor(page)).camera.position.y).toBeLessThan(40);
  const next = await objectPoint(page, 'a-dining-table');
  await page.mouse.click(next.x, next.y); await expect(p.locator('[data-measure-point]')).toHaveCount(2);
  await expect(p.locator('.viewer-measure-result')).toContainText('מרחק XYZ');
  await page.mouse.dblclick(a.x, a.y); await expect(quick(page)).toHaveCount(0);
  const prevented = await canvas.evaluate(element => {
    const e = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }); element.dispatchEvent(e); return e.defaultPrevented;
  });
  expect(prevented).toBe(false); await expect.poll(() => saved(page)).toEqual(before);
  await measure(page).click(); const restored = await objectPoint(page, 'a-living-sofa'); await page.mouse.dblclick(restored.x, restored.y); await expect(quick(page)).toBeVisible();
});

for (const kind of ['furniture', 'wall', 'opening', 'stair'] as const) test(`3D ${kind} precise quick edit and persisted stair alternative`, async ({ page }, info) => {
  const before = await setup(page);
  const id = kind === 'furniture' ? 'a-living-sofa' : kind === 'wall' ? 'ground-wall-2-north' : kind === 'opening' ? 'added-north-east-glazing' : 'stair-north-ground';
  const point = await objectPoint(page, id); await page.mouse.dblclick(point.x, point.y);
  const q = quick(page); await expect(q).toBeVisible(); await expect(q.locator('.cad-object-id')).toHaveText(id);
  if (kind === 'furniture') {
    await q.getByLabel('רוחב פריט', { exact: false }).fill('-1'); await q.getByRole('button', { name: 'החלת מידות', exact: true }).click();
    await expect(q.getByRole('alert')).toBeVisible(); await expect.poll(() => saved(page)).toEqual(before);
    await q.getByLabel('רוחב פריט', { exact: false }).fill('2.5'); await q.getByRole('button', { name: 'החלת מידות', exact: true }).click();
    await expect.poll(async () => (await saved(page)).design.furnitureEdits[id]?.width).toBe(2.5);
    expect((await saved(page)).design.wallEdits).toEqual(before.design.wallEdits);
  } else if (kind === 'wall') {
    await q.getByLabel('הזזה X', { exact: false }).fill('.25'); await q.getByRole('button', { name: 'הזזת קיר', exact: true }).click();
    await expect.poll(async () => (await saved(page)).design.wallEdits[id]).toBeDefined();
    expect((await saved(page)).openings).toEqual(before.openings);
  } else if (kind === 'opening') {
    await q.getByLabel('רוחב פתח', { exact: false }).fill('1.8'); await q.getByRole('button', { name: 'החלת מידות', exact: true }).click();
    await expect.poll(async () => (await saved(page)).openings[id]?.width).toBe(1.8);
  } else {
    await q.getByRole('button', { name: 'גרם ישר רציף', exact: false }).click();
    await expect.poll(async () => (await saved(page)).buildings.north.stairLayout).toBe('straight');
    expect((await saved(page)).buildings.south.stairLayout).toBe(before.buildings.south.stairLayout);
  }
  await page.screenshot({ path: info.outputPath(`cad-quick-${kind}.png`) });
  const after = await saved(page); await page.reload(); await expect.poll(() => saved(page)).toEqual(after);
});

test('hidden first-floor furniture is not selected or measured through isolation', async ({ page }) => {
  const s = await setup(page);
  const world = new THREE.Vector3(...worldPoint([1.88, 4.65], s.buildings.north.groundHeight + .87, s));
  await measure(page).click(); const point = await screenPoint(page, world);
  await page.mouse.click(point.x, point.y);
  await expect(panel(page).locator('[data-measure-point]')).toHaveCount(1);
  const text = await panel(page).locator('[data-measure-point]').innerText();
  expect(Number(text.split(':')[1].split(',')[1])).toBeLessThan(s.buildings.north.groundHeight);
  await measure(page).click(); const restored = await screenPoint(page, world); await page.mouse.dblclick(restored.x, restored.y);
  await expect(page.locator('.quick-editor')).toBeVisible(); await expect(page.locator('.quick-editor')).not.toContainText('a-bed-west-bed');
});

test('fresh import tombstones survive startup; save failure never claims success', async ({ page }) => {
  const s = await setup(page);
  s.openings['added-north-east-glazing'] = { height: 0 };
  s.openings['ground-wall-0-north-opening-0'] = { width: 0 };
  await page.evaluate(keys => { for (const key of keys) localStorage.removeItem(key); }, [...MIGRATION_KEYS]);
  await page.locator('.topbar input[type="file"]').setInputFiles({ name: 'deleted.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(s)) });
  await expect(page.locator('.notice')).toContainText('יובאו ונשמרו בהצלחה');
  await page.reload(); await expect.poll(async () => (await saved(page)).openings['added-north-east-glazing']?.height).toBe(0);
  await expect.poll(async () => (await saved(page)).openings['ground-wall-0-north-opening-0']?.width).toBe(0);
  const before = await saved(page);
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException('Quota', 'QuotaExceededError'); original.call(this, k, v); }; }, KEY);
  const imported = { ...before, northBearing: 85 };
  await page.locator('.topbar input[type="file"]').setInputFiles({ name: 'quota.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.locator('.notice')).toContainText('השמירה בדפדפן נכשלה'); await expect(page.locator('.notice')).not.toContainText('בהצלחה');
  expect(await saved(page)).toEqual(before);
  // A successful no-op export is not evidence of current-state atomicity: read
  // the unchanged floor height directly, then exercise failed autosave/chat too.
  await measure(page).click(); await expect(panel(page).locator('.cad-floor-levels')).toContainText('3.40'); await measure(page).click();
  await page.locator('.topbar').getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('השמירה בדפדפן נכשלה');
  await page.getByRole('textbox', { name: 'פקודה לעדכון המודל' }).fill('גובה קומת קרקע 4.2 ביחידה א');
  await page.getByRole('button', { name: 'ביצוע הפקודה', exact: true }).click();
  await expect(page.locator('.chat-message.assistant').last()).toContainText('השמירה בדפדפן נכשלה');
  await expect(page.locator('.chat-message.assistant').last()).not.toContainText('נשמר אוטומטית');
  await measure(page).click(); await expect(panel(page).locator('.cad-floor-levels')).toContainText('4.20');
  expect(await saved(page)).toEqual(before);
});