/**
 * Screenshots of the design for docs/screenshots (and the README). Not a test: it is skipped
 * unless SCREENSHOTS=1, so CI never rewrites the images.
 *
 *   SCREENSHOTS=1 npx playwright test screenshots
 *
 * The paper grain is noise, which PNG cannot compress, so shots of one part of the page are
 * clipped to that part. SCREENSHOT_EXTRA=<dir> also writes review-only shots (hover, focus,
 * print-in mid-frame, the dialog in each theme and width, a rejected file) to that directory.
 */
import { test, expect, type Page } from '@playwright/test';
import { MAIN_KEY, seededBoard } from './fixtures/board';

const OUT = 'docs/screenshots';
const EXTRA = process.env.SCREENSHOT_EXTRA;

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to regenerate docs/screenshots');

const DESKTOP = { width: 1280, height: 860 };
const MOBILE = { width: 375, height: 812 };

async function seed(page: Page, raw = seededBoard()) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key!, value!);
    },
    [MAIN_KEY, raw],
  );
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('.task').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Picks a file through the real Import button, so the dialog is the app's own markup. */
async function chooseImport(page: Page, name: string, text: string) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.transfer__import').click()]);
  await chooser.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.import-confirm__cancel')).toBeFocused();
  await page.mouse.move(0, 0);
}

/** An eight-task export, as another browser would have saved it. */
const exported = () => {
  const board = JSON.parse(seededBoard());
  board.tasks = board.tasks.slice(0, 8);
  return JSON.stringify(board);
};

/** The page footer, with `above` px of the board over it, in full-page coordinates. */
async function footerClip(page: Page, above: number) {
  const { w, top, bottom } = await page.evaluate(() => {
    const r = document.querySelector('.footer')!.getBoundingClientRect();
    return { w: window.innerWidth, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  });
  return { x: 0, y: top - above, width: w, height: bottom - top + above + 24 };
}

for (const scheme of ['light', 'dark'] as const) {
  for (const [name, size] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
    test(`board ${scheme} ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await seed(page);
      await ready(page);
      await page.screenshot({ path: `${OUT}/board-${scheme}-${name}.png`, fullPage: name === 'mobile' });
    });
  }
}

test('triage prompt mid-question', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.keyboard.press('/');
  await page.keyboard.type('Renew the domain before it lapses');
  await page.keyboard.press('Enter');
  await page.keyboard.press('y');
  await expect(page.locator('.prompt__question')).toHaveText('Urgent?');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/triage-prompt.png`, clip: { x: 0, y: 0, width: DESKTOP.width, height: 520 } });
});

test('review prompt', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.keyboard.press('r');
  await expect(page.locator('.prompt__progress')).toHaveText('1 of 9');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/review-prompt.png`, clip: { x: 0, y: 0, width: DESKTOP.width, height: 520 } });
});

test('undo toast', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.locator('.q--delete .task').first().focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.toast__undo')).toBeVisible();
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 1800; }));
  const clip = { x: 0, y: DESKTOP.height - 360, width: DESKTOP.width, height: 360 };
  await page.screenshot({ path: `${OUT}/undo-toast.png`, clip });
});

test('banner', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page, '{"version":1,"rev":2,"tasks":[{"id":"a"');
  await page.goto('/');
  await expect(page.locator('.banner')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/banner.png`, clip: { x: 0, y: 0, width: DESKTOP.width, height: 420 } });
});

test('footer and import dialog', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.screenshot({ path: `${OUT}/footer.png`, fullPage: true, clip: await footerClip(page, 140) });
  await chooseImport(page, 'eisenhower-2026-10-12.json', exported());
  await page.screenshot({ path: `${OUT}/import-light.png`, clip: { x: 0, y: 160, width: DESKTOP.width, height: 560 } });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize(MOBILE);
  await page.screenshot({ path: `${OUT}/import-dark-mobile.png` });
});

test('review-only extras', async ({ page }) => {
  test.skip(!EXTRA, 'set SCREENSHOT_EXTRA=<dir>');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(DESKTOP);
    await seed(page);
    await ready(page);

    // Hovered row: the action keycaps.
    await page.locator('.q--schedule .task').first().hover();
    await page.screenshot({ path: `${EXTRA}/hover-${scheme}.png`, clip: { x: 0, y: 200, width: 1280, height: 420 } });

    // A focused row, by keyboard: the actions show without a pointer.
    await page.mouse.move(0, 0);
    await page.locator('.q--do .task').first().focus();
    await page.keyboard.press('ArrowDown');
    await page.screenshot({ path: `${EXTRA}/focus-${scheme}.png`, clip: { x: 0, y: 200, width: 1280, height: 420 } });

    // Print-in, paused 60 ms in, and the slip holding the destination.
    await page.locator('.capture__input').focus();
    await page.keyboard.type('Approve the new logo');
    await page.keyboard.press('Enter');
    await page.keyboard.press('y');
    await page.keyboard.press('y');
    await page.evaluate(() =>
      document.getAnimations().forEach((a) => {
        a.pause();
        a.currentTime = 60;
      }),
    );
    await page.screenshot({ path: `${EXTRA}/print-in-${scheme}.png` });
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));

    await page.screenshot({ path: `${EXTRA}/footer-${scheme}.png`, fullPage: true, clip: await footerClip(page, 140) });
    await chooseImport(page, 'eisenhower-2026-10-12.json', exported());
    await page.screenshot({ path: `${EXTRA}/import-${scheme}.png` });
    await page.keyboard.press('Escape');
    await chooseImport(page, 'notes.json', '{"hello":');
    await page.screenshot({ path: `${EXTRA}/import-rejected-${scheme}.png` });
    await page.keyboard.press('Escape');

    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${EXTRA}/footer-${scheme}-mobile.png`, fullPage: true, clip: await footerClip(page, 140) });
    await chooseImport(page, 'eisenhower-2026-10-12.json', exported());
    await page.screenshot({ path: `${EXTRA}/import-${scheme}-mobile.png` });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${EXTRA}/board-${scheme}-mobile-full.png`, fullPage: true });
    await page.evaluate(() => sessionStorage.clear());
  }
});

test('review-only extras: done rows and touch', async ({ browser }) => {
  test.skip(!EXTRA, 'set SCREENSHOT_EXTRA=<dir>');
  for (const scheme of ['light', 'dark'] as const) {
    const context = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true, colorScheme: scheme });
    const page = await context.newPage();
    await seed(page);
    await ready(page);
    for (const q of ['schedule', 'delegate', 'delete']) await page.locator(`.q--${q} .task__check`).last().click();
    await page.locator('.q--schedule').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EXTRA}/touch-done-${scheme}.png` });
    await context.close();
  }
});
