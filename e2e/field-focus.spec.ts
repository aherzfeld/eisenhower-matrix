import { test, expect, type Page } from '@playwright/test';

async function add(page: Page, title: string, important: 'y' | 'n', urgent: 'y' | 'n') {
  await page.locator('.capture__input').focus();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.keyboard.press(important);
  await page.keyboard.press(urgent);
  await expect(page.locator('.task__title', { hasText: title })).toBeVisible();
}

// #12: the midnight re-render waits while a Who? field has focus, then runs as focus leaves it.
// Focus must land where it was heading (rebuilt by that render), not on body.
test('a render held past midnight keeps focus where it was going', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 2, 10, 23, 58, 0) });
  await page.goto('/');
  await add(page, 'Send quote', 'n', 'y'); // Delegate
  await add(page, 'Old magazines', 'n', 'n'); // Delete

  const delegate = page.locator('.q--delegate .task');
  const who = delegate.locator('.task__who');
  await who.focus();
  await page.keyboard.type('Sam');
  await page.clock.runFor(3 * 60_000); // past local midnight
  await expect(page.locator('.q--delegate .task__who')).toBeFocused(); // held while typing

  // Tab leaves the field for the next tab stop: the Delete quadrant's row.
  await page.keyboard.press('Tab');
  await expect(page.locator('.q--delete .task')).toBeFocused();
  await expect(page.locator('.stamp--waiting')).toHaveText('Waiting on Sam');

  // The next midnight, focus moves to a control in the same row.
  await who.focus();
  await page.clock.runFor(24 * 3600_000);
  await delegate.locator('.task__rename').focus();
  await expect(delegate.locator('.task__rename')).toBeFocused();
  await expect(page.locator('body')).not.toBeFocused();
});

// A press that moves focus out of the field runs the held render. If that render rebuilt the
// row under the pointer at mousedown, the mouseup landed on a new node and the click was lost.
for (const [name, control, landed] of [
  ['Move to Do', '.task__move[data-move="do"]', '.q--do .task'],
  ['the checkbox', '.task__check', '.task[data-done="true"]'],
] as const) {
  test(`a click on ${name} is not lost when it runs a held render`, async ({ page }) => {
    await page.clock.install({ time: new Date(2026, 2, 10, 23, 58, 0) });
    await page.goto('/');
    await add(page, 'Send quote', 'n', 'y'); // Delegate
    const row = page.locator('.q--delegate .task');
    await row.locator('.task__who').click();
    await page.keyboard.type('Sam');
    await page.clock.runFor(3 * 60_000); // past local midnight: the render is held
    await expect(page.locator('.q--delegate .task__who')).toBeFocused();

    await row.locator(control).click();
    await expect(page.locator(landed)).toHaveCount(1);
    await expect(page.locator('.task__title')).toHaveText(['Send quote']);
  });
}

test('a tap on Move to Do is not lost when it runs a held render', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(2026, 2, 10, 23, 58, 0) });
  await page.goto('/');
  await add(page, 'Send quote', 'n', 'y');
  const row = page.locator('.q--delegate .task');
  await row.locator('.task__who').tap();
  await page.keyboard.type('Sam');
  await page.clock.runFor(3 * 60_000);
  await row.locator('.task__move[data-move="do"]').tap();
  await expect(page.locator('.q--do .task')).toHaveCount(1);
  await context.close();
});
