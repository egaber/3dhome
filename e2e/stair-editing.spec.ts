import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const saved = (page: Page): Promise<SimulationState> => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-v1')!));

async function openSouthStairs(page: Page) {
  await page.goto('/?plans=combined&clawpilotTheme=light');
  await page.getByRole('dialog').getByRole('button', { name: 'תוכנית מצורפת', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'סגירת התוכנית המשולבת', exact: true }).click();
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  await editor.getByLabel('יחידה לעריכה', { exact: true }).selectOption('south');
  await editor.getByLabel('קומה לעריכה', { exact: true }).selectOption('ground');
  const expand = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות', exact: true });
  if (await expand.isVisible() && await expand.getAttribute('aria-expanded') === 'false') await expand.click();
  const controls = editor.getByRole('region', { name: 'חלופות מדרגות', exact: true });
  await controls.getByLabel('חיבור מדרגות', { exact: true }).selectOption('ground');
  return { editor, controls };
}

async function addSouthboundTurn(controls: Locator) {
  await controls.getByLabel('פודסט ופנייה נוספים', { exact: true }).check();
  await controls.getByLabel('רומים עד הפודסט', { exact: true }).fill('11');
  await controls.getByLabel(/^עומק הפודסט השני /).fill('0.92');
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toHaveCount(0);
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

test('stair path drafts, independent connections, reversal, presets and protection share persistent undo history', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { editor, controls } = await openSouthStairs(page);
  const before = await saved(page);
  await controls.getByLabel('מסלול עם פודסט', { exact: true }).check();
  const initial = await saved(page);
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(1);
  await controls.getByLabel('רומים עד הפודסט', { exact: true }).fill('2');
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(initial.buildings);
  await controls.getByLabel('רומים עד הפודסט', { exact: true }).fill('8');
  await controls.getByLabel('עומק הפודסט', { exact: false }).fill('1.2');
  await controls.getByLabel('רוחב גרם', { exact: false }).fill('1');
  await controls.getByLabel('עומק שלח', { exact: false }).fill('0.28');
  await controls.getByLabel('עומק שלח', { exact: false }).press('Tab');
  expect((await saved(page)).buildings).toEqual(initial.buildings);
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await saved(page)).buildings.south.stairPaths?.ground).toEqual({
    turn: 'right', landingAfter: 8, landingDepth: 1.2, width: 1, treadDepth: .28, reversed: false,
  });
  const footprint = editor.locator('.cad-canvas .cad-stair-boundary');
  const originalFootprint = await footprint.getAttribute('points');
  await controls.getByRole('button', { name: 'היפוך כיוון העלייה', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'פנייה שמאלה', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(controls.getByLabel('רומים עד הפודסט', { exact: true })).toHaveValue('10');
  await expect(footprint).toHaveAttribute('points', originalFootprint!);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'היפוך כיוון העלייה', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect(controls.getByRole('button', { name: 'היפוך כיוון העלייה', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const groundPath = (await saved(page)).buildings.south.stairPaths!.ground;
  await controls.getByLabel('חיבור מדרגות', { exact: true }).selectOption('basement');
  await expect(controls.getByLabel('מסלול עם פודסט', { exact: true })).not.toBeChecked();
  await expect(editor.locator('.cad-canvas [data-object-id="stair-south-basement"]')).toHaveCount(1);
  await controls.getByLabel('מסלול עם פודסט', { exact: true }).check();
  await controls.getByRole('button', { name: 'ללא פנייה', exact: true }).click();
  expect((await saved(page)).buildings.south.stairPaths!.ground).toEqual(groundPath);
  await controls.getByLabel('מעקה ומאחז יד', { exact: true }).check();
  await controls.getByLabel('זכוכית סביב פתחי מדרגות', { exact: true }).check();
  const configured = await saved(page);
  expect(configured.buildings.north).toEqual(before.buildings.north);
  expect(configured.buildings.south.stairPaths!.basement).toMatchObject({ turn: 'straight', reversed: false });
  await controls.getByRole('button', { name: 'מדרגות U', exact: false }).click();
  await expect.poll(async () => (await saved(page)).buildings.south.stairPaths).toBeUndefined();
  expect((await saved(page)).buildings.south.stairOpeningGlass).toBe(true);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(async () => (await saved(page)).buildings).toEqual(configured.buildings);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  expect(errors).toEqual([]);
});

test('a second southbound turn is editable and persistent only on the upper connection', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { editor, controls } = await openSouthStairs(page);
  const before = await saved(page);
  await controls.getByLabel('מסלול עם פודסט', { exact: true }).check();
  await controls.getByLabel('חיבור מדרגות', { exact: true }).selectOption('basement');
  const basementFootprint = await editor.locator('.cad-canvas .cad-stair-boundary').getAttribute('points');
  await controls.getByLabel('חיבור מדרגות', { exact: true }).selectOption('ground');
  await addSouthboundTurn(controls);
  const configured = await saved(page);
  expect(configured.buildings.south.stairPaths).toEqual({ ground: {
    turn: 'right', landingAfter: 11, landingDepth: 1.1, width: .92, treadDepth: .27, reversed: false,
    secondLanding: { turn: 'right', landingAfter: 15, landingDepth: .92 },
  } });
  expect(configured.buildings.north).toEqual(before.buildings.north);
  expect(configured.design).toEqual(before.design);
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(2);
  await controls.getByLabel('רומים עד הפודסט השני', { exact: true }).fill('13');
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  await controls.getByLabel('רומים עד הפודסט השני', { exact: true }).fill('15');
  await controls.getByLabel(/^עומק הפודסט השני /).fill('0.8');
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  await controls.getByLabel(/^עומק הפודסט השני /).fill('0.92');
  await controls.getByRole('button', { name: 'החלת מידות מדרגות', exact: true }).click();
  await expect(controls.getByRole('alert')).toHaveCount(0);
  await controls.getByRole('button', { name: 'פנייה שמאלה בפודסט השני', exact: true }).click();
  expect((await saved(page)).buildings.south.stairPaths?.ground).toMatchObject({ turn: 'right', secondLanding: { turn: 'left' } });
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  const footprint = editor.locator('.cad-canvas .cad-stair-boundary');
  const forwardFootprint = await footprint.getAttribute('points');
  await controls.getByRole('button', { name: 'היפוך כיוון העלייה', exact: true }).click();
  await expect(footprint).toHaveAttribute('points', forwardFootprint!);
  await expect(controls.getByLabel('רומים עד הפודסט', { exact: true })).toHaveValue('3');
  await expect(controls.getByLabel('רומים עד הפודסט השני', { exact: true })).toHaveValue('7');
  await expect(controls.getByRole('button', { name: 'פנייה שמאלה בפודסט השני', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await controls.getByLabel('פודסט ופנייה נוספים', { exact: true }).uncheck();
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(1);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(2);
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(1);
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await controls.getByLabel('חיבור מדרגות', { exact: true }).selectOption('basement');
  await expect(controls.getByLabel('מסלול עם פודסט', { exact: true })).not.toBeChecked();
  await expect(editor.locator('.cad-canvas .cad-stair-boundary')).toHaveAttribute('points', basementFootprint!);
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(0);
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await saved(page)).buildings).toEqual(configured.buildings);
  expect(errors).toEqual([]);
});

for (const secondTurn of [false, true]) test(secondTurn
  ? 'two landings and a southbound exit retain visible handrails and opening glass in both floor views'
  : 'L landing, handrail and opening glass remain visible and interactive in both floor views', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const { editor, controls } = await openSouthStairs(page);
  await controls.getByLabel('מסלול עם פודסט', { exact: true }).check();
  if (secondTurn) await addSouthboundTurn(controls);
  await expect(editor.locator('.cad-canvas [data-stair-part="landing"]')).toHaveCount(secondTurn ? 2 : 1);
  await controls.getByLabel('מעקה ומאחז יד', { exact: true }).check();
  await controls.getByLabel('זכוכית סביב פתחי מדרגות', { exact: true }).check();
  expect(await editor.locator('.cad-canvas [data-stair-protection="rail"]').count()).toBeGreaterThan(25);
  expect(await editor.locator('.cad-canvas [data-stair-protection="glass"]').count()).toBeGreaterThan(1);
  const clipped = await controls.locator('button, input, select').evaluateAll(elements => elements.filter(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 2);
  }).map(element => element.getAttribute('aria-label') ?? element.textContent));
  expect(clipped).toEqual([]);
  await controls.getByRole('group', { name: 'כיוון הפנייה בפודסט', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('stair-editing-controls.png'), fullPage: true });
  if (secondTurn) {
    await controls.getByLabel('רומים עד הפודסט השני', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('stair-editing-second-landing.png'), fullPage: true });
  }
  await editor.locator('.cad-canvas').screenshot({ path: info.outputPath('stair-editing-plan.png') });
  await editor.getByRole('button', { name: 'סגירת עורך', exact: true }).click();
  for (const [floor, label] of [['ground', 'קומת קרקע'], ['first', 'קומה ראשונה']] as const) {
    await page.getByRole('button', { name: 'תוכנית משולבת', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('יחידות בתוכנית', { exact: true }).selectOption('south');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await dialog.getByRole('region', { name: `גיליון ${label}`, exact: true }).getByRole('button', { name: 'תלת־ממד לקומה', exact: true }).click();
    await expect(page.locator('.asset-status')).toContainText('חומרי PBR וריהוט מוכנים');
    await expect.poll(() => renderedColors(page)).toBeGreaterThan(24);
    await page.screenshot({ path: info.outputPath(`stair-editing-${floor}.png`), fullPage: true });
    await page.locator('.viewer canvas').screenshot({ path: info.outputPath(`stair-editing-${floor}-render.png`) });
  }
  const camera = await page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera);
  await page.locator('.viewer canvas').focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dori-solar-studio-session-v1')!).camera)).not.toEqual(camera);
  expect(errors).toEqual([]);
});