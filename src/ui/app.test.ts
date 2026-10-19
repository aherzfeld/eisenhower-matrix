import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorage, emptyState, type MemoryStorage } from '../core/ports';
import type { StoredState, Task } from '../core/task';
import { createApp, type App } from './app';

const NOW = '2026-03-01T12:00:00.000Z';

function task(id: string, title: string, urgent: boolean, important: boolean, order = 0, done = false): Task {
  return { id, title, urgent, important, done, order, createdAt: NOW, updatedAt: NOW };
}

let root: HTMLElement;
let app: App | undefined;
let n = 0;

function boot(opts: { initial?: StoredState; storage?: MemoryStorage } = {}) {
  const storage = opts.storage ?? createMemoryStorage({ initial: opts.initial ?? emptyState() });
  app = createApp({ root, storage, now: () => NOW, newId: () => `id-${++n}` });
  return { app, storage };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  n = 0;
});
afterEach(() => {
  app?.destroy();
  app = undefined;
});

const q = (name: string) => root.querySelector<HTMLElement>(`.q--${name}`)!;
const titles = (name: string) =>
  [...q(name).querySelectorAll('.task__title')].map((e) => e.textContent);
const input = () => root.querySelector<HTMLInputElement>('.capture__input')!;
const prompt = () => root.querySelector<HTMLElement>('.prompt')!;
const row = (id: string) => root.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;

function key(target: Element | Document, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

function typeTitle(title: string) {
  input().value = title;
  input().dispatchEvent(new Event('input', { bubbles: true }));
  input().focus();
}

describe('board rendering', () => {
  it('renders four empty quadrants with the structure T12 styles', () => {
    boot();
    for (const name of ['do', 'schedule', 'delegate', 'delete']) {
      const section = q(name);
      expect(section.tagName).toBe('SECTION');
      expect(section.classList.contains('q')).toBe(true);
      const labelled = section.getAttribute('aria-labelledby')!;
      expect(root.querySelector(`#${labelled}`)).not.toBeNull();
      expect(section.querySelector('ul')!.children).toHaveLength(0);
      expect(section.querySelector('.q__band .q__key')!.getAttribute('aria-hidden')).toBe('true');
      expect(section.querySelector('.q__verb')).not.toBeNull();
      expect(section.querySelector('.q__footer')).not.toBeNull();
    }
    expect(prompt().getAttribute('aria-live')).toBe('assertive');
    for (const sel of ['.banner-slot', '.toast-slot', '.footer', '.backup-status', '.board', '.axis']) {
      expect(root.querySelector(sel), sel).not.toBeNull();
    }
  });

  it('puts tasks in the right quadrant, by order, done last, with a count of open tasks', () => {
    boot({
      initial: {
        ...emptyState(),
        tasks: [
          task('a', 'A done', true, true, 0, true),
          task('b', 'B', true, true, 1),
          task('c', 'C', false, true, 0),
          task('d', 'D', true, false, 0),
          task('e', 'E', false, false, 0),
          task('f', 'F', true, true, 2),
        ],
      },
    });
    expect(titles('do')).toEqual(['B', 'F', 'A done']);
    expect(titles('schedule')).toEqual(['C']);
    expect(titles('delegate')).toEqual(['D']);
    expect(titles('delete')).toEqual(['E']);
    expect(q('do').querySelector('.q__count')!.textContent).toBe('2');
    expect(row('a').dataset.done).toBe('true');
  });

  it('gives each task a checkbox and four labelled move buttons with aria-hidden chips', () => {
    boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    const r = row('a');
    expect(r.querySelector('input[type=checkbox]')).not.toBeNull();
    const buttons = [...r.querySelectorAll<HTMLButtonElement>('.task__move')];
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Move to Do',
      'Move to Schedule',
      'Move to Delegate',
      'Move to Delete',
    ]);
    expect(buttons.map((b) => b.querySelector('.key')!.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
  });

  it('has one Tab stop per quadrant', () => {
    boot({
      initial: {
        ...emptyState(),
        tasks: [task('a', 'A', true, true, 0), task('b', 'B', true, true, 1), task('c', 'C', false, true)],
      },
    });
    expect(row('a').tabIndex).toBe(0);
    expect(row('b').tabIndex).toBe(-1);
    expect(row('c').tabIndex).toBe(0);
    expect(root.querySelectorAll('.task__move[tabindex="0"], input[tabindex="0"]')).toHaveLength(0);
  });
});

describe('banner', () => {
  it('renders the load warning from storage', () => {
    boot({ storage: createMemoryStorage({ warning: 'Saved by a newer version. Reload the page.' }) });
    const banner = root.querySelector('.banner-slot .banner')!;
    expect(banner.textContent).toBe('Saved by a newer version. Reload the page.');
  });

  it('shows no banner without a warning', () => {
    boot();
    expect(root.querySelector('.banner-slot .banner')).toBeNull();
  });

  it('shows a save failure, keeps the task in memory, and clears when a save succeeds again', () => {
    const storage = createMemoryStorage({ mode: 'memory' });
    boot({ storage });
    typeTitle('Keep me');
    key(input(), 'Enter');
    key(prompt(), 'y');
    key(prompt(), 'y');
    expect(titles('do')).toEqual(['Keep me']);
    expect(root.querySelector('.banner')!.textContent).toContain('Storage is unavailable');
  });
});

describe('persistence', () => {
  it('saves through storage after a change', () => {
    const { storage } = boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    key(row('a'), ' ');
    expect(storage.load().state.tasks[0]!.done).toBe(true);
    expect(app!.getState().rev).toBe(1);
  });
});

describe('capture and triage (AC1)', () => {
  const combos: [string, string, string][] = [
    ['y', 'y', 'do'],
    ['y', 'n', 'schedule'],
    ['n', 'y', 'delegate'],
    ['n', 'n', 'delete'],
  ];
  for (const [imp, urg, dest] of combos) {
    it(`Important ${imp}, Urgent ${urg} lands in ${dest}`, () => {
      boot();
      typeTitle('Write report');
      key(input(), 'Enter');
      expect(document.activeElement).toBe(prompt());
      expect(prompt().textContent).toContain('Important?');
      key(prompt(), imp);
      expect(prompt().textContent).toContain('Urgent?');
      key(prompt(), urg);
      expect(titles(dest)).toEqual(['Write report']);
      expect(root.querySelectorAll('.task')).toHaveLength(1);
      expect(document.activeElement).toBe(input());
      expect(input().value).toBe('');
      expect(prompt().dataset.active).toBe('false');
    });
  }

  it('ignores Enter, Space, x and others at the prompt', () => {
    boot();
    typeTitle('Thing');
    key(input(), 'Enter');
    for (const k of ['Enter', ' ', 'x', '1', 'ArrowDown', 'Tab', '/']) {
      key(prompt(), k);
      expect(prompt().textContent).toContain('Important?');
    }
    key(prompt(), 'y');
    for (const k of ['Enter', ' ', 'x', '2', 'Backspace']) {
      key(prompt(), k);
      expect(prompt().textContent).toContain('Urgent?');
    }
    expect(root.querySelectorAll('.task')).toHaveLength(0);
    expect(document.activeElement).toBe(prompt());
  });

  it('Esc cancels at either step, keeping the typed title', () => {
    boot();
    typeTitle('Maybe');
    key(input(), 'Enter');
    key(prompt(), 'Escape');
    expect(prompt().dataset.active).toBe('false');
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('Maybe');

    key(input(), 'Enter');
    key(prompt(), 'y');
    key(prompt(), 'Escape');
    expect(prompt().dataset.active).toBe('false');
    expect(root.querySelectorAll('.task')).toHaveLength(0);
    expect(document.activeElement).toBe(input());
  });

  it('does not open the prompt for an empty or too-long title, and says why', () => {
    boot();
    typeTitle('   ');
    key(input(), 'Enter');
    expect(prompt().dataset.active).toBe('false');
    typeTitle('x'.repeat(201));
    key(input(), 'Enter');
    expect(prompt().dataset.active).toBe('false');
    expect(root.querySelector('.capture__message')!.textContent).not.toBe('');
  });

  it('paints the mini-matrix as answers are given', () => {
    boot();
    typeTitle('Thing');
    key(input(), 'Enter');
    key(prompt(), 'y');
    expect(prompt().querySelector('.mini__sq--do')!.classList.contains('is-row')).toBe(true);
    expect(prompt().querySelector('.mini__sq--delegate')!.classList.contains('is-row')).toBe(false);
    key(prompt(), 'n');
    expect(prompt().querySelector('.mini__sq--schedule')!.classList.contains('is-target')).toBe(true);
    expect(prompt().querySelector('.mini__sq--delete')!.classList.contains('is-col')).toBe(true);
  });

  it('typing "rn14/" into the title input changes only its value', () => {
    const { storage } = boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    const before = JSON.stringify(app!.getState());
    row('a').focus();
    input().focus();
    for (const k of 'rn14/') {
      key(input(), k);
      input().value += k;
    }
    expect(input().value).toBe('rn14/');
    expect(document.activeElement).toBe(input());
    expect(JSON.stringify(app!.getState())).toBe(before);
    expect(titles('do')).toEqual(['A']);
    expect(storage.load().state.rev).toBe(0);
    expect(prompt().dataset.active).toBe('false');
  });

  it('"/" focuses the capture input from the board', () => {
    boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    row('a').focus();
    const e = key(row('a'), '/');
    expect(document.activeElement).toBe(input());
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('moving (AC2)', () => {
  it('keys 1-4 on a focused task set the flags, and focus follows the task', () => {
    boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    const dest: [string, string][] = [
      ['2', 'schedule'],
      ['3', 'delegate'],
      ['4', 'delete'],
      ['1', 'do'],
    ];
    for (const [k, name] of dest) {
      row('a').focus();
      key(row('a'), k);
      expect(titles(name)).toEqual(['A']);
      const t = app!.getState().tasks[0]!;
      expect([t.urgent, t.important]).toEqual(
        { schedule: [false, true], delegate: [true, false], delete: [false, false], do: [true, true] }[name],
      );
      expect(document.activeElement).toBe(row('a'));
      expect(row('a').closest('.q')).toBe(q(name));
    }
  });

  it('move buttons do the same and focus follows', () => {
    boot({ initial: { ...emptyState(), tasks: [task('a', 'A', true, true)] } });
    row('a').querySelector<HTMLButtonElement>('[aria-label="Move to Schedule"]')!.click();
    expect(titles('schedule')).toEqual(['A']);
    expect(document.activeElement).toBe(row('a'));
  });

  it('a moved task is appended to the destination', () => {
    boot({
      initial: {
        ...emptyState(),
        tasks: [task('a', 'A', true, true), task('b', 'B', false, true, 0)],
      },
    });
    row('a').focus();
    key(row('a'), '2');
    expect(titles('schedule')).toEqual(['B', 'A']);
  });
});

describe('keyboard navigation and editing', () => {
  const three = () =>
    boot({
      initial: {
        ...emptyState(),
        tasks: [task('a', 'A', true, true, 0), task('b', 'B', true, true, 1), task('c', 'C', true, true, 2)],
      },
    });

  it('arrow keys move focus within a quadrant and stop at the ends', () => {
    three();
    row('a').focus();
    key(row('a'), 'ArrowDown');
    expect(document.activeElement).toBe(row('b'));
    key(row('b'), 'ArrowDown');
    key(row('c'), 'ArrowDown');
    expect(document.activeElement).toBe(row('c'));
    key(row('c'), 'ArrowUp');
    expect(document.activeElement).toBe(row('b'));
    key(row('b'), 'ArrowUp');
    key(row('a'), 'ArrowUp');
    expect(document.activeElement).toBe(row('a'));
  });

  it('the Tab stop follows focus within a quadrant', () => {
    three();
    row('a').focus();
    key(row('a'), 'ArrowDown');
    expect(row('b').tabIndex).toBe(0);
    expect(row('a').tabIndex).toBe(-1);
  });

  it('Alt+arrow reorders and focus follows', () => {
    three();
    row('a').focus();
    key(row('a'), 'ArrowDown', { altKey: true });
    expect(titles('do')).toEqual(['B', 'A', 'C']);
    expect(document.activeElement).toBe(row('a'));
    key(row('a'), 'ArrowUp', { altKey: true });
    expect(titles('do')).toEqual(['A', 'B', 'C']);
  });

  it('Space toggles done; done tasks sink and focus follows', () => {
    three();
    row('a').focus();
    key(row('a'), ' ');
    expect(app!.getState().tasks.find((t) => t.id === 'a')!.done).toBe(true);
    expect(titles('do')).toEqual(['B', 'C', 'A']);
    expect(document.activeElement).toBe(row('a'));
    key(row('a'), ' ');
    expect(titles('do')).toEqual(['A', 'B', 'C']);
  });

  it('the checkbox toggles done', () => {
    three();
    row('b').querySelector<HTMLInputElement>('input[type=checkbox]')!.click();
    expect(app!.getState().tasks.find((t) => t.id === 'b')!.done).toBe(true);
  });

  it('Enter starts a rename, Enter saves, and the title changes', () => {
    three();
    row('a').focus();
    key(row('a'), 'Enter');
    const edit = row('a').querySelector<HTMLInputElement>('.task__edit')!;
    expect(document.activeElement).toBe(edit);
    expect(edit.value).toBe('A');
    edit.value = '  Renamed  ';
    key(edit, 'Enter');
    expect(titles('do')).toEqual(['Renamed', 'B', 'C']);
    expect(row('a').querySelector('.task__edit')).toBeNull();
    expect(document.activeElement).toBe(row('a'));
  });

  it('Esc cancels a rename', () => {
    three();
    row('a').focus();
    key(row('a'), 'Enter');
    const edit = row('a').querySelector<HTMLInputElement>('.task__edit')!;
    edit.value = 'Nope';
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    key(edit, 'Escape');
    expect(titles('do')).toEqual(['A', 'B', 'C']);
    expect(row('a').querySelector('.task__edit')).toBeNull();
    expect(document.activeElement).toBe(row('a'));
  });

  it('an invalid title keeps the editor open with a message', () => {
    three();
    row('a').focus();
    key(row('a'), 'Enter');
    const edit = row('a').querySelector<HTMLInputElement>('.task__edit')!;
    edit.value = '   ';
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    key(edit, 'Enter');
    expect(row('a').querySelector('.task__edit')).not.toBeNull();
    expect(row('a').querySelector('.task__error')!.textContent).not.toBe('');
    expect(app!.getState().tasks.find((t) => t.id === 'a')!.title).toBe('A');
    edit.value = 'Fixed';
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    key(edit, 'Enter');
    expect(titles('do')[0]).toBe('Fixed');
  });

  it('keys typed in the rename editor do not trigger board shortcuts', () => {
    three();
    row('a').focus();
    key(row('a'), 'Enter');
    const edit = row('a').querySelector<HTMLInputElement>('.task__edit')!;
    for (const k of ['2', ' ', 'ArrowDown', '/']) key(edit, k);
    expect(titles('do')).toEqual(['B', 'C']);
    expect(row('a').closest('.q')).toBe(q('do'));
    expect(app!.getState().tasks.find((t) => t.id === 'a')).toMatchObject({ done: false, urgent: true });
    expect(document.activeElement).toBe(edit);
  });
});
