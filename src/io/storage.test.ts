import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse, serialize } from '../core/codec';
import { emptyState, type StoragePort } from '../core/ports';
import type { StoredState, Task } from '../core/task';
import { MAIN_KEY, WARNINGS, createBrowserStorage, type BrowserStorageOptions } from './storage';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const TS = '2026-10-19T12:00:00.000Z';
const BACKUP_KEY = `eisenhower:backup:${TS}`;
const MIGRATION_KEY = `eisenhower:backup:pre-v1:${TS}`;

const task: Task = {
  id: 'a',
  title: 'Pay rent',
  urgent: true,
  important: true,
  done: false,
  order: 0,
  createdAt: TS,
  updatedAt: TS,
};
const stateAt = (rev: number, tasks: Task[] = [task]): StoredState => ({ version: 1, rev, tasks });

/** A localStorage stand-in that records every write and can be told to fail. */
class StubStorage {
  data = new Map<string, string>();
  writes: string[] = [];
  failGet: ((key: string) => unknown) | null = null;
  failSet: ((key: string) => unknown) | null = null;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v);
  }
  get length(): number {
    return this.data.size;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    const e = this.failGet?.(key);
    if (e !== undefined && e !== null && e !== false) throw e;
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    const e = this.failSet?.(key);
    if (e !== undefined && e !== null && e !== false) throw e;
    this.writes.push(key);
    this.data.set(key, String(value));
  }
}

const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

function setup(initial: Record<string, string> = {}, extra: Partial<BrowserStorageOptions> = {}) {
  const ls = new StubStorage(initial);
  const events = new EventTarget();
  const persist = vi.fn(() => Promise.resolve(true));
  const port = createBrowserStorage({
    storage: () => ls,
    now: () => NOW,
    events,
    navigator: { storage: { persist } },
    ...extra,
  });
  return { ls, events, persist, port };
}

function mustSave(port: StoragePort, state: StoredState): number {
  const r = port.save(state);
  if (!r.ok) throw new Error(`save failed: ${r.reason}`);
  return r.rev;
}

const stored = (ls: StubStorage) => {
  const raw = ls.data.get(MAIN_KEY);
  if (raw === undefined) throw new Error('main key empty');
  const r = parse(raw);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

describe('normal operation', () => {
  it('starts empty and persistent on a fresh browser, writing nothing on load', () => {
    const { ls, port } = setup();
    expect(port.load()).toStrictEqual({ state: emptyState(), mode: 'persistent' });
    expect(ls.writes).toEqual([]);
  });

  it('loads what is stored', () => {
    const { port } = setup({ [MAIN_KEY]: serialize(stateAt(4)) });
    expect(port.load()).toStrictEqual({ state: stateAt(4), mode: 'persistent' });
  });

  it('saves with rev + 1 in the codec format, and chains saves on the returned rev', () => {
    const { ls, port } = setup();
    port.load();
    expect(port.save(stateAt(0))).toEqual({ ok: true, mode: 'persistent', rev: 1 });
    expect(stored(ls)).toStrictEqual(stateAt(1));
    expect(port.save(stateAt(1, []))).toMatchObject({ ok: true, rev: 2 });
    expect(stored(ls)).toStrictEqual(stateAt(2, []));
  });

  it('uses window.localStorage by default', () => {
    localStorage.clear();
    const port = createBrowserStorage({ navigator: {} });
    port.load();
    expect(port.save(stateAt(0))).toMatchObject({ ok: true, rev: 1 });
    expect(parse(localStorage.getItem(MAIN_KEY)!)).toMatchObject({ ok: true, value: { rev: 1 } });
    localStorage.clear();
  });
});

describe('navigator.storage.persist()', () => {
  it('is requested once, on creation', () => {
    const { port, persist } = setup();
    port.load();
    port.save(stateAt(0));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each<[string, BrowserStorageOptions['navigator']]>([
    ['no navigator', undefined],
    ['no navigator.storage', {}],
    ['no persist()', { storage: {} }],
    ['persist() throws', { storage: { persist: () => { throw new Error('nope'); } } }],
    ['persist() rejects', { storage: { persist: () => Promise.reject(new Error('nope')) } }],
  ])('is harmless with %s', async (_label, navigator) => {
    const { port } = setup({}, { navigator });
    expect(port.load().mode).toBe('persistent');
    await Promise.resolve();
  });
});

describe('localStorage throws on read or write', () => {
  it('reading throws → memory mode with the blocked banner, and never writes', () => {
    const { ls, port } = setup({ [MAIN_KEY]: serialize(stateAt(4)) });
    ls.failGet = () => new DOMException('denied', 'SecurityError');
    expect(port.load()).toStrictEqual({ state: emptyState(), mode: 'memory', warning: WARNINGS.blocked });
    ls.failGet = null;
    // Storage we could not read may hold data: saving would overwrite it.
    expect(port.save(stateAt(0))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    expect(ls.writes).toEqual([]);
  });

  it('even reaching localStorage throws (cookies blocked) → memory mode', () => {
    const port = createBrowserStorage({
      storage: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      navigator: {},
    });
    expect(port.load()).toStrictEqual({ state: emptyState(), mode: 'memory', warning: WARNINGS.blocked });
    expect(port.save(stateAt(0))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
  });

  it.each<[string, unknown, string]>([
    ['QuotaExceededError', quota(), WARNINGS.full],
    ['Firefox NS_ERROR_DOM_QUOTA_REACHED', new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'), WARNINGS.full],
    ['a legacy quota code 22', Object.assign(new Error('full'), { code: 22 }), WARNINGS.full],
    ['SecurityError', new DOMException('denied', 'SecurityError'), WARNINGS.blocked],
    ['a plain Error', new Error('weird'), WARNINGS.blocked],
    ['a TypeError', new TypeError('weird'), WARNINGS.blocked],
    ['a thrown string', 'weird', WARNINGS.blocked],
    ['a thrown null-prototype object', Object.create(null), WARNINGS.blocked],
    [
      'an error whose name cannot be read',
      Object.defineProperty(new Error('odd'), 'name', {
        get() {
          throw new Error('no name');
        },
      }),
      WARNINGS.blocked,
    ],
    [
      'a revoked proxy',
      (() => {
        const p = Proxy.revocable({}, {});
        p.revoke();
        return p.proxy;
      })(),
      WARNINGS.blocked,
    ],
  ])('any setItem throw is a failed save: %s', (_label, error, warning) => {
    const { ls, port } = setup({ [MAIN_KEY]: serialize(stateAt(4)) });
    port.load();
    ls.failSet = () => error;
    expect(port.save(stateAt(4))).toEqual({
      ok: false,
      mode: 'memory',
      reason: 'unavailable',
      error: warning,
    });
    expect(ls.data.get(MAIN_KEY)).toBe(serialize(stateAt(4)));
  });
});

describe('save fails mid-session (quota)', () => {
  it('switches to memory mode, and a later successful save restores persistent mode', () => {
    const { ls, port } = setup();
    port.load();
    const rev = mustSave(port, stateAt(0));
    ls.failSet = () => quota();
    expect(port.save(stateAt(rev))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    expect(port.save(stateAt(rev))).toMatchObject({ ok: false, mode: 'memory' });
    ls.failSet = null;
    // The caller keeps the last rev that saved; the retry is not a conflict.
    expect(port.save(stateAt(rev, []))).toEqual({ ok: true, mode: 'persistent', rev: rev + 1 });
    expect(stored(ls)).toStrictEqual(stateAt(rev + 1, []));
  });

  it('a read failure at save time is a failed save, not a lock', () => {
    const { ls, port } = setup();
    port.load();
    ls.failGet = () => new Error('flaky');
    expect(port.save(stateAt(0))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    ls.failGet = null;
    expect(port.save(stateAt(0))).toMatchObject({ ok: true, mode: 'persistent', rev: 1 });
  });
});

describe('stored value fails parse (AC4)', () => {
  const GARBAGE = '{"version":1,"rev":2,"tasks":[{"id":"a"'; // truncated write

  it('backs the raw value up before anything else, starts empty, and hands the raw value back', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    expect(port.load()).toStrictEqual({
      state: emptyState(),
      mode: 'persistent',
      warning: WARNINGS.corruptBackedUp,
      raw: GARBAGE,
    });
    expect(ls.writes).toEqual([BACKUP_KEY]);
    expect(ls.data.get(BACKUP_KEY)).toBe(GARBAGE);
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('overwrites the main key only once the backup is in place', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    expect(port.save(stateAt(0))).toEqual({ ok: true, mode: 'persistent', rev: 1 });
    expect(ls.writes).toEqual([BACKUP_KEY, MAIN_KEY]);
    expect(ls.data.get(BACKUP_KEY)).toBe(GARBAGE);
    expect(stored(ls)).toStrictEqual(stateAt(1));
  });

  it('a save not based on the empty board that load() returned is a conflict, not an overwrite', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    expect(port.save(stateAt(2))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('if the backup vanished before the first save, writes it again first', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    ls.data.delete(BACKUP_KEY);
    expect(port.save(stateAt(0))).toMatchObject({ ok: true });
    expect(ls.writes).toEqual([BACKUP_KEY, BACKUP_KEY, MAIN_KEY]);
    expect(ls.data.get(BACKUP_KEY)).toBe(GARBAGE);
  });

  it('if the backup vanished and cannot be rewritten, refuses to save and leaves the main key alone', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    ls.data.delete(BACKUP_KEY);
    ls.failSet = () => quota();
    expect(port.save(stateAt(0))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    ls.failSet = null;
    expect(port.save(stateAt(0))).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('backup write throws → memory mode, raw offered, main key byte-identical forever', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    ls.failSet = (key) => key !== MAIN_KEY && quota();
    expect(port.load()).toStrictEqual({
      state: emptyState(),
      mode: 'memory',
      warning: WARNINGS.corruptNotBackedUp,
      raw: GARBAGE,
    });
    const r = port.save(stateAt(0));
    expect(r).toEqual({ ok: false, mode: 'memory', reason: 'unavailable', error: WARNINGS.corruptNotBackedUp });
    expect(ls.writes).toEqual([]);
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('a backup that reads back wrong counts as a failed backup', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    const real = ls.setItem.bind(ls);
    ls.setItem = (key, value) => real(key, key === MAIN_KEY ? value : value.slice(0, 5));
    expect(port.load()).toMatchObject({ mode: 'memory', warning: WARNINGS.corruptNotBackedUp });
    expect(ls.data.get(MAIN_KEY)).toBe(GARBAGE);
  });

  it('never overwrites an earlier backup that has the same timestamp', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE, [BACKUP_KEY]: 'older backup' });
    port.load();
    expect(ls.data.get(BACKUP_KEY)).toBe('older backup');
    expect(ls.data.get(`${BACKUP_KEY}-1`)).toBe(GARBAGE);
  });

  it('loading the same garbage again does not write a second backup', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    port.load();
    expect(ls.writes).toEqual([BACKUP_KEY]);
  });

  it('a reload (or a second tab) finds the existing backup instead of copying the data again', () => {
    const { ls, port } = setup({ [MAIN_KEY]: GARBAGE });
    port.load();
    const later = () => NOW + 60_000;
    const reloaded = createBrowserStorage({ storage: () => ls, now: later, navigator: {} });
    expect(reloaded.load()).toMatchObject({ mode: 'persistent', warning: WARNINGS.corruptBackedUp });
    expect(reloaded.save(stateAt(0))).toMatchObject({ ok: true });
    expect(ls.writes).toEqual([BACKUP_KEY, MAIN_KEY]);
  });

  it('repeated reloads of untouched bad data never fill the quota with copies of it', () => {
    const big = GARBAGE + 'x'.repeat(1000);
    const { ls } = setup({ [MAIN_KEY]: big });
    // Room for the main key and one copy of it, not two.
    ls.failSet = () => [...ls.data.values()].join('').length + big.length > 2500 && quota();
    for (let i = 0; i < 5; i++) {
      const port = createBrowserStorage({ storage: () => ls, now: () => NOW + i * 60_000, navigator: {} });
      expect(port.load()).toMatchObject({ mode: 'persistent', warning: WARNINGS.corruptBackedUp });
    }
  });

  it.each(['not json', 'null', '{"version":"1","rev":0,"tasks":[]}', '{"rev":0,"tasks":[]}'])(
    'treats %s as corrupt',
    (raw) => {
      const { ls, port } = setup({ [MAIN_KEY]: raw });
      expect(port.load()).toMatchObject({ mode: 'persistent', warning: WARNINGS.corruptBackedUp, raw });
      expect(ls.data.get(BACKUP_KEY)).toBe(raw);
    },
  );
});

describe('stored version is newer than the build (AC4)', () => {
  const FUTURE = JSON.stringify({ version: 2, rev: 9, items: [] });

  it('is read-only: never writes, not even a backup', () => {
    const { ls, port } = setup({ [MAIN_KEY]: FUTURE });
    expect(port.load()).toStrictEqual({ state: emptyState(), mode: 'readonly', warning: WARNINGS.newer });
    expect(port.save(stateAt(0))).toEqual({ ok: false, mode: 'readonly', reason: 'readonly', error: WARNINGS.newer });
    expect(port.save(stateAt(9))).toMatchObject({ ok: false, reason: 'readonly' });
    expect(ls.writes).toEqual([]);
    expect(ls.data.get(MAIN_KEY)).toBe(FUTURE);
  });

  it('a later load() that finds readable data lifts the read-only lock', () => {
    const { ls, port } = setup({ [MAIN_KEY]: FUTURE });
    port.load();
    ls.data.set(MAIN_KEY, serialize(stateAt(9)));
    expect(port.load()).toStrictEqual({ state: stateAt(9), mode: 'persistent' });
    expect(port.save(stateAt(9))).toMatchObject({ ok: true, rev: 10 });
  });

  it('a newer version saved by another tab mid-session turns this tab read-only', () => {
    const { ls, port } = setup();
    port.load();
    const rev = mustSave(port, stateAt(0));
    ls.data.set(MAIN_KEY, FUTURE);
    expect(port.save(stateAt(rev))).toMatchObject({ ok: false, mode: 'readonly', reason: 'readonly' });
    ls.data.set(MAIN_KEY, serialize(stateAt(rev)));
    expect(port.save(stateAt(rev))).toMatchObject({ ok: false, reason: 'readonly' });
    expect(ls.writes).toEqual([MAIN_KEY]);
  });
});

describe('migration needed', () => {
  const V0 = JSON.stringify({
    version: 0,
    tasks: [{ id: 'a', title: 'Pay rent', urgent: true, important: true, done: false, createdAt: TS, updatedAt: TS }],
  });

  it('backs up the original to pre-v1 on load, then saves in the new format', () => {
    const { ls, port } = setup({ [MAIN_KEY]: V0 });
    expect(port.load()).toStrictEqual({ state: stateAt(0), mode: 'persistent' });
    expect(ls.writes).toEqual([MIGRATION_KEY]);
    expect(ls.data.get(MIGRATION_KEY)).toBe(V0);
    expect(ls.data.get(MAIN_KEY)).toBe(V0);
    expect(port.save(stateAt(0))).toEqual({ ok: true, mode: 'persistent', rev: 1 });
    expect(ls.writes).toEqual([MIGRATION_KEY, MAIN_KEY]);
    expect(stored(ls)).toStrictEqual(stateAt(1));
  });

  it('backup write fails → memory mode with the migrated tasks, and the original is never overwritten', () => {
    const { ls, port } = setup({ [MAIN_KEY]: V0 });
    ls.failSet = (key) => key !== MAIN_KEY && quota();
    expect(port.load()).toStrictEqual({ state: stateAt(0), mode: 'memory', warning: WARNINGS.migrationNotBackedUp });
    expect(port.save(stateAt(0))).toEqual({
      ok: false,
      mode: 'memory',
      reason: 'unavailable',
      error: WARNINGS.migrationNotBackedUp,
    });
    expect(ls.writes).toEqual([]);
    expect(ls.data.get(MAIN_KEY)).toBe(V0);
  });
});

describe('another tab changed the data (AC12)', () => {
  let ls: StubStorage;
  let port: StoragePort;
  beforeEach(() => {
    ({ ls, port } = setup({ [MAIN_KEY]: serialize(stateAt(3)) }));
    port.load();
  });

  it('stale rev at save → conflict with the banner text, and nothing written', () => {
    ls.data.set(MAIN_KEY, serialize(stateAt(5)));
    expect(port.save(stateAt(3, []))).toEqual({
      ok: false,
      mode: 'persistent',
      reason: 'conflict',
      error: WARNINGS.conflict,
    });
    expect(ls.writes).toEqual([]);
    expect(stored(ls)).toStrictEqual(stateAt(5));
  });

  it('after a conflict, load() then save() succeeds on the new rev', () => {
    ls.data.set(MAIN_KEY, serialize(stateAt(5)));
    port.save(stateAt(3));
    expect(port.load().state.rev).toBe(5);
    expect(port.save(stateAt(5))).toMatchObject({ ok: true, rev: 6 });
  });

  it('garbage written by someone else since load → conflict, not an overwrite', () => {
    ls.data.set(MAIN_KEY, 'garbage');
    expect(port.save(stateAt(3))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(ls.data.get(MAIN_KEY)).toBe('garbage');
  });

  it('an absent main key is not a conflict: there is nothing to overwrite', () => {
    ls.data.delete(MAIN_KEY);
    expect(port.save(stateAt(3))).toMatchObject({ ok: true, rev: 4 });
    expect(stored(ls)).toStrictEqual(stateAt(4));
  });

  it('subscribe fires on storage events for the main key (or a clear), until unsubscribed', () => {
    const { events, port: p } = setup();
    const cb = vi.fn();
    const off = p.subscribe(cb);
    events.dispatchEvent(new StorageEvent('storage', { key: MAIN_KEY }));
    events.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));
    events.dispatchEvent(new StorageEvent('storage', { key: BACKUP_KEY }));
    events.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    events.dispatchEvent(new StorageEvent('storage', { key: MAIN_KEY }));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('two tabs on one localStorage (AC12 backstop)', () => {
  const other: Task = { ...task, id: 'b', title: 'Call Sam' };
  const tab = (ls: StubStorage) => createBrowserStorage({ storage: () => ls, now: () => NOW, navigator: {} });

  it('whichever tab saves second on the same base gets a conflict, in either order', () => {
    const ls = new StubStorage({ [MAIN_KEY]: serialize(stateAt(3)) });
    const [a, b] = [tab(ls), tab(ls)];
    a.load();
    b.load();
    expect(b.save(stateAt(3, [other]))).toMatchObject({ ok: true, rev: 4 });
    expect(a.save(stateAt(3, []))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(stored(ls)).toStrictEqual(stateAt(4, [other]));
  });

  it('a rev reused after the main key vanished is still a conflict, not a silent overwrite', () => {
    const ls = new StubStorage({ [MAIN_KEY]: serialize(stateAt(1)) });
    const a = tab(ls);
    a.load();
    // Site data cleared or evicted while tab A sat in the back/forward cache and missed the event.
    ls.data.delete(MAIN_KEY);
    const b = tab(ls);
    expect(b.load().state.rev).toBe(0);
    expect(b.save(stateAt(0, [other]))).toMatchObject({ ok: true, rev: 1 });
    // Tab A's rev is 1 too, but the rev 1 stored now is tab B's work.
    expect(a.save(stateAt(1, []))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(stored(ls)).toStrictEqual(stateAt(1, [other]));
  });

  it('a rev reused after another tab reset unreadable data is still a conflict', () => {
    const ls = new StubStorage({ [MAIN_KEY]: serialize(stateAt(1)) });
    const a = tab(ls);
    a.load();
    ls.data.set(MAIN_KEY, 'garbage');
    const b = tab(ls);
    expect(b.load()).toMatchObject({ state: emptyState(), warning: WARNINGS.corruptBackedUp });
    expect(b.save(stateAt(0, [other]))).toMatchObject({ ok: true, rev: 1 });
    expect(a.save(stateAt(1, []))).toMatchObject({ ok: false, reason: 'conflict' });
    expect(stored(ls)).toStrictEqual(stateAt(1, [other]));
  });
});

describe('warnings', () => {
  it('match the plan wording where the plan gives it', () => {
    expect(WARNINGS.blocked).toBe('Not saving: your browser is blocking storage. Export before closing.');
    expect(WARNINGS.newer).toBe('Saved by a newer version. Reload the page.');
    expect(WARNINGS.conflict).toBe("Changed in another tab. Your last change wasn't saved.");
  });
});
