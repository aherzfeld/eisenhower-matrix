import { test, expect } from '@playwright/test';

test('add a task by keyboard only and see it in Schedule', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('/');
  await page.keyboard.type('Plan the quarter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.prompt')).toContainText('Important?');
  await page.keyboard.press('y');
  await expect(page.locator('.prompt')).toContainText('Urgent?');
  await page.keyboard.press('n');
  await expect(page.locator('.q--schedule .task__title')).toHaveText('Plan the quarter');
  await expect(page.locator('.capture__input')).toBeFocused();
});
