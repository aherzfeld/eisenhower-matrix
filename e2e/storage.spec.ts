import { test, expect, type Page } from '@playwright/test';

const MAIN_KEY = 'eisenhower:v1';

async function addByKeyboard(page: Page, title: string, important: 'y' | 'n', urgent: 'y' | 'n') {
  await page.keyboard.press('/');
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.prompt')).toContainText('Important?');
  await page.keyboard.press(important);
  await expect(page.locator('.prompt')).toContainText('Urgent?');
  await page.keyboard.press(urgent);
}

test('AC3: a task added by keyboard is still there after a reload', async ({ page }) => {
  await page.goto('/');
  await addByKeyboard(page, 'Survive the reload', 'y', 'n');
  await expect(page.locator('.q--schedule .task__title')).toHaveText('Survive the reload');
  await page.reload();
  await expect(page.locator('.q--schedule .task__title')).toHaveText('Survive the reload');
  await expect(page.locator('.banner')).toHaveCount(0);
  await expect(page.locator('.backup-status')).toHaveText('Never backed up');
});

test('AC5: with storage blocked, the app works in memory and the banner says so', async ({ page }) => {
  await page.addInitScript(() => {
    const deny = () => {
      throw new DOMException('Storage is disabled', 'SecurityError');
    };
    Storage.prototype.getItem = deny;
    Storage.prototype.setItem = deny;
  });
  await page.goto('/');
  await expect(page.locator('.banner')).toBeVisible();
  await expect(page.locator('.banner')).toContainText('your browser is blocking storage');
  await addByKeyboard(page, 'In memory', 'y', 'y');
  await expect(page.locator('.q--do .task__title')).toHaveText('In memory');
  await expect(page.locator('.banner')).toBeVisible();
});

test('AC4: unreadable data is offered for download and the main key is left unchanged', async ({ page }) => {
  // Non-ASCII and control characters too: the file must hold the same bytes, not just similar text.
  const garbage = '{"version":1,"rev":2,"tasks":[{"id":"a","title":"café 😀 \u2028\r\n\t\u0000"';
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('seeded')) return; // seed once, not on every navigation
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key!, value!);
    },
    [MAIN_KEY, garbage],
  );
  await page.goto('/');
  await expect(page.locator('.banner')).toContainText("couldn't be read");
  const button = page.getByRole('button', { name: 'Download the unreadable data' });
  await expect(button).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), MAIN_KEY)).toBe(garbage);

  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^eisenhower-unreadable-.*\.json$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  expect((await readFile(path)).equals(Buffer.from(garbage, 'utf8'))).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), MAIN_KEY)).toBe(garbage);
});

test('AC12: a task added in one tab appears in another', async ({ context }) => {
  const one = await context.newPage();
  const two = await context.newPage();
  await one.goto('/');
  await two.goto('/');
  await addByKeyboard(one, 'Seen everywhere', 'n', 'y');
  await expect(one.locator('.q--delegate .task__title')).toHaveText('Seen everywhere');
  await expect(two.locator('.q--delegate .task__title')).toHaveText('Seen everywhere');
  await expect(two.locator('.toast-slot')).toContainText('Updated from another tab');
  await expect(two.locator('.banner')).toHaveCount(0);
});

/** Counts `storage` events in a page, so a test can wait until one has really arrived. */
async function countStorageEvents(page: Page) {
  await page.evaluate(() =>
    window.addEventListener('storage', () => {
      const w = window as unknown as { storageEvents?: number };
      w.storageEvents = (w.storageEvents ?? 0) + 1;
    }),
  );
}
async function storageEventsReach(page: Page, n: number) {
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { storageEvents?: number }).storageEvents ?? 0))
    .toBeGreaterThanOrEqual(n);
}

/** addByKeyboard for a page that may already have focus in the capture box ('/' would be typed). */
async function addAgain(page: Page, title: string, important: 'y' | 'n', urgent: 'y' | 'n') {
  await page.locator('.capture__input').blur();
  await addByKeyboard(page, title, important, urgent);
}

test('AC12: another tab saving mid-typing leaves the field alone; the edit saves on top of it', async ({ context }) => {
  const one = await context.newPage();
  const two = await context.newPage();
  await one.goto('/');
  await two.goto('/');
  await countStorageEvents(two);
  await addAgain(one, 'Delegated', 'n', 'y');
  await addAgain(one, 'Planned', 'y', 'n');
  await storageEventsReach(two, 2);

  const who = two.locator('.q--delegate .task__who');
  await who.click();
  await two.keyboard.type('Sa');
  await addAgain(one, 'Third', 'n', 'y');
  await storageEventsReach(two, 3);
  await expect(who).toBeFocused();
  await expect(who).toHaveValue('Sa');
  await two.keyboard.type('m');
  await two.keyboard.press('Tab');
  await expect(two.locator('.q--delegate .task__title')).toHaveText(['Delegated', 'Third']);

  const when = two.locator('.q--schedule .task__when');
  await when.focus(); // the month segment
  await two.keyboard.type('10');
  await addAgain(one, 'Fourth', 'n', 'y');
  await storageEventsReach(two, 4);
  await expect(when).toBeFocused();
  await two.keyboard.type('252026');
  await two.keyboard.press('Tab');

  const saved = await two.evaluate((k) => JSON.parse(localStorage.getItem(k)!), MAIN_KEY);
  expect(saved.tasks.map((t: { title: string; who?: string; when?: string }) => [t.title, t.who ?? '', t.when ?? ''])).toEqual([
    ['Delegated', 'Sam', ''],
    ['Planned', '', '2026-10-25'],
    ['Third', '', ''],
    ['Fourth', '', ''],
  ]);
  await expect(one.locator('.q--delegate .task__who').first()).toHaveValue('Sam');
  await expect(two.locator('.banner')).toHaveCount(0);
  await expect(one.locator('.banner')).toHaveCount(0);
});
