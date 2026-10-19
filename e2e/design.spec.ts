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

/** Every colour token in docs/design.md, per theme. The four band inks are the same in both. */
const BANDS = { do: '#FF48B0', schedule: '#0078BF', delegate: '#FFE800', delete: '#A5AAA8' } as const;
const SPEC = {
  light: {
    paper: '#F1F2EE',
    sheet: '#FAFAF7',
    ink: '#1B2340',
    'ink-muted': '#545B73',
    rule: '#C9CCD3',
    'do-tint': '#FFD9EC',
    'schedule-tint': '#CCE4F2',
    'delegate-tint': '#FFF8B3',
    'delete-tint': '#E3E5E4',
    danger: '#C8102E',
    ...BANDS,
  },
  dark: {
    paper: '#121315',
    sheet: '#1C1E22',
    ink: '#ECEDE8',
    'ink-muted': '#A3A8B8',
    rule: '#33363D',
    'do-tint': '#3A1A2C',
    'schedule-tint': '#0F2A3D',
    'delegate-tint': '#2E2A0C',
    'delete-tint': '#26292B',
    danger: '#FF5A6E',
    ...BANDS,
  },
} as const;

/** '#RRGGBB' → the 'rgb(r, g, b)' a computed style reports. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

for (const scheme of ['light', 'dark'] as const) {
  test(`tokens resolve to the spec's exact hexes (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const names = Object.keys(SPEC[scheme]);
    const tokens = await page.evaluate((names) => {
      const s = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((n) => [n, s.getPropertyValue(`--${n}`).trim().toUpperCase()]));
    }, names);
    expect(tokens).toEqual(SPEC[scheme]);

    // And the painted colours, not just the declarations.
    const body = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return { background: s.backgroundColor, color: s.color };
    });
    expect(body).toEqual({ background: rgb(SPEC[scheme].paper), color: rgb(SPEC[scheme].ink) });
    for (const [q, hex] of Object.entries(BANDS)) {
      await expect(page.locator(`.q--${q} .q__band`)).toHaveCSS('background-color', rgb(hex));
      await expect(page.locator(`.q--${q}`)).toHaveCSS('background-color', rgb(SPEC[scheme][`${q as keyof typeof BANDS}-tint`]));
    }
  });
}

test('the triage prompt drops over the board without moving it', async ({ page }) => {
  await seed(page);
  await page.goto('/');
  await expect(page.locator('.task').first()).toBeVisible();
  const before = await page.locator('.board').boundingBox();
  await page.locator('.capture__input').focus();
  await page.keyboard.type('Does the board move?');
  await page.keyboard.press('Enter');
  await expect(page.locator('.prompt')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.prompt')).toBeVisible();
  expect(await page.locator('.board').boundingBox()).toEqual(before);
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test(`print-in and the mini-matrix ${motion === 'reduce' ? 'stay still' : 'animate'} (prefers-reduced-motion: ${motion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto('/');
    await page.locator('.capture__input').focus();
    await page.keyboard.type('Land me');
    await page.keyboard.press('Enter');
    await expect(page.locator('.prompt__question')).toHaveText('Important?');
    const mini = await page.locator('.mini__sq').first().evaluate((sq) => getComputedStyle(sq).transitionDuration);
    await page.keyboard.press('y');
    await page.keyboard.press('y');
    const row = page.locator('.q--do .task.is-new');
    await expect(row).toHaveCount(1);
    const names = await row.evaluate((li) => [
      getComputedStyle(li).animationName,
      getComputedStyle(li.querySelector('.task__title')!).animationName,
    ]);
    if (motion === 'reduce') {
      expect(mini).toBe('0s');
      expect(names).toEqual(['none', 'none']);
    } else {
      expect(mini).not.toBe('0s');
      expect(names).toEqual(['print-in', 'print-in-text']);
    }
  });
}
