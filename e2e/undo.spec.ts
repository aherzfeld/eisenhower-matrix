import { test, expect } from '@playwright/test';

test('delete a task with the Delete key, then Undo brings it back', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('/');
  await page.keyboard.type('Call Sam');
  await page.keyboard.press('Enter');
  await page.keyboard.press('y');
  await page.keyboard.press('y');
  const row = page.locator('.q--do .task', { hasText: 'Call Sam' });
  await expect(row).toBeVisible();

  await row.focus();
  await page.keyboard.press('Delete');
  await expect(row).toHaveCount(0);
  await expect(page.locator('.toast__text')).toHaveText("Deleted 'Call Sam'");

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.q--do .task__title')).toHaveText('Call Sam');
});
