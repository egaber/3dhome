import { expect, test, type Page } from '@playwright/test';

type Bookmark = { position: number[]; target: number[]; up: number[]; zoom?: number };
const sessionKey = 'dori-solar-studio-session-v1';
const zoomSlider = (page: Page) => page.getByRole('slider', { name: 'זום', exact: true });
const canvas = (page: Page) => page.locator('.viewer canvas');
const camera = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').camera as Bookmark | null, sessionKey);
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, index) => value - b[index]));
const zoomLevel = async (page: Page) => Number(await zoomSlider(page).inputValue());
const modes = (page: Page) => page.getByRole('group', { name: 'מצב תצוגה', exact: true });

async function settle(page: Page) {
  // Wait for rendering and the real 180ms camera-save debounce, not a test-only hook.
  await page.evaluate(() => new Promise<void>(resolve => {
    const start = performance.now();
    const frame = () => performance.now() - start > 300 ? resolve() : requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  }));
}

async function openView(page: Page) {
  await page.goto('/');
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => camera(page)).not.toBeNull();
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(0);
}

test('vertical zoom is reachable, synchronized, keyboard accessible and bounded', async ({ page }, testInfo) => {
  await openView(page);
  const slider = zoomSlider(page);
  await expect(slider).toHaveAttribute('aria-orientation', 'vertical');
  const assertReachable = async () => {
    for (const control of [slider, page.getByRole('button', { name: 'התקרבות', exact: true }), page.getByRole('button', { name: 'התרחקות', exact: true })]) {
      const bounds = (await control.boundingBox())!;
      const stage = (await page.locator('.stage').boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(stage.x);
      expect(bounds.y).toBeGreaterThanOrEqual(stage.y);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(stage.x + stage.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(stage.y + stage.height);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(await control.evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'Chat and other overlays must not cover the zoom controls').toBe(true);
    }
  };
  await assertReachable();
  await settle(page);
  await page.screenshot({ path: testInfo.outputPath('navigation-orbit.png'), fullPage: true });

  const initial = await zoomLevel(page);
  await page.getByRole('button', { name: 'התקרבות', exact: true }).click();
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(initial);
  await page.getByRole('button', { name: 'התרחקות', exact: true }).click();
  expect(await zoomLevel(page)).toBeCloseTo(initial, 2);

  await slider.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(initial);
  await page.keyboard.press('End');
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(100, 2);
  await expect(page.getByRole('button', { name: 'התקרבות', exact: true })).toBeDisabled();
  await page.keyboard.press('+');
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(100, 2);
  await page.keyboard.press('Home');
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(0, 2);
  await expect(page.getByRole('button', { name: 'התרחקות', exact: true })).toBeDisabled();
  await page.keyboard.press('-');
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(0, 2);

  // A real click/touch on the track must work; users need not drag a tiny thumb.
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect.poll(() => zoomLevel(page)).toBeGreaterThan(25);
  await expect.poll(() => zoomLevel(page)).toBeLessThan(75);

  await modes(page).getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await assertReachable();
  await settle(page);
  await page.screenshot({ path: testInfo.outputPath('navigation-walk.png'), fullPage: true });

  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 800 });
    await assertReachable();
    await page.screenshot({ path: testInfo.outputPath('navigation-narrow.png'), fullPage: true });
  }
});

for (const name of ['סיבוב', 'מבט על']) test(`plus/minus, wheel and arrow panning change the real camera and survive reload (${name})`, async ({ page }) => {
  await openView(page);
    await modes(page).getByRole('button', { name, exact: true }).click();
    await settle(page);
    await canvas(page).focus();
    const before = (await camera(page))!;
    const initial = await zoomLevel(page);
    await page.keyboard.press('+');
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(initial);
    await settle(page);
    const close = (await camera(page))!;
    expect(distance(close.position, close.target)).toBeLessThan(distance(before.position, before.target));
    await page.keyboard.press('-');
    expect(await zoomLevel(page)).toBeCloseTo(initial, 2);
    for (const key of ['=', 'NumpadAdd', 'NumpadSubtract']) {
      const level = await zoomLevel(page);
      await page.keyboard.press(key);
      await expect.poll(() => zoomLevel(page)).not.toBe(level);
    }
    const level = await zoomLevel(page);
    await canvas(page).dispatchEvent('wheel', { deltaY: -100 });
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(level);

    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']) {
      await settle(page);
      const start = (await camera(page))!;
      await page.keyboard.press(key);
      await expect.poll(async () => distance((await camera(page))!.target, start.target)).toBeGreaterThan(.01);
      const moved = (await camera(page))!;
      const cameraDelta = moved.position.map((value, index) => value - start.position[index]);
      const targetDelta = moved.target.map((value, index) => value - start.target[index]);
      expect(distance(cameraDelta, targetDelta)).toBeLessThan(.00001);
      expect(moved.up).toEqual(start.up);
    }
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
  const saved = (await camera(page))!;
  const savedLevel = await zoomLevel(page);
  await page.reload();
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(savedLevel, 2);
  await settle(page);
  expect(distance((await camera(page))!.position, saved.position)).toBeLessThan(.00001);
});

test('inputs, modifiers and open dialogs do not trigger background navigation', async ({ page }) => {
  await openView(page);
  await settle(page);
  const initial = (await camera(page))!;
  const level = await zoomLevel(page);
  const input = page.getByRole('textbox', { name: 'פקודה לעדכון המודל' });
  await input.fill('10');
  await input.press('+');
  await input.press('-');
  await input.press('ArrowLeft');
  await expect(input).toHaveValue('10+-');

  const results = await page.evaluate(() => {
    const dispatch = (target: EventTarget, properties: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...properties });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const results: boolean[] = [];
    for (const selector of ['input[type="number"]', 'select', '.inspector input[type="range"]']) {
      const target = document.querySelector(selector)!;
      results.push(dispatch(target, { key: 'ArrowUp' }), dispatch(target, { key: '+' }));
    }
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.innerHTML = '<span>editable fixture</span>';
    document.body.append(editable);
    results.push(dispatch(editable.firstElementChild!, { key: 'ArrowRight' }));
    editable.remove();
    const target = document.querySelector('.viewer canvas')!;
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      results.push(dispatch(target, { key: '+', [modifier]: true }), dispatch(target, { key: 'ArrowUp', [modifier]: true }));
    }
    results.push(dispatch(target, { key: '+', isComposing: true }), dispatch(target, { key: 'F2' }));
    return results;
  });
  expect(results.every(prevented => !prevented)).toBe(true);
  await settle(page);
  expect(await camera(page)).toEqual(initial);
  expect(await zoomLevel(page)).toBeCloseTo(level, 2);

  await page.getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('+');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  expect(await camera(page)).toEqual(initial);
  await dialog.getByRole('button', { name: 'סגירת עורך' }).click();
  await canvas(page).focus();
  expect(await canvas(page).evaluate(element => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await expect.poll(async () => distance((await camera(page))!.target, initial.target)).toBeGreaterThan(.01);
});

test('walk zoom is optical and saved; arrows and WASD move, and focus clears held keys', async ({ page }) => {
  await openView(page);
  await modes(page).getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await expect(canvas(page)).toBeFocused();
  await settle(page);
  await canvas(page).focus();
  const initial = (await camera(page))!;
  await page.keyboard.press('+');
  await settle(page);
  const zoomed = (await camera(page))!;
  expect(zoomed.zoom).toBeGreaterThan(initial.zoom ?? 1);
  expect(distance(zoomed.position, initial.position)).toBeLessThan(.00001);
  expect(distance(zoomed.target, initial.target)).toBeLessThan(.00001);
  const level = await zoomLevel(page);
  await page.reload();
  await expect.poll(() => zoomLevel(page)).toBeCloseTo(level, 2);
  await settle(page);
  expect((await camera(page))!.zoom).toBeCloseTo(zoomed.zoom!, 5);

  await canvas(page).focus();
  const movements: number[] = [];
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 's', 'a', 'd']) {
    const before = (await camera(page))!;
    await page.keyboard.down(key);
    await settle(page);
    await page.keyboard.up(key);
    await settle(page);
    const after = (await camera(page))!;
    const movement = distance(after.position, before.position);
    movements.push(movement);
    expect(movement, `${key} must physically move the camera`).toBeGreaterThan(.01);
    const delta = after.position.map((value, index) => value - before.position[index]);
    const forward = before.target.map((value, index) => index === 1 ? 0 : value - before.position[index]);
    const right = [-forward[2], 0, forward[0]];
    const direction = key === 'ArrowUp' || key === 'w' ? forward : key === 'ArrowDown' || key === 's' ? forward.map(value => -value)
      : key === 'ArrowRight' || key === 'd' ? right : right.map(value => -value);
    expect(delta.reduce((sum, value, index) => sum + value * direction[index], 0), `${key} must move in the requested direction`).toBeGreaterThan(0);
    expect(distance(after.position.map((value, index) => value - before.position[index]),
      after.target.map((value, index) => value - before.target[index]))).toBeLessThan(.00001);
  }
  expect(movements).toHaveLength(8);

  await page.keyboard.down('ArrowRight');
  await page.getByRole('textbox', { name: 'פקודה לעדכון המודל' }).focus();
  await settle(page);
  const stopped = (await camera(page))!;
  await settle(page);
  expect(await camera(page)).toEqual(stopped);
  await canvas(page).focus();
  await settle(page);
  expect(await camera(page)).toEqual(stopped);
  await page.keyboard.up('ArrowRight');
});

test('short arrow taps work, Q/E turn from a fixed eye, and movement follows the new view direction', async ({ page }, testInfo) => {
  await openView(page);
  await modes(page).getByRole('button', { name: 'סיור בחדר', exact: true }).click();
  await expect(canvas(page)).toBeFocused();
  await settle(page);
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
    const before = (await camera(page))!;
    await page.keyboard.press(key);
    await expect.poll(async () => distance((await camera(page))!.position, before.position)).toBeGreaterThan(.05);
  }
  const before = (await camera(page))!;
  await page.keyboard.down('q');
  await expect.poll(async () => distance((await camera(page))!.target, before.target)).toBeGreaterThan(.5);
  await page.keyboard.up('q');
  const turned = (await camera(page))!;
  expect(distance(turned.position, before.position)).toBeLessThan(.00001);
  await page.keyboard.press('e');
  await expect.poll(async () => distance((await camera(page))!.target, turned.target)).toBeGreaterThan(.05);
  const facing = (await camera(page))!;
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => distance((await camera(page))!.position, facing.position)).toBeGreaterThan(.05);
  const after = (await camera(page))!;
  const motion = after.position.map((value, index) => value - facing.position[index]);
  const direction = facing.target.map((value, index) => index === 1 ? 0 : value - facing.position[index]);
  expect(motion.reduce((sum, value, index) => sum + value * direction[index], 0)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('first-person-navigation.png'), fullPage: true });
});