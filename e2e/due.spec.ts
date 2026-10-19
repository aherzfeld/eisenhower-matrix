import { test, expect } from '@playwright/test';

test('a Schedule task dated today shows DUE, and key 1 moves it to Do', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('/');
  await page.keyboard.type('Pay rent');
  await page.keyboard.press('Enter');
  await page.keyboard.press('y'); // important
  await page.keyboard.press('n'); // not urgent -> Schedule
  const row = page.locator('.q--schedule .task', { hasText: 'Pay rent' });
  await expect(row).toBeVisible();
  await expect(page.locator('.toast__text')).toHaveText('Added to Schedule');

  // The browser's own local calendar day, not UTC.
  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  await row.locator('.task__when').fill(today);
  await expect(row.locator('.stamp--due')).toBeVisible();

  await row.focus();
  await page.keyboard.press('1');
  await expect(page.locator('.q--do .task__title')).toHaveText('Pay rent');
  await expect(page.locator('.q--schedule .task')).toHaveCount(0);
});
