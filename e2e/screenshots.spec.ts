/**
 * Screenshots of the design for docs/screenshots (and the README). Not a test: it is skipped
 * unless SCREENSHOTS=1, so CI never rewrites the images.
 *
 *   SCREENSHOTS=1 npx playwright test screenshots
 *
 * SCREENSHOT_EXTRA=<dir> also writes review-only shots (hover, print-in mid-frame, a mocked
 * import dialog) to that directory.
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
  await page.screenshot({ path: `${OUT}/triage-prompt.png` });
});

test('review prompt', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.keyboard.press('r');
  await expect(page.locator('.prompt__progress')).toHaveText('1 of 9');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/review-prompt.png` });
});

test('undo toast', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page);
  await ready(page);
  await page.locator('.q--delete .task').first().focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('.toast__undo')).toBeVisible();
  await page.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 1800; }));
  await page.screenshot({ path: `${OUT}/undo-toast.png` });
});

test('banner', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await seed(page, '{"version":1,"rev":2,"tasks":[{"id":"a"');
  await page.goto('/');
  await expect(page.locator('.banner')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/banner.png` });
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

    // A focused row.
    await page.locator('.q--do .task').nth(1).focus();
    await page.mouse.move(0, 0);
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

    // A mocked import dialog (T11's markup), to check the panel's look.
    await page.evaluate(() => {
      const footer = document.querySelector('.footer')!;
      const wrap = document.createElement('div');
      wrap.className = 'transfer';
      wrap.innerHTML =
        '<button type="button" class="transfer__export">Export</button><button type="button" class="transfer__import">Import</button><input type="file" class="transfer__file" hidden>' +
        '<div class="import-confirm" role="dialog" aria-modal="true"><p class="import-confirm__text">Replace your 10 tasks with 8 tasks from eisenhower-2026-10-12.json? Your current tasks are backed up first.</p><p class="import-confirm__error" role="alert"></p><button type="button" class="import-confirm__replace">Replace</button><button type="button" class="import-confirm__cancel">Cancel</button></div>';
      footer.append(wrap);
      for (const el of document.querySelectorAll('#app > :not(.footer)')) el.setAttribute('inert', '');
      (document.querySelector('.import-confirm__cancel') as HTMLElement).focus();
    });
    await page.screenshot({ path: `${EXTRA}/import-${scheme}.png` });

    await page.setViewportSize(MOBILE);
    await page.screenshot({ path: `${EXTRA}/import-${scheme}-mobile.png` });
    await page.evaluate(() => {
      document.querySelector('.import-confirm')!.remove();
      for (const el of document.querySelectorAll('[inert]')) el.removeAttribute('inert');
    });
    await page.screenshot({ path: `${EXTRA}/footer-${scheme}-mobile.png`, fullPage: true });
    await page.evaluate(() => sessionStorage.clear());
  }
});
