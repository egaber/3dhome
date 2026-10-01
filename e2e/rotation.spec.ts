import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SimulationState } from '../src/model/types';

const key = 'dori-solar-studio-v1';
const saved = (page: Page): Promise<SimulationState> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
const editorFor = (page: Page) => page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
async function open(page: Page) {
  await page.goto('/');
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = editorFor(page);
  await expect(editor).toBeVisible();
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  return editor;
}
const select = (editor: Locator, id: string) => editor.getByLabel('בחירת אובייקט', { exact: true }).selectOption(id);
const rotation = (editor: Locator) => editor.getByRole('region', { name: 'סיבוב אובייקט', exact: true });
const angle = (editor: Locator) => rotation(editor).getByLabel('זווית סיבוב °', { exact: true });
const normalize = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;

for (const [type, id] of [
  ['furniture', 'a-living-sofa'], ['wall', 'ground-wall-2-north'], ['room', 'a-living'],
  ['stair', 'stair-north-ground'], ['opening', 'added-north-east-glazing'],
] as const) test(`2D ${type} rotation changes geometry, is one undoable action and persists`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let editor = await open(page);
  await select(editor, `${type}:${id}`);
  const initial = await saved(page), initialAngle = Number(await angle(editor).inputValue());
  const geometry = () => type === 'room' ? editor.locator('.cad-room-outline').getAttribute('points')
    : type === 'stair' ? editor.locator(`.cad-canvas [data-object-id="${id}"] .cad-stair-boundary`).getAttribute('points')
      : type === 'wall' ? editor.locator(`.cad-canvas [data-object-id="${id}"] polygon`).first().getAttribute('points')
        : editor.locator(`.cad-canvas [data-object-id="${id}"]`).getAttribute('transform');
  const beforeGeometry = await geometry();
  await rotation(editor).getByRole('button', { name: 'סיבוב ימינה 15 מעלות', exact: true }).click();
  await expect.poll(async () => Number(await angle(editor).inputValue())).toBeCloseTo(normalize(initialAngle + 15));
  await expect.poll(geometry).not.toEqual(beforeGeometry);
  const changed = await saved(page);
  if (type === 'furniture') {
    expect(changed.design.furnitureEdits[id]?.rotation).toBe(normalize(initialAngle + 15));
    expect(changed.design.roomEdits).toEqual(initial.design.roomEdits);
    expect(changed.design.wallEdits).toEqual(initial.design.wallEdits);
  } else if (type === 'room') expect(changed.design.roomEdits[id]?.rotation).toBe(normalize(initialAngle + 15));
  else if (type === 'stair') expect(changed.buildings.north.stairRotation).toBe(normalize(initialAngle + 15));
  else {
    expect(Object.keys(changed.design.wallEdits)).toHaveLength(1);
    expect(changed.openings).toEqual(initial.openings); expect(changed.addedOpenings).toEqual(initial.addedOpenings);
  }
  await editor.getByRole('button', { name: 'ביטול פעולה', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
  await editor.getByRole('button', { name: 'ביצוע מחדש', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(changed);
  await angle(editor).fill('-37');
  await rotation(editor).getByRole('button', { name: 'החלת סיבוב', exact: true }).click();
  await expect.poll(async () => Number(await angle(editor).inputValue())).toBeCloseTo(-37);
  const exact = await saved(page);
  if (type === 'stair' || type === 'furniture') {
    await rotation(editor).scrollIntoViewIfNeeded();
    for (const button of await rotation(editor).getByRole('button').all()) {
      const rect = (await button.boundingBox())!;
      expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44);
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.screenshot({ path: testInfo.outputPath(`rotation-${type}.png`) });
  }
  await page.reload();
  await page.locator('.topbar').getByRole('button', { name: 'עורך 2D', exact: true }).click();
  editor = editorFor(page);
  const toggle = editor.getByRole('button', { name: 'מאפיינים, שכבות ומדרגות' });
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await select(editor, `${type}:${id}`);
  await expect.poll(async () => Number(await angle(editor).inputValue())).toBeCloseTo(-37);
  expect(await saved(page)).toEqual(exact);
  expect(errors).toEqual([]);
});

test('2D exact-angle validation and keyboard rotation preserve input and camera shortcuts', async ({ page }) => {
  const editor = await open(page);
  await select(editor, 'furniture:a-living-sofa');
  const initial = await saved(page);
  for (const value of ['', '181', '-181']) {
    await angle(editor).fill(value);
    await rotation(editor).getByRole('button', { name: 'החלת סיבוב', exact: true }).click();
    await expect(rotation(editor).getByRole('alert')).toBeVisible();
    expect(await saved(page)).toEqual(initial);
  }
  await angle(editor).fill('180');
  await rotation(editor).getByRole('button', { name: 'החלת סיבוב', exact: true }).click();
  await expect.poll(async () => Number(await angle(editor).inputValue())).toBe(-180);
  const rotated = await saved(page);
  await angle(editor).focus();
  const prevented = await angle(editor).evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'r', code: 'KeyR', bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(prevented).toBe(false); expect(await saved(page)).toEqual(rotated);
  const svg = editor.locator('.cad-canvas');
  await svg.focus();
  const view = await svg.getAttribute('viewBox');
  await page.keyboard.press('r');
  await expect.poll(async () => (await saved(page)).design.furnitureEdits['a-living-sofa']?.rotation).toBe(-165);
  expect(await svg.getAttribute('viewBox')).toBe(view);
  await page.keyboard.press('Shift+r');
  await expect.poll(() => saved(page)).toEqual(rotated);
  await page.keyboard.press('ArrowRight');
  await expect(svg).not.toHaveAttribute('viewBox', view!);
  expect(await saved(page)).toEqual(rotated);
});

test('2D stairs can be selected from the plan and keep rotation across connections and layouts', async ({ page }) => {
  const editor = await open(page);
  // Keyboard activation of the real SVG object, independent of the object list.
  const stair = editor.locator('.cad-canvas [data-object-id="stair-north-ground"]');
  await stair.focus(); await page.keyboard.press('Enter');
  await expect(editor.getByLabel('בחירת אובייקט', { exact: true })).toHaveValue('stair:stair-north-ground');
  await rotation(editor).getByRole('button', { name: 'סיבוב ימינה 90 מעלות' }).click();
  await expect.poll(async () => (await saved(page)).buildings.north.stairRotation).toBe(90);
  await editor.getByRole('button', { name: 'גרם ישר רציף', exact: false }).click();
  expect((await saved(page)).buildings.north.stairRotation).toBe(90);
  await editor.getByLabel('חיבור מדרגות', { exact: true }).selectOption('basement');
  await select(editor, 'stair:stair-north-basement');
  await expect.poll(async () => Number(await angle(editor).inputValue())).toBe(90);
  expect((await saved(page)).buildings.south.stairRotation).toBeUndefined();
});