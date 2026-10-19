import { test, expect } from '@playwright/test';

test('page loads with the app title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Eisenhower Matrix');
  await expect(page.locator('#app')).toBeAttached();
});
