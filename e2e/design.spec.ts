/** T12: the visual design's checkable promises — no sideways scroll on a phone (AC8), no third-party requests (AC14), exact spec colours. */
import { test, expect, type Page } from '@playwright/test';
import { MAIN_KEY, seededBoard } from './fixtures/board';

async function seed(page: Page) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(key!, value!);
    },
    [MAIN_KEY, seededBoard()],
  );
}

async function addByKeyboard(page: Page, title: string, important: 'y' | 'n', urgent: 'y' | 'n') {
  await page.locator('.capture__input').focus();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.prompt__question')).toHaveText('Important?');
  await page.keyboard.press(important);
  await expect(page.locator('.prompt__question')).toHaveText('Urgent?');
  await page.keyboard.press(urgent);
}

test('AC8: at 375×812 nothing scrolls sideways, and all four quadrants are there', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seed(page);
  await page.goto('/');
  await expect(page.locator('.task').first()).toBeVisible();
  // The worst cases for width: a 200-character title with no spaces, and a long Waiting on.
  await addByKeyboard(page, 'x'.repeat(200), 'n', 'y');
  const who = page.locator('.q--delegate .task__who').last();
  await who.fill('Someone with a very long name indeed, from the accounts team');
  await who.press('Tab');
  await expect(page.locator('.q--delegate .stamp--waiting').last()).toBeVisible();

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

  for (const q of ['do', 'schedule', 'delegate', 'delete']) {
    const section = page.locator(`section.q--${q}`);
    await expect(section).toHaveCount(1);
    await section.scrollIntoViewIfNeeded();
    await expect(section).toBeInViewport();
  }
  // Below 640px the axes hide and each band carries its axis pair instead.
  await expect(page.locator('.axis').first()).toBeHidden();
  await expect(page.locator('.q--do .q__axes')).toBeVisible();
});

test('AC14: every request in a session goes to the app’s own origin, fonts included', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));

  await page.goto('/');
  await addByKeyboard(page, 'Stay on this origin', 'y', 'y');
  await expect(page.locator('.q--do .task__title')).toHaveText('Stay on this origin');
  await page.reload();
  await expect(page.locator('.q--do .task__title')).toHaveText('Stay on this origin');
  await page.evaluate(() => document.fonts.ready);

  const network = urls.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(network.length).toBeGreaterThan(0);
  for (const url of network) expect(new URL(url).origin, url).toBe(origin);
  // The fonts really were fetched, and from here: bundled, not linked from a font CDN.
  expect(network.some((u) => u.endsWith('.woff2'))).toBe(true);
});

const SPEC = {
  light: { paper: '#F1F2EE', ink: '#1B2340' },
  dark: { paper: '#121315', ink: '#ECEDE8' },
} as const;
const BANDS = { do: '#FF48B0', schedule: '#0078BF', delegate: '#FFE800', delete: '#A5AAA8' } as const;

/** '#RRGGBB' → the 'rgb(r, g, b)' a computed style reports. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

for (const scheme of ['light', 'dark'] as const) {
  test(`tokens resolve to the spec's exact hexes (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const tokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const get = (name: string) => s.getPropertyValue(name).trim().toUpperCase();
      return {
        paper: get('--paper'),
        ink: get('--ink'),
        do: get('--do'),
        schedule: get('--schedule'),
        delegate: get('--delegate'),
        delete: get('--delete'),
      };
    });
    expect(tokens).toEqual({ ...SPEC[scheme], ...BANDS });

    // And the painted colours, not just the declarations.
    const body = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { background: s.backgroundColor, color: s.color };
    });
    expect(body).toEqual({ background: rgb(SPEC[scheme].paper), color: rgb(SPEC[scheme].ink) });
    for (const [q, hex] of Object.entries(BANDS)) {
      await expect(page.locator(`.q--${q} .q__band`)).toHaveCSS('background-color', rgb(hex));
    }
  });
}
