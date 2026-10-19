/**
 * T11: export and import (AC6), through the app controller and the footer's markup, over the
 * real localStorage adapter on a stubbed store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, serialize } from '../core/codec';
import type { StoredState, Task } from '../core/task';
import { BACKUP_PREFIX, MAIN_KEY, WARNINGS, createBrowserStorage, type KeyValueStore } from '../io/storage';
import { createApp, type App } from './app';

const NOW = '2026-10-19T12:00:00.000Z';

function task(id: string, title: string, urgent: boolean, important: boolean, over: Partial<Task> = {}): Task {
  return { id, title, urgent, important, done: false, order: 0, createdAt: NOW, updatedAt: NOW, ...over };
}
const MINE = [task('m1', 'Pay rent', true, true), task('m2', 'Plan trip', false, true, { when: '2026-11-02' })];
const THEIRS = [
  task('t1', 'Call Sam', true, false, { who: 'Sam' }),
  task('t2', 'Old magazines', false, false, { done: true }),
  task('t3', 'Taxes', true, true, { order: 0 }),
];
const mine = (over: Partial<StoredState> = {}): StoredState => ({ version: 1, rev: 3, tasks: MINE, ...over });

/** A localStorage stand-in. Every write goes into the shared `log`, so ordering can be asserted. */
class Store implements KeyValueStore {
  data = new Map<string, string>();
  failSet: ((key: string) => unknown) | null = null;
  constructor(
    public log: string[],
    initial: Record<string, string> = {},
  ) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v);
  }
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const e = this.failSet?.(key);
    if (e) throw e;
    this.log.push(`write ${key}`);
    this.data.set(key, value);
  }
}

type Tab = {
  root: HTMLElement;
  app: App;
  ls: Store;
  log: string[];
  downloads: { text: string; filename: string }[];
  $<T extends Element = HTMLElement>(selector: string): T | null;
  toast(): string | null;
};

let tabs: Tab[] = [];
let clock: Date;

function openTab(initial: Record<string, string> = {}, ls?: Store): Tab {
  const log = ls?.log ?? [];
  const store = ls ?? new Store(log, initial);
  const root = document.createElement('div');
  document.body.append(root);
  const downloads: Tab['downloads'] = [];
  const storage = createBrowserStorage({
    storage: () => store,
    now: () => clock.getTime(),
    events: new EventTarget(),
    navigator: {},
  });
  let n = 0;
  const app = createApp({
    root,
    storage,
    now: () => clock.toISOString(),
    newId: () => `id-${++n}`,
    download: (text, filename) => {
      log.push(`download ${filename}`);
      downloads.push({ text, filename });
    },
  });
  const tab: Tab = {
    root,
    app,
    ls: store,
    log,
    downloads,
    $: (s) => root.querySelector(s),
    toast: () => root.querySelector('.toast-slot')!.textContent,
  };
  tabs.push(tab);
  return tab;
}

const seeded = (state: StoredState = mine()) => openTab({ [MAIN_KEY]: serialize(state) });
const fileOf = (text: string, name = 'eisenhower-2026-10-19.json') => new File([text], name, { type: 'application/json' });
const theirFile = () => fileOf(serialize({ version: 1, rev: 9, tasks: THEIRS }), 'theirs.json');

function keydown(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
const panel = (tab: Tab) => tab.$('.import-confirm');
const replaceButton = (tab: Tab) => tab.$<HTMLButtonElement>('.import-confirm__replace')!;
const cancelButton = (tab: Tab) => tab.$<HTMLButtonElement>('.import-confirm__cancel')!;
const errorText = (tab: Tab) => tab.$('.import-confirm__error')?.textContent ?? '';
const backupKeys = (ls: Store) => [...ls.data.keys()].filter((k) => k.startsWith(BACKUP_PREFIX));

beforeEach(() => {
  clock = new Date(2026, 9, 19, 9, 0, 0); // local time, so the date is the 19th in every zone
  document.body.innerHTML = '';
  tabs = [];
});
afterEach(() => {
  for (const t of tabs) t.app.destroy();
  tabs = [];
  vi.restoreAllMocks();
});

describe('footer markup', () => {
  it('appends .transfer after .clear-done without replacing the footer', () => {
    const tab = seeded();
    const footer = tab.$('.footer')!;
    const children = [...footer.children];
    expect(children[0]!.className).toBe('clear-done');
    const transfer = children[children.indexOf(tab.$('.clear-done')!) + 1]!;
    expect(transfer.className).toBe('transfer');
    const exp = transfer.querySelector<HTMLButtonElement>('button.transfer__export')!;
    const imp = transfer.querySelector<HTMLButtonElement>('button.transfer__import')!;
    expect(exp.textContent).toBe('Export');
    expect(exp.type).toBe('button');
    expect(imp.textContent).toBe('Import');
    const input = transfer.querySelector<HTMLInputElement>('input.transfer__file')!;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/json,.json');
    expect(input.tabIndex).toBe(-1);
    expect(panel(tab)).toBeNull();
  });

  it('the Import button opens the file picker', () => {
    const tab = seeded();
    const click = vi.spyOn(tab.$<HTMLInputElement>('.transfer__file')!, 'click').mockImplementation(() => {});
    tab.$<HTMLButtonElement>('.transfer__import')!.click();
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe('export', () => {
  it('downloads the serialized board as eisenhower-<local date>.json, then records lastExportAt', () => {
    const tab = seeded();
    expect(tab.$('.backup-status')!.textContent).toBe('Never backed up');
    tab.$<HTMLButtonElement>('.transfer__export')!.click();

    expect(tab.downloads).toEqual([{ text: serialize(mine()), filename: 'eisenhower-2026-10-19.json' }]);
    expect(tab.log).toEqual(['download eisenhower-2026-10-19.json', `write ${MAIN_KEY}`]);
    expect(tab.app.getState().lastExportAt).toBe(clock.toISOString());
    const stored = parse(tab.ls.data.get(MAIN_KEY)!);
    expect(stored.ok && stored.value.lastExportAt).toBe(clock.toISOString());
    expect(stored.ok && stored.value.tasks).toStrictEqual(MINE);
    expect(tab.$('.backup-status')!.textContent).toBe('Last backup today');
    expect(tab.toast()).toContain('Exported 2 tasks');
  });

  it('names the file by the local date, late in the evening too', () => {
    clock = new Date(2026, 9, 19, 23, 30, 0);
    const tab = seeded();
    tab.app.exportTasks();
    expect(tab.downloads[0]!.filename).toBe('eisenhower-2026-10-19.json');
  });

  it('when recording the export fails, the download still happened and the toast says the time was not saved', () => {
    const tab = seeded();
    tab.ls.failSet = (key) => key === MAIN_KEY && new DOMException('full', 'QuotaExceededError');
    tab.app.exportTasks();
    expect(tab.downloads).toHaveLength(1);
    expect(tab.toast()).not.toContain('Exported');
    expect(tab.toast()).toContain("Downloaded 2 tasks, but the backup time couldn't be saved");
    const stored = parse(tab.ls.data.get(MAIN_KEY)!);
    expect(stored.ok && stored.value.lastExportAt).toBeUndefined();
  });
});

describe('import (AC6)', () => {
  it('round trip: export from one board, import into another, and the tasks are identical', async () => {
    const all = [...MINE, task('x1', 'Call Sam', true, false, { who: 'Sam', done: true }), task('x2', 'Taxes', true, true, { order: 1 })];
    const source = seeded(mine({ tasks: all }));
    source.app.exportTasks();
    const exported = source.downloads[0]!;
    source.app.destroy();
    tabs = [];

    const target = openTab();
    await target.app.importFile(fileOf(exported.text, exported.filename));
    replaceButton(target).click();

    expect(target.app.getState().tasks).toStrictEqual(all);
    const stored = parse(target.ls.data.get(MAIN_KEY)!);
    expect(stored.ok && stored.value.tasks).toStrictEqual(all);
    const titles = [...target.root.querySelectorAll('.task__title')].map((e) => e.textContent).sort();
    expect(titles).toEqual(all.map((t) => t.title).sort());
  });

  it('shows the counts and the file name before replacing anything', async () => {
    const tab = seeded();
    await tab.app.importFile(theirFile());
    const p = panel(tab)!;
    expect(p.getAttribute('role')).toBe('dialog');
    expect(p.getAttribute('aria-modal')).toBe('true');
    const text = tab.$('.import-confirm__text')!;
    expect(p.getAttribute('aria-labelledby')).toBe(text.id);
    expect(text.textContent).toBe(
      'Replace your 2 tasks with 3 tasks from theirs.json? Your current tasks are backed up first.',
    );
    expect(replaceButton(tab).textContent).toBe('Replace');
    expect(cancelButton(tab).textContent).toBe('Cancel');
    expect(tab.log).toEqual([]);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('on Replace: backs up the current board first, then downloads it, then replaces', async () => {
    const tab = seeded();
    const before = tab.ls.data.get(MAIN_KEY);
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();

    const backupKey = `${BACKUP_PREFIX}pre-import:${clock.toISOString()}`;
    expect(tab.log).toEqual([`write ${backupKey}`, 'download eisenhower-2026-10-19.json', `write ${MAIN_KEY}`]);
    expect(tab.ls.data.get(backupKey)).toBe(serialize(mine()));
    expect(tab.ls.data.get(backupKey)).toBe(before);
    expect(tab.downloads[0]!.text).toBe(serialize(mine()));

    expect(tab.app.getState().tasks).toStrictEqual(THEIRS);
    expect(panel(tab)).toBeNull();
    expect(tab.toast()).toContain('Imported 3 tasks');
  });

  it('a failed backup write aborts: nothing replaced, nothing downloaded, the error shown', async () => {
    const tab = seeded();
    const before = tab.ls.data.get(MAIN_KEY);
    tab.ls.failSet = (key) => key.startsWith(BACKUP_PREFIX) && new DOMException('full', 'QuotaExceededError');
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();

    expect(errorText(tab)).toBe("Nothing was imported: your current tasks couldn't be backed up first.");
    expect(panel(tab)).not.toBeNull();
    expect(tab.log).toEqual([]);
    expect(tab.ls.data.get(MAIN_KEY)).toBe(before);
    expect(backupKeys(tab.ls)).toEqual([]);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('a backup write that throws something odd also aborts', async () => {
    const tab = seeded();
    tab.ls.failSet = (key) => key.startsWith(BACKUP_PREFIX) && 'boom';
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
    expect(errorText(tab)).toContain("couldn't be backed up");
  });

  it('Cancel changes nothing', async () => {
    const tab = seeded();
    const before = new Map(tab.ls.data);
    await tab.app.importFile(theirFile());
    cancelButton(tab).click();
    expect(panel(tab)).toBeNull();
    expect(tab.ls.data).toEqual(before);
    expect(tab.log).toEqual([]);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('Escape changes nothing', async () => {
    const tab = seeded();
    const before = new Map(tab.ls.data);
    await tab.app.importFile(theirFile());
    keydown(document.activeElement!, 'Escape');
    expect(panel(tab)).toBeNull();
    expect(tab.ls.data).toEqual(before);
    expect(tab.log).toEqual([]);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it.each([
    ['not JSON', 'garbage{', 'The file is not valid JSON.'],
    ['a task that fails validation', JSON.stringify({ version: 1, rev: 0, tasks: [{ id: 'a' }] }), 'Task 1:'],
    ['no version', JSON.stringify({ tasks: [] }), 'The file has no version.'],
  ])('rejects %s and leaves everything untouched', async (_name, text, message) => {
    const tab = seeded();
    const before = new Map(tab.ls.data);
    await tab.app.importFile(fileOf(text, 'bad.json'));
    expect(tab.$('.import-confirm__text')!.textContent).toBe("Can't import bad.json.");
    expect(errorText(tab)).toContain(message);
    expect(replaceButton(tab).hidden).toBe(true);
    cancelButton(tab).click();
    expect(tab.ls.data).toEqual(before);
    expect(tab.log).toEqual([]);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('rejects a file from a newer version', async () => {
    const tab = seeded();
    const before = new Map(tab.ls.data);
    await tab.app.importFile(fileOf(JSON.stringify({ version: 2, rev: 0, tasks: [] }), 'future.json'));
    expect(errorText(tab)).toBe('This file was saved by a newer version of the app (format 2), so it can\'t be imported here.');
    expect(replaceButton(tab).hidden).toBe(true);
    keydown(document.activeElement!, 'Escape');
    expect(tab.ls.data).toEqual(before);
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('a file that cannot be read is rejected', async () => {
    const tab = seeded();
    const file = theirFile();
    vi.spyOn(file, 'text').mockRejectedValue(new Error('NotReadableError'));
    await tab.app.importFile(file);
    expect(errorText(tab)).toBe("The file couldn't be read.");
    expect(tab.app.getState().tasks).toStrictEqual(MINE);
  });

  it('accepts an older-format file, migrated on the way in', async () => {
    const tab = seeded();
    const v0 = JSON.stringify({
      version: 0,
      tasks: [{ id: 'a', title: 'Legacy', urgent: true, important: true, done: false, createdAt: NOW, updatedAt: NOW }],
    });
    await tab.app.importFile(fileOf(v0, 'old.json'));
    replaceButton(tab).click();
    expect(tab.app.getState().tasks).toStrictEqual([task('a', 'Legacy', true, true)]);
  });

  it('works through the file input: choosing a file opens the confirmation', async () => {
    const tab = seeded();
    const input = tab.$<HTMLInputElement>('.transfer__file')!;
    Object.defineProperty(input, 'files', { value: [theirFile()], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(panel(tab)).not.toBeNull());
    expect(input.value).toBe('');
    replaceButton(tab).click();
    expect(tab.app.getState().tasks).toStrictEqual(THEIRS);
  });

  it('records the import time as the last backup: the board now matches a file the user holds', async () => {
    const tab = seeded();
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();
    expect(tab.app.getState().lastExportAt).toBe(clock.toISOString());
    expect(tab.$('.backup-status')!.textContent).toBe('Last backup today');
  });

  it('a successful import clears the undo window', async () => {
    const tab = seeded();
    tab.app.deleteTask('m1');
    expect(tab.$('.toast__undo')).not.toBeNull();
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();
    expect(tab.$('.toast__undo')).toBeNull();
    expect(tab.app.undo()).toBe(false);
    expect(tab.app.getState().tasks).toStrictEqual(THEIRS);
  });

  it('another tab saved since: nothing is replaced, the board reloads, and the panel says so', async () => {
    const tab = seeded();
    await tab.app.importFile(theirFile());
    // Another tab saves a change before Replace is pressed (its storage event not yet delivered).
    const theirs = mine({ rev: 4, tasks: [MINE[0]!] });
    tab.ls.data.set(MAIN_KEY, serialize(theirs));
    replaceButton(tab).click();

    expect(tab.ls.data.get(MAIN_KEY)).toBe(serialize(theirs));
    expect(tab.app.getState().tasks).toStrictEqual([MINE[0]]);
    expect(errorText(tab)).toBe('Changed in another tab, so nothing was imported. Check the board, then try again.');
    expect(tab.$('.import-confirm__text')!.textContent).toContain('Replace your 1 task with 3 tasks');
    expect(tab.toast()).not.toContain('Imported');
  });

  it('with storage full, the board is replaced in memory and the toast says it is not saved', async () => {
    const tab = seeded();
    tab.ls.failSet = (key) => key === MAIN_KEY && new DOMException('full', 'QuotaExceededError');
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();
    expect(tab.app.getState().tasks).toStrictEqual(THEIRS);
    expect(tab.toast()).toContain("Imported 3 tasks, but they aren't saved");
    expect([...tab.root.querySelectorAll('.banner')].map((b) => b.textContent)).toEqual([WARNINGS.full]);
  });
});

describe('the confirmation panel is modal', () => {
  it('moves focus in, keeps Tab inside, and returns focus to the Import button', async () => {
    const tab = seeded();
    await tab.app.importFile(theirFile());
    expect(document.activeElement).toBe(cancelButton(tab));

    expect(keydown(cancelButton(tab), 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(replaceButton(tab));
    keydown(replaceButton(tab), 'Tab');
    expect(document.activeElement).toBe(cancelButton(tab));
    keydown(cancelButton(tab), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(replaceButton(tab));

    // Everything outside the panel is inert while it is open.
    for (const sel of ['.header', '.main', '.clear-done', '.transfer__export', '.transfer__import']) {
      expect(tab.$(sel)!.hasAttribute('inert')).toBe(true);
    }
    expect(tab.$('.transfer')!.hasAttribute('inert')).toBe(false);

    cancelButton(tab).click();
    expect(document.activeElement).toBe(tab.$('.transfer__import'));
    expect(tab.root.querySelectorAll('[inert]')).toHaveLength(0);
  });

  it('with only Cancel showing (a rejected file), Tab stays on it', async () => {
    const tab = seeded();
    await tab.app.importFile(fileOf('nope', 'bad.json'));
    expect(document.activeElement).toBe(cancelButton(tab));
    keydown(cancelButton(tab), 'Tab');
    expect(document.activeElement).toBe(cancelButton(tab));
  });

  it('returns focus to the Import button after a successful Replace', async () => {
    const tab = seeded();
    await tab.app.importFile(theirFile());
    replaceButton(tab).click();
    expect(document.activeElement).toBe(tab.$('.transfer__import'));
  });

  it('global shortcuts do nothing while it is open', async () => {
    const tab = seeded();
    tab.app.deleteTask('m2'); // an undo is on offer
    await tab.app.importFile(theirFile());
    const target = document.activeElement!;
    for (const key of ['/', '1', '4', 'r', ' ', 'Enter', 'Delete', 'ArrowDown']) keydown(target, key);
    keydown(target, 'z', { ctrlKey: true });
    // Fired at a task row too, in case focus were somehow left there.
    keydown(tab.$('.task')!, '4');
    keydown(tab.$('.task')!, 'Delete');

    expect(document.activeElement).not.toBe(tab.$('.capture__input'));
    expect(tab.$('.prompt')!.dataset.active).toBe('false');
    expect(tab.app.getState().tasks).toStrictEqual([MINE[0]]);
    expect(panel(tab)).not.toBeNull();
    cancelButton(tab).click();
    expect(tab.app.undo()).toBe(true); // Ctrl+Z was not spent while the panel was open
  });
});
