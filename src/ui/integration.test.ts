/**
 * T10: the app over the real localStorage adapter (createBrowserStorage), with a stubbed
 * localStorage shared between "tabs". AC3, AC4/AC5 banners, AC12, the backup reminder,
 * no-op saves, and undo across a reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serialize } from '../core/codec';
import { createTask, setFlags, setWho, toggleDone, type StoredState, type Task } from '../core/task';
import { MAIN_KEY, WARNINGS, createBrowserStorage, type KeyValueStore } from '../io/storage';
import { NOT_SAVED_CONFLICT, createApp, type App } from './app';
import { EARLIER_UNREADABLE } from './banner';

const NOW = '2026-10-19T12:00:00.000Z';
const ok = (value: Task[]) => ({ ok: true as const, value });

function task(id: string, title: string, urgent: boolean, important: boolean, over: Partial<Task> = {}): Task {
  return { id, title, urgent, important, done: false, order: 0, createdAt: NOW, updatedAt: NOW, ...over };
}
const stateWith = (tasks: Task[], over: Partial<StoredState> = {}): StoredState => ({ version: 1, rev: 3, tasks, ...over });

/** One localStorage shared by every tab, recording writes, and able to fail on demand. */
class SharedStore implements KeyValueStore {
  data = new Map<string, string>();
  writes: string[] = [];
  failGet: (() => unknown) | null = null;
  failSet: ((key: string) => unknown) | null = null;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v);
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    const e = this.failGet?.();
    if (e) throw e;
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const e = this.failSet?.(key);
    if (e) throw e;
    this.writes.push(key);
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const quota = () => new DOMException('full', 'QuotaExceededError');

type Tab = {
  name: string;
  root: HTMLElement;
  app: App;
  events: EventTarget;
  /** Delivers the `storage` event a browser fires in this tab when another tab writes. */
  notify(key?: string | null): void;
  titles(q: string): (string | null)[];
  banners(): (string | null)[];
  row(id: string): HTMLElement | null;
};

let tabs: Tab[] = [];
let clock: Date;

function openTab(ls: SharedStore | (() => KeyValueStore), name = `tab${tabs.length + 1}`): Tab {
  const root = document.createElement('div');
  document.body.append(root);
  const events = new EventTarget();
  const storage = createBrowserStorage({
    storage: typeof ls === 'function' ? ls : () => ls,
    now: () => clock.getTime(),
    events,
    navigator: {},
  });
  let n = 0;
  const app = createApp({ root, storage, now: () => clock.toISOString(), newId: () => `${name}-${++n}` });
  const tab: Tab = {
    name,
    root,
    app,
    events,
    notify: (key = MAIN_KEY) => void events.dispatchEvent(new StorageEvent('storage', { key })),
    titles: (q) => [...root.querySelectorAll(`.q--${q} .task__title`)].map((e) => e.textContent),
    banners: () => [...root.querySelectorAll('.banner-slot .banner')].map((e) => e.textContent),
    row: (id) => root.querySelector<HTMLElement>(`[data-task-id="${id}"]`),
  };
  tabs.push(tab);
  return tab;
}

const add = (tab: Tab, title: string, urgent = true, important = true, id?: string) =>
  tab.app.commit((tasks) => createTask(tasks, { title, urgent, important }, { id: id ?? `${tab.name}-${title}`, now: NOW }));
/**
 * A write by another tab with no app in this document. (Two apps in one jsdom document share
 * focus, which real tabs never do, so focus tests use this instead of a second app.)
 */
function writeElsewhere(ls: SharedStore, change: (tasks: Task[]) => Task[]) {
  const port = createBrowserStorage({ storage: () => ls, events: new EventTarget(), navigator: {} });
  const { state } = port.load();
  const r = port.save({ ...state, tasks: change(state.tasks) });
  if (!r.ok) throw new Error(r.error);
}
const storedTasks = (ls: SharedStore) => (JSON.parse(ls.data.get(MAIN_KEY)!) as StoredState).tasks;
const toastText = (tab: Tab) => tab.root.querySelector('.toast-slot')!.textContent;

beforeEach(() => {
  clock = new Date(2026, 9, 19, 9, 0, 0);
  document.body.innerHTML = '';
  tabs = [];
});
afterEach(() => {
  for (const t of tabs) t.app.destroy();
  tabs = [];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('reload keeps everything (AC3)', () => {
  it('a second boot on the same storage shows the same tasks, done states, when, who and order', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    add(a, 'First', false, true, 's1');
    add(a, 'Second', false, true, 's2');
    add(a, 'Wait', true, false, 'w');
    a.app.commit((tasks) => toggleDone(tasks, 's2', NOW));
    a.app.commit((tasks) => setWho(tasks, 'w', 'Sam', NOW));
    a.app.commit((tasks) => ok(tasks.map((t) => (t.id === 's1' ? { ...t, when: '2026-10-25' } : t))));
    a.app.destroy();
    const b = openTab(ls);
    expect(b.app.getState().tasks).toEqual(a.app.getState().tasks);
    expect(b.titles('schedule')).toEqual(['First', 'Second']);
    expect(b.banners()).toEqual([]);
  });
});

describe('another tab (AC12)', () => {
  it('A adds a task; B receives the storage event and shows it, with a brief notice, not a banner', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    const b = openTab(ls);
    add(a, 'From A');
    expect(b.titles('do')).toEqual([]);
    b.notify();
    expect(b.titles('do')).toEqual(['From A']);
    expect(toastText(b)).toContain('Updated from another tab');
    expect(b.banners()).toEqual([]);

    // B is now in step: its own change saves, and A picks it up the same way.
    b.app.commit((tasks) => toggleDone(tasks, 'tab1-From A', NOW));
    expect(storedTasks(ls)[0]!.done).toBe(true);
    a.notify();
    expect(a.app.getState().tasks[0]!.done).toBe(true);
  });

  it('ignores storage events for other keys, and reloads on a clear() (key null)', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    const b = openTab(ls);
    add(a, 'Kept');
    b.notify('eisenhower:backup:x');
    expect(b.titles('do')).toEqual([]);
    b.notify(null);
    expect(b.titles('do')).toEqual(['Kept']);
  });

  it('a stale save is refused: nothing written, the tab reloads, and the banner says one change was lost', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    const b = openTab(ls);
    add(a, 'From A');
    const before = ls.data.get(MAIN_KEY);
    add(b, 'From B'); // B never heard about A's save
    expect(ls.data.get(MAIN_KEY)).toBe(before);
    expect(b.titles('do')).toEqual(['From A']);
    expect(b.banners()).toEqual(["Changed in another tab. 1 change made here wasn't saved."]);
    // Back in step: the next change saves, and the banner clears.
    add(b, 'Again');
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['From A', 'Again']);
    expect(b.banners()).toEqual([]);
  });

  it('counts every change since the last good save: unsaved changes made in memory mode are reported, not dropped silently', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    const b = openTab(ls);
    add(b, 'Saved');
    a.notify();
    ls.failSet = () => quota();
    add(b, 'One');
    add(b, 'Two');
    b.app.commit((tasks) => toggleDone(tasks, 'tab2-Saved', NOW));
    expect(b.banners()).toEqual([WARNINGS.full]);
    ls.failSet = null;
    add(a, 'From A');
    b.notify();
    expect(b.titles('do')).toEqual(['Saved', 'From A']);
    expect(b.banners()).toEqual(["Changed in another tab. 3 changes made here weren't saved."]);
    expect(toastText(b)).not.toContain('Updated from another tab');
  });

  it('the same count when the loss is found at save time instead of by event', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    const b = openTab(ls);
    ls.failSet = () => quota();
    add(b, 'One');
    ls.failSet = null;
    add(a, 'From A');
    add(b, 'Two'); // conflict: A saved since B last loaded
    expect(b.banners()).toEqual(["Changed in another tab. 2 changes made here weren't saved."]);
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['From A']);
  });

  it('keeps focus on a task that still exists after a reload', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('x', 'Mine', true, true), task('w', 'Doomed', true, true, { order: 1 })]);
    const b = openTab(ls);
    b.row('x')!.focus();
    writeElsewhere(ls, (tasks) => [...tasks.filter((t) => t.id !== 'w'), task('y', 'Other', true, true, { order: 1 })]);
    b.notify();
    expect(b.titles('do')).toEqual(['Mine', 'Other']);
    expect(document.activeElement).toBe(b.row('x'));
  });

  it('does not tear down a field the user is typing in; the board catches up when they leave it', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('w', 'Delegate me', true, false)]);
    const b = openTab(ls);
    const who = b.row('w')!.querySelector<HTMLInputElement>('.task__who')!;
    who.focus();
    expect(document.activeElement).toBe(who);
    who.value = 'Sa'; // mid-typing, no change event yet
    writeElsewhere(ls, (tasks) => [...tasks, task('o', 'Other', true, false, { order: 1 })]);
    b.notify();
    expect(who.isConnected).toBe(true);
    expect(who.value).toBe('Sa');
    expect(b.app.getState().tasks.map((t) => t.id)).toEqual(['w', 'o']);
    who.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(b.titles('delegate')).toEqual(['Delegate me', 'Other']);
  });

  it('a Who? refused as stale says so beside the rebuilt field, not under the capture input (#14)', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('w', 'Delegate me', true, false)]);
    const b = openTab(ls);
    writeElsewhere(ls, (tasks) => [...tasks, task('o', 'Other', true, false, { order: 1 })]); // event not yet here
    const who = b.row('w')!.querySelector<HTMLInputElement>('.task__who')!;
    who.focus();
    who.value = 'Sam';
    who.dispatchEvent(new Event('change', { bubbles: true }));
    const field = b.row('w')!.querySelector<HTMLInputElement>('.task__who')!;
    const error = b.row('w')!.querySelector<HTMLElement>('.task__field-error')!;
    expect(error.textContent).toBe(NOT_SAVED_CONFLICT);
    expect(field.getAttribute('aria-describedby')).toBe(error.id);
    expect(b.root.querySelector('.capture__message')!.textContent).toBe('');
    field.value = 'Sam';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(storedTasks(ls).find((t) => t.id === 'w')!.who).toBe('Sam');
    expect(b.row('w')!.querySelector('.task__field-error')!.textContent).toBe('');
  });

  it('a rename refused as stale stays open with the draft, so Enter saves it on the fresh data', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('x', 'Old', true, true)]);
    const b = openTab(ls);
    b.row('x')!.querySelector<HTMLButtonElement>('.task__rename')!.click();
    const edit = b.root.querySelector<HTMLInputElement>('.task__edit')!;
    edit.value = 'New name';
    edit.dispatchEvent(new Event('input', { bubbles: true }));
    writeElsewhere(ls, (tasks) => [...tasks, task('y', 'Other', true, true, { order: 1 })]); // event not yet here
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['Old', 'Other']);
    expect(b.banners()).toEqual(["Changed in another tab. 1 change made here wasn't saved."]);
    const again = b.root.querySelector<HTMLInputElement>('.task__edit')!;
    expect(again.value).toBe('New name');
    expect(document.activeElement).toBe(again);
    expect(b.root.querySelector('.task__error')!.textContent).toBe(NOT_SAVED_CONFLICT);
    again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['New name', 'Other']);
    expect(b.root.querySelector('.task__edit')).toBeNull();
    expect(b.banners()).toEqual([]);
  });

  it('mid-review, a task another tab deleted is skipped at once', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('x', 'Gone task', true, true), task('y', 'Next task', true, true, { order: 1 })]);
    const b = openTab(ls);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    const prompt = () => b.root.querySelector('.prompt')!.textContent;
    expect(prompt()).toContain('Gone task');
    writeElsewhere(ls, (tasks) => tasks.filter((t) => t.id !== 'x'));
    b.notify();
    expect(prompt()).toContain('Next task');
    expect(prompt()).not.toContain('Gone task');
  });

  it('ends a rename whose task another tab deleted', () => {
    const ls = new SharedStore();
    writeElsewhere(ls, () => [task('x', 'Doomed', true, true)]);
    const b = openTab(ls);
    b.row('x')!.querySelector<HTMLButtonElement>('.task__rename')!.click();
    expect(document.activeElement).toBe(b.root.querySelector('.task__edit'));
    writeElsewhere(ls, () => []);
    b.notify();
    expect(b.root.querySelector('.task__edit')).toBeNull();
    expect(b.titles('do')).toEqual([]);
  });
});

describe('no-op changes do not save', () => {
  it('moving a task to the quadrant it is already in writes nothing and keeps the rev', () => {
    const ls = new SharedStore({ [MAIN_KEY]: serialize(stateWith([task('a', 'A', true, true)])) });
    const a = openTab(ls);
    const writes = ls.writes.length;
    a.row('a')!.focus();
    a.row('a')!.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
    a.app.commit((tasks) => setFlags(tasks, 'a', { urgent: true, important: true }, '2026-10-19T13:00:00.000Z'));
    a.app.commit((tasks) => setWho(tasks, 'a', '', '2026-10-19T13:00:00.000Z'));
    expect(ls.writes.length).toBe(writes);
    expect(a.app.getState().rev).toBe(3);
  });

  it('a real change still saves', () => {
    const ls = new SharedStore({ [MAIN_KEY]: serialize(stateWith([task('a', 'A', true, true)])) });
    const a = openTab(ls);
    a.app.commit((tasks) => setFlags(tasks, 'a', { urgent: false, important: true }, NOW));
    expect(a.app.getState().rev).toBe(4);
    expect(storedTasks(ls)[0]!.urgent).toBe(false);
  });
});

describe('banners (AC4, AC5)', () => {
  const GARBAGE = '{"version":1,"rev":2,"tasks":[{"id":"a"';
  const downloadButton = (tab: Tab) => tab.root.querySelector<HTMLButtonElement>('.banner__download');

  function captureDownload() {
    const got: { text?: Promise<string>; type?: string; name?: string } = {};
    URL.createObjectURL = vi.fn((b: Blob) => {
      got.text = b.text();
      got.type = b.type;
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      got.name = this.download;
    });
    return got;
  }

  it('corrupt data, backed up: persistent mode with a banner and a download of the raw value', async () => {
    const ls = new SharedStore({ [MAIN_KEY]: GARBAGE });
    const a = openTab(ls);
    expect(a.banners()).toEqual([WARNINGS.corruptBackedUp]);
    expect(downloadButton(a)!.textContent).toBe('Download the unreadable data');
    const got = captureDownload();
    downloadButton(a)!.click();
    expect(await got.text).toBe(GARBAGE);
    expect(got.type).toBe('application/json');
    expect(got.name).toMatch(/^eisenhower-unreadable-.*\.json$/);
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);

    // Saving works, and the offer to download stays for the session.
    add(a, 'Fresh start');
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['Fresh start']);
    expect(a.banners()).toEqual([WARNINGS.corruptBackedUp]);
    expect(downloadButton(a)).not.toBeNull();
  });

  it('the download offer survives a reload caused by another tab', () => {
    const ls = new SharedStore({ [MAIN_KEY]: GARBAGE });
    const a = openTab(ls);
    const b = openTab(ls);
    add(b, 'From B');
    a.notify();
    expect(a.titles('do')).toEqual(['From B']);
    expect(a.banners()).toEqual([EARLIER_UNREADABLE]); // no longer "started empty"
    expect(downloadButton(a)).not.toBeNull();
  });

  it('once another tab has made the data readable, stops saying "Not saving" but keeps the download', async () => {
    const ls = new SharedStore({ [MAIN_KEY]: GARBAGE });
    ls.failSet = (key) => key !== MAIN_KEY && quota();
    const a = openTab(ls);
    expect(a.banners()).toEqual([WARNINGS.corruptNotBackedUp]);
    ls.failSet = null;
    const b = openTab(ls); // backs the data up this time, and starts empty
    add(b, 'From B');
    a.notify();
    expect(a.banners()).toEqual([EARLIER_UNREADABLE]);
    add(a, 'From A');
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['From B', 'From A']);
    expect(a.banners()).toEqual([EARLIER_UNREADABLE]);
    const got = captureDownload();
    downloadButton(a)!.click();
    expect(await got.text).toBe(GARBAGE);
  });

  it('corrupt data that could not be backed up: memory mode, main key untouched, download offered', () => {
    const ls = new SharedStore({ [MAIN_KEY]: GARBAGE });
    ls.failSet = (key) => key !== MAIN_KEY && quota();
    const a = openTab(ls);
    add(a, 'Kept in memory');
    expect(a.titles('do')).toEqual(['Kept in memory']);
    expect(a.banners()).toEqual([WARNINGS.corruptNotBackedUp]);
    expect(downloadButton(a)).not.toBeNull();
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('blocked storage: memory mode, banner, no download button', () => {
    const a = openTab(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(a.banners()).toEqual([WARNINGS.blocked]);
    add(a, 'Still works');
    expect(a.titles('do')).toEqual(['Still works']);
    expect(a.banners()).toEqual([WARNINGS.blocked]);
    expect(downloadButton(a)).toBeNull();
  });

  it('data from a newer version: read-only, never writes, banner, no download button', () => {
    const ls = new SharedStore({ [MAIN_KEY]: JSON.stringify({ version: 2, rev: 1, tasks: [] }) });
    const a = openTab(ls);
    expect(a.banners()).toEqual([WARNINGS.newer]);
    add(a, 'Not saved');
    expect(ls.writes).toEqual([]);
    expect(a.banners()).toEqual([WARNINGS.newer]);
    expect(downloadButton(a)).toBeNull();
  });

  it('storage full: says full (not blocked), no download button, and clears once a save succeeds', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    ls.failSet = () => quota();
    add(a, 'One');
    expect(a.banners()).toEqual([WARNINGS.full]);
    expect(a.banners()[0]).toContain('browser storage is full');
    expect(downloadButton(a)).toBeNull();
    ls.failSet = null;
    add(a, 'Two');
    expect(a.banners()).toEqual([]);
    expect(storedTasks(ls).map((t) => t.title)).toEqual(['One', 'Two']);
  });
});

describe('backup reminder', () => {
  const status = (tab: Tab) => tab.root.querySelector<HTMLElement>('.header .backup-status')!;
  const daysAgo = (n: number) => new Date(2026, 9, 19 - n, 18, 0, 0).toISOString();
  const boot = (lastExportAt?: string) =>
    openTab(new SharedStore({ [MAIN_KEY]: serialize(stateWith([], lastExportAt ? { lastExportAt } : {})) }));

  it.each<[string, string | undefined, string, boolean]>([
    ['never', undefined, 'Never backed up', true],
    ['0 days', daysAgo(0), 'Last backup today', false],
    ['7 days', daysAgo(7), 'Last backup 7 days ago', false],
    ['8 days', daysAgo(8), 'Last backup 8 days ago', true],
  ])('%s', (_label, lastExportAt, text, warn) => {
    const a = boot(lastExportAt);
    expect(status(a).textContent).toBe(text);
    expect(status(a).classList.contains('backup-status--warn')).toBe(warn);
  });

  it('recomputes at local midnight', () => {
    vi.useFakeTimers();
    const a = boot(daysAgo(7));
    clock = new Date(2026, 9, 20, 0, 0, 0, 0);
    vi.advanceTimersByTime(15 * 3600 * 1000);
    expect(status(a).textContent).toBe('Last backup 8 days ago');
    expect(status(a).classList.contains('backup-status--warn')).toBe(true);
  });

  it('follows a lastExportAt written by another tab', () => {
    const ls = new SharedStore({ [MAIN_KEY]: serialize(stateWith([])) });
    const a = openTab(ls);
    expect(status(a).textContent).toBe('Never backed up');
    ls.data.set(MAIN_KEY, serialize(stateWith([], { rev: 4, lastExportAt: daysAgo(0) })));
    a.notify();
    expect(status(a).textContent).toBe('Last backup today');
  });

  it('a save keeps lastExportAt', () => {
    const ls = new SharedStore({ [MAIN_KEY]: serialize(stateWith([], { lastExportAt: daysAgo(2) })) });
    const a = openTab(ls);
    add(a, 'X');
    expect((JSON.parse(ls.data.get(MAIN_KEY)!) as StoredState).lastExportAt).toBe(daysAgo(2));
  });
});

describe('undo across a reload', () => {
  it('restores by id after another tab changed the data, keeping that tab’s work', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    add(a, 'Gone', true, true, 'x');
    const b = openTab(ls);
    a.app.deleteTask('x');
    b.notify();
    add(b, 'From B', true, true, 'y');
    a.notify();
    expect(a.app.undo()).toBe(true);
    expect(a.titles('do').sort()).toEqual(['From B', 'Gone']);
    expect(storedTasks(ls).map((t) => t.id).sort()).toEqual(['x', 'y']);
  });

  it('a removal refused as stale offers no undo: the task is back and the banner says why', () => {
    const ls = new SharedStore();
    const a = openTab(ls);
    add(a, 'Stays', true, true, 'x');
    const b = openTab(ls);
    add(a, 'Newer', true, true, 'y');
    expect(b.app.deleteTask('x')).toBe(false);
    expect(b.titles('do')).toEqual(['Stays', 'Newer']);
    expect(b.app.undo()).toBe(false);
    expect(toastText(b)).not.toContain('Deleted');
    expect(b.banners()).toEqual(["Changed in another tab. 1 change made here wasn't saved."]);
  });
});
