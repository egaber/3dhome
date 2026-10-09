import { expect, test, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const projectKey = 'dori-solar-studio-v1', sessionKey = 'dori-solar-studio-session-v1';
type Camera = { position: number[]; target: number[]; up: number[]; zoom?: number };
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), projectKey);
const camera = (page: Page): Promise<Camera> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).camera, sessionKey);

async function configure(page: Page) {
  await page.goto('/?clawpilotTheme=light');
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  await page.getByRole('combobox', { name: /חלופת קומה א׳ בבית הצפוני/ }).selectOption('bedrooms');
  await page.getByRole('button', { name: 'מדרגות מול הכניסה', exact: true }).click();
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    const start = performance.now();
    const frame = () => performance.now() - start > 300 ? resolve() : requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  }));
}

async function colors(page: Page) {
  return page.locator('.viewer canvas').evaluate(element => {
    const sample = document.createElement('canvas'); sample.width = sample.height = 40;
    const context = sample.getContext('2d')!;
    context.drawImage(element as HTMLCanvasElement, 0, 0, 40, 40);
    const pixels = context.getImageData(0, 0, 40, 40).data, values = new Set<string>();
    for (let index = 0; index < pixels.length; index += 4) values.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`);
    return values.size;
  });
}

test('roof connection is opt-in, independently editable, undoable and persistent without changing lower stairs', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await configure(page);
  const before = await saved(page), toggle = page.getByRole('checkbox', { name: 'המשך מדרגות לגג', exact: true });
  const connection = page.getByRole('combobox', { name: 'חיבור מדרגות', exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(connection.locator('option[value="first"]')).toHaveJSProperty('disabled', true);
  await toggle.check();
  await connection.selectOption('first');
  const enabled = await saved(page);
  expect(enabled.buildings.north.stairPaths?.first).toEqual(before.buildings.north.stairPaths?.ground);
  expect(enabled.buildings.south).toEqual(before.buildings.south);
  expect(enabled.design).toEqual(before.design);
  const width = page.getByLabel('רוחב גרם', { exact: false });
  await width.fill('0');
  await page.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(enabled.buildings);
  await width.fill('0.9');
  await page.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings.north.stairPaths?.first?.width).toBe(.9);
  const edited = await saved(page);
  expect(edited.buildings.north.stairPaths?.ground).toEqual(before.buildings.north.stairPaths?.ground);
  expect(edited.buildings.north.stairPaths?.basement).toEqual(before.buildings.north.stairPaths?.basement);
  await page.locator('.topbar').getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings).toEqual(enabled.buildings);
  await page.locator('.topbar').getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings).toEqual(edited.buildings);
  await toggle.uncheck();
  await expect(connection.locator('option[value="first"]')).toHaveJSProperty('disabled', true);
  await toggle.check();
  expect((await saved(page)).buildings).toEqual(edited.buildings);
  await connection.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('roof-connection-controls.png'), fullPage: true });
  await page.reload();
  await page.getByRole('tab', { name: 'מבנה', exact: true }).click();
  await expect(toggle).toBeChecked();
  await connection.selectOption('first');
  await expect(width).toHaveValue('0.9');
  expect((await saved(page)).buildings).toEqual(edited.buildings);
  expect(errors).toEqual([]);
});

test('first-floor and roof views render their stair opening and remain interactive on desktop and mobile', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await configure(page);
  await page.getByRole('checkbox', { name: 'המשך מדרגות לגג', exact: true }).check();
  await page.getByRole('button', { name: 'תוכנית משולבת', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('יחידות בתוכנית', { exact: true }).selectOption('north');
  await dialog.getByRole('button', { name: 'קומה ראשונה', exact: true }).click();
  await dialog.getByRole('region', { name: 'גיליון קומה ראשונה', exact: true }).getByRole('button', { name: 'תלת־ממד לקומה', exact: true }).click();
  await page.getByRole('tab', { name: 'שמש', exact: true }).click();
  const floor = page.getByRole('combobox', { name: 'בחרו קומה לצפייה', exact: true });
  for (const level of ['first', 'roof']) {
    await floor.selectOption(level);
    await expect(page.locator('.asset-status')).toContainText('חומרי PBR וריהוט מוכנים');
    await expect.poll(() => colors(page)).toBeGreaterThan(24);
    await page.screenshot({ path: info.outputPath(`north-${level}.png`), fullPage: true });
    await page.locator('.viewer canvas').screenshot({ path: info.outputPath(`north-${level}-render.png`) });
  }
  const before = await camera(page);
  await page.locator('.viewer canvas').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => camera(page)).not.toEqual(before);
  expect(errors).toEqual([]);
});

test('supported keyboard walking exits the final roof tread, restores roof height and descends again', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await configure(page);
  await page.getByRole('checkbox', { name: 'המשך מדרגות לגג', exact: true }).check();
  const roofEye = await page.evaluate(({ projectKey, sessionKey }) => {
    const state = JSON.parse(localStorage.getItem(projectKey)!) as SimulationState;
    const old = JSON.parse(localStorage.getItem(sessionKey)!);
    state.view = { ...state.view, mode: 'walk', isolateFloor: 'none', cutaway: 'none', planVisible: false, path: false };
    const angle = state.northBearing * Math.PI / 180;
    const world = (x: number, z: number) => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
    const eye = state.buildings.north.groundHeight + state.buildings.north.upperHeight + state.view.eyeHeight;
    const height = eye - state.buildings.north.upperHeight / 18;
    const position = world(6.17, 3.71), target = world(8.17, 3.71);
    localStorage.setItem(projectKey, JSON.stringify(state));
    localStorage.setItem(sessionKey, JSON.stringify({ ...old, selectedUnit: 'north', camera: {
      position: [position[0], height, position[1]], target: [target[0], height - .1, target[1]], up: [0, 1, 0], zoom: 1,
    } }));
    return eye;
  }, { projectKey, sessionKey });
  await page.reload();
  await page.locator('.viewer canvas').focus(); await settle(page);
  await expect(page.locator('.notice[role="status"]')).toContainText('מדרגות');
  for (let count = 0; count < 5; count++) await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await camera(page)).position[1]).toBeCloseTo(roofEye, 2);
  await expect(page.locator('.notice[role="status"]')).toContainText('עליית גג');
  await expect.poll(() => colors(page)).toBeGreaterThan(24);
  await page.screenshot({ path: info.outputPath('roof-walk-exit.png'), fullPage: true });
  const onRoof = await camera(page);
  await page.reload(); await settle(page);
  expect((await camera(page)).position).toEqual(onRoof.position);
  await expect(page.locator('.notice[role="status"]')).toContainText('עליית גג');
  await page.locator('.viewer canvas').focus();
  for (let count = 0; count < 5; count++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await camera(page)).position[1]).toBeLessThan(roofEye - .1);
  await expect(page.locator('.notice[role="status"]')).toContainText('מדרגות');
  expect(errors).toEqual([]);
});