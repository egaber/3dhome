import { expect, test, type Locator, type Page } from '@playwright/test';

async function checkTabCycle(page: Page, dialog: Locator) {
  const close = dialog.getByRole('button', { name: 'סגירת היסטוריה', exact: true });
  const last = dialog.getByRole('listitem').last().getByRole('button');
  await close.focus(); await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  const enabled = dialog.locator('button:enabled');
  for (const button of await enabled.all()) {
    await expect(button).toBeFocused(); await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await expect(close).toBeFocused();
}

test('history wraps both Tab directions and restores its toolbar or nested CAD launcher', async ({ page }) => {
  await page.goto('/');
  const toolbar = page.locator('.topbar');
  const launcher = toolbar.getByRole('button', { name: 'היסטוריית פעולות', exact: true });
  const history = page.getByRole('dialog', { name: 'היסטוריית פעולות', exact: true });
  await launcher.click();
  await expect(history.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeDisabled();
  await expect(history.getByRole('button', { name: 'ביצוע מחדש', exact: true })).toBeDisabled();
  await checkTabCycle(page, history);
  await page.keyboard.press('Escape'); await expect(history).toHaveCount(0); await expect(launcher).toBeFocused();

  await page.getByRole('textbox', { name: 'פקודה לעדכון המודל' }).fill('גובה שכן מזרח 12');
  await page.getByRole('button', { name: 'ביצוע הפקודה', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeEnabled();
  await toolbar.getByRole('button', { name: 'עורך 2D', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'עורך תוכנית דו־ממדית', exact: true });
  const nestedLauncher = editor.getByRole('button', { name: 'היסטוריית פעולות', exact: true });
  await nestedLauncher.click(); await expect(history.getByRole('listitem')).toHaveCount(2);
  await checkTabCycle(page, history);
  await history.getByRole('button', { name: 'שחזור שלב 0:', exact: false }).click();
  await expect(history.getByRole('button', { name: 'ביטול פעולה', exact: true })).toBeDisabled();
  await expect(history.getByRole('button', { name: 'ביצוע מחדש', exact: true })).toBeEnabled();
  await checkTabCycle(page, history);
  await page.keyboard.press('Escape'); await expect(history).toHaveCount(0);
  await expect(editor).toBeVisible(); await expect(nestedLauncher).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await editor.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: 'עורך 2D', exact: true })).toBeFocused();
});