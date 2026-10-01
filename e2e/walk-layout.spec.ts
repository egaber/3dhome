import { expect, test, type Locator, type Page } from '@playwright/test';

type Bookmark = { position: number[]; target: number[] };
const sessionKey = 'dori-solar-studio-session-v1';
const canvas = (page: Page) => page.locator('.viewer canvas');
const walk = (page: Page) => page.getByRole('group', { name: 'בקרי הליכה', exact: true });
const zoom = (page: Page) => page.getByRole('slider', { name: 'זום', exact: true });
const camera = (page: Page): Promise<Bookmark | null> => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').camera ?? null, sessionKey);
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, index) => value - b[index]));
const mode = (page: Page, name: string) => page.getByRole('group', { name: 'מצב תצוגה', exact: true }).getByRole('button', { name, exact: true });

async function settle(page: Page) {
  // Observe the real render loop and 180ms camera persistence, without test hooks.
  await page.evaluate(() => new Promise<void>(resolve => {
    const start = performance.now();
    const frame = () => performance.now() - start > 300 ? resolve() : requestAnimationFrame(frame);
    requestAnimationFrame(frame);
  }));
}

async function reachable(control: Locator, touchSized = false) {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  if (touchSized) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await control.evaluate(element => {
    const r = element.getBoundingClientRect();
    if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return false;
    // Check the center and edges of the usable target, not visibility alone.
    for (const [fx, fy] of [[.5, .5], [.1, .5], [.9, .5], [.5, .1], [.5, .9]]) {
      if (!element.contains(document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy))) return false;
    }
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), p = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && (r.left < p.left || r.right > p.right)) return false;
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY) && (r.top < p.top || r.bottom > p.bottom)) return false;
    }
    return true;
  }), 'The whole control must be unclipped and hit-testable without scrolling or overlay priority tricks').toBe(true);
}

async function separate(a: Locator, b: Locator) {
  const x = (await a.boundingBox())!, y = (await b.boundingBox())!;
  expect(x).not.toBeNull(); expect(y).not.toBeNull();
  expect(x.x + x.width <= y.x || y.x + y.width <= x.x || x.y + x.height <= y.y || y.y + y.height <= x.y,
    `${await a.getAttribute('class')} must not overlap ${await b.getAttribute('class')}`).toBe(true);
}

async function clearSlots(page: Page, chatOpen: boolean) {
  const dpad = walk(page), zoomPanel = page.getByRole('group', { name: 'בקרי זום', exact: true });
  const chat = chatOpen ? page.getByRole('region', { name: 'צ׳אט לעדכון המודל', exact: true }) : page.locator('.chat-launcher');
  await expect(dpad.getByRole('button')).toHaveCount(4);
  for (const name of ['קדימה', 'שמאלה', 'אחורה', 'ימינה']) await reachable(dpad.getByRole('button', { name, exact: true }), true);
  for (const control of [zoom(page), page.getByRole('button', { name: 'התקרבות', exact: true }), page.getByRole('button', { name: 'התרחקות', exact: true })]) {
    await reachable(control, true);
  }
  for (const slot of [zoomPanel, chat, page.locator('.stage-surface'), page.locator('.stage-status')]) await separate(dpad, slot);
  await separate(zoomPanel, chat);
  await separate(zoomPanel, page.locator('.stage-status'));
  for (const group of [page.locator('.view-modes'), page.locator('.render-modes')]) {
    await separate(chat, group);
    for (const button of await group.getByRole('button').all()) await reachable(button);
  }
  await separate(chat, page.locator('.viewer-measure-toggle'));
  await reachable(page.locator('.viewer-measure-toggle'), true);
  if (chatOpen) {
    await separate(chat, page.locator('.stage-status'));
    for (const name of ['סגירת הצ׳אט', 'ביצוע הפקודה']) await reachable(chat.getByRole('button', { name, exact: true }));
    await reachable(chat.getByRole('textbox', { name: 'פקודה לעדכון המודל', exact: true }));
  } else await reachable(chat, true);
  const view = (await canvas(page).boundingBox())!, stage = (await page.locator('.stage').boundingBox())!;
  // Preserve a majority of the stage for drawing and keep the inspector separate.
  expect(view.height).toBeGreaterThan(stage.height / 2);
  await separate(page.locator('.stage'), page.locator('.inspector'));
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
}

for (const theme of ['light', 'dark']) test(`walk layout keeps D-pad, zoom and chat in distinct reachable slots (${theme})`, async ({ page }, info) => {
  const sizes = info.project.name === 'mobile'
    ? [{ width: 412, height: 839 }, { width: 393, height: 851 }, { width: 360, height: 800 }]
    : [{ width: 1440, height: 1000 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto(`/?clawpilotTheme=${theme}`);
    await expect(canvas(page)).toBeVisible();
    await expect.poll(() => camera(page)).not.toBeNull();
    await expect(walk(page)).toHaveCount(0);
    const inspectorBefore = (await page.locator('.inspector').boundingBox())!;
    await mode(page, 'סיור בחדר').click();
    await expect(canvas(page)).toBeFocused();
    await settle(page);
    await clearSlots(page, true);
    expect(await page.locator('.inspector').boundingBox()).toEqual(inspectorBefore);
    await page.screenshot({ path: info.outputPath(`walk-chat-open-${size.width}-${theme}.png`), scale: 'css' });

    // Verify existing pointer handlers still move the real, persisted camera.
    for (const name of ['קדימה', 'אחורה', 'שמאלה', 'ימינה']) {
      const before = (await camera(page))!;
      const button = walk(page).getByRole('button', { name, exact: true });
      const box = (await button.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      try {
        await expect.poll(async () => distance((await camera(page))!.position, before.position)).toBeGreaterThan(.01);
      } finally { await page.mouse.up(); }
      await settle(page);
      const after = (await camera(page))!;
      const motion = after.position.map((value, index) => value - before.position[index]);
      const forward = before.target.map((value, index) => index === 1 ? 0 : value - before.position[index]);
      const right = [-forward[2], 0, forward[0]];
      const direction = name === 'קדימה' ? forward : name === 'אחורה' ? forward.map(value => -value)
        : name === 'ימינה' ? right : right.map(value => -value);
      expect(motion.reduce((sum, value, index) => sum + value * direction[index], 0)).toBeGreaterThan(0);
      expect(distance(motion, after.target.map((value, index) => value - before.target[index]))).toBeLessThan(.00001);
      await settle(page);
      expect(await camera(page), 'Releasing a walk button must stop movement').toEqual(after);
    }

    const initialZoom = Number(await zoom(page).inputValue());
    await page.getByRole('button', { name: 'התקרבות', exact: true }).click();
    await expect.poll(async () => Number(await zoom(page).inputValue())).toBeGreaterThan(initialZoom);
    await page.getByRole('button', { name: 'התרחקות', exact: true }).click();
    await expect.poll(async () => Number(await zoom(page).inputValue())).toBeCloseTo(initialZoom, 2);

    await page.getByRole('button', { name: 'סגירת הצ׳אט', exact: true }).click();
    await clearSlots(page, false);
    await page.screenshot({ path: info.outputPath(`walk-chat-closed-${size.width}-${theme}.png`), scale: 'css' });
    await page.locator('.chat-launcher').click();
    await clearSlots(page, true);
    // A native chat draft is not a movement command; no held pointer may leak.
    const stopped = await camera(page);
    const draft = page.getByRole('textbox', { name: 'פקודה לעדכון המודל', exact: true });
    await draft.fill('טיוטה'); await draft.press('ArrowLeft');
    await settle(page);
    expect(await camera(page)).toEqual(stopped);
    await expect(draft).toHaveValue('טיוטה');
    await draft.fill('');

    const measure = page.getByRole('button', { name: 'מדידה בתלת־ממד', exact: true });
    await measure.click();
    await expect(walk(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'צ׳אט לעדכון המודל', exact: true })).toBeHidden();
    await reachable(zoom(page), true);
    await measure.click();
    await clearSlots(page, true);
    await mode(page, 'סיבוב').click();
    await expect(walk(page)).toHaveCount(0);
    expect(await page.locator('.inspector').boundingBox()).toEqual(inspectorBefore);
    await page.evaluate(() => localStorage.clear());
  }
});