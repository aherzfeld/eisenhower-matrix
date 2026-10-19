import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const MAIN_KEY = 'eisenhower:v1';

async function addByKeyboard(page: Page, title: string, important: 'y' | 'n', urgent: 'y' | 'n') {
  await page.locator('.capture__input').blur();
  await page.keyboard.press('/');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.prompt')).toContainText('Important?');
  await page.keyboard.press(important);
  await expect(page.locator('.prompt')).toContainText('Urgent?');
  await page.keyboard.press(urgent);
}

async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.transfer__import').click()]);
  await chooser.setFiles(file);
}

test('AC6: export downloads a file, and importing it into a fresh browser restores the tasks', async ({ page, browser }) => {
  await page.goto('/');
  await addByKeyboard(page, 'Pay rent', 'y', 'y');
  await addByKeyboard(page, 'Plan the trip', 'y', 'n');
  await addByKeyboard(page, 'Old magazines', 'n', 'n');
  await expect(page.locator('.task')).toHaveCount(3);

  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.transfer__export').click()]);
  expect(download.suggestedFilename()).toMatch(/^eisenhower-\d{4}-\d{2}-\d{2}\.json$/);
  const text = await readFile((await download.path())!, 'utf8');
  await expect(page.locator('.backup-status')).toHaveText('Last backup today');
  const exported = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!).tasks, MAIN_KEY);

  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto('/');
  await expect(other.locator('.task')).toHaveCount(0);
  await chooseFile(other, { name: download.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });

  const dialog = other.getByRole('dialog');
  await expect(dialog).toContainText('Replace your 0 tasks with 3 tasks');
  await expect(other.locator('.import-confirm__cancel')).toBeFocused();
  const [bonus] = await Promise.all([other.waitForEvent('download'), other.locator('.import-confirm__replace').click()]);
  expect(bonus.suggestedFilename()).toMatch(/^eisenhower-\d{4}-\d{2}-\d{2}\.json$/);
  await expect(dialog).toHaveCount(0);
  await expect(other.locator('.toast-slot')).toContainText('Imported 3 tasks');
  await expect(other.locator('.q--do .task__title')).toHaveText('Pay rent');
  await expect(other.locator('.q--schedule .task__title')).toHaveText('Plan the trip');
  await expect(other.locator('.q--delete .task__title')).toHaveText('Old magazines');
  await expect(other.locator('.transfer__import')).toBeFocused();

  const imported = await other.evaluate((k) => JSON.parse(localStorage.getItem(k)!).tasks, MAIN_KEY);
  expect(imported).toEqual(exported);
  const backups = await other.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('eisenhower:backup:pre-import:')),
  );
  expect(backups).toHaveLength(1);

  await other.reload();
  await expect(other.locator('.task')).toHaveCount(3);
  await fresh.close();
});

test('AC6: importing a garbage file shows the error and changes nothing', async ({ page }) => {
  await page.goto('/');
  await addByKeyboard(page, 'Keep me', 'y', 'y');
  await expect(page.locator('.q--do .task__title')).toHaveText('Keep me');
  const before = await page.evaluate((k) => localStorage.getItem(k), MAIN_KEY);

  await chooseFile(page, { name: 'garbage.json', mimeType: 'application/json', buffer: Buffer.from('not { json') });
  await expect(page.locator('.import-confirm__error')).toHaveText('The file is not valid JSON.');
  await expect(page.locator('.import-confirm__replace')).toBeHidden();

  // Shortcuts are inert while the panel is open; Escape closes it.
  await page.keyboard.press('/');
  await expect(page.locator('.capture__input')).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.transfer__import')).toBeFocused();

  await expect(page.locator('.q--do .task__title')).toHaveText('Keep me');
  expect(await page.evaluate((k) => localStorage.getItem(k), MAIN_KEY)).toBe(before);
});
