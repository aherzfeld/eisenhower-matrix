import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parse, serialize } from '../core/codec';
import { emptyState, type BackupResult, type StoragePort } from '../core/ports';
import type { StoredState, Task } from '../core/task';
import {
  MAIN_KEY,
  PRE_IMPORT_KEEP,
  WARNINGS,
  createBrowserStorage,
  preImportBackupsToPrune,
  type BrowserStorageOptions,
} from './storage';

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
  failRemove: ((key: string) => unknown) | null = null;
  removes: string[] = [];
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
  removeItem(key: string): void {
    const e = this.failRemove?.(key);
    if (e !== undefined && e !== null && e !== false) throw e;
    this.removes.push(key);
    this.data.delete(key);
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

describe('writeBackup (pre-import backup, T11)', () => {
  const PRE_IMPORT_KEY = `eisenhower:backup:pre-import:${TS}`;

  it('writes the text to a labelled, timestamped backup key and leaves the main key alone', () => {
    const { ls, port } = setup({ [MAIN_KEY]: serialize(stateAt(1)) });
    port.load();
    expect(port.writeBackup('pre-import', 'current')).toBe('ok');
    expect(ls.writes).toEqual([PRE_IMPORT_KEY]);
    expect(ls.data.get(PRE_IMPORT_KEY)).toBe('current');
    expect(ls.data.get(MAIN_KEY)).toBe(serialize(stateAt(1)));
  });

  it('writes a fresh key every time, never overwriting an earlier backup', () => {
    const { ls, port } = setup({ [PRE_IMPORT_KEY]: 'older' });
    port.load();
    expect(port.writeBackup('pre-import', 'current')).toBe('ok');
    expect(ls.data.get(PRE_IMPORT_KEY)).toBe('older');
    expect(ls.data.get(`${PRE_IMPORT_KEY}-1`)).toBe('current');
    expect(port.writeBackup('pre-import', 'current')).toBe('ok');
    expect(ls.data.get(`${PRE_IMPORT_KEY}-2`)).toBe('current');
  });

  it('never reuses a freed key: a new backup always sorts after every existing one with its timestamp', () => {
    const { ls, port } = setup({ [`${PRE_IMPORT_KEY}-2`]: 'older', [`${PRE_IMPORT_KEY}-10`]: 'old' });
    port.load();
    expect(port.writeBackup('manual', 'x')).toBe('ok');
    expect(port.writeBackup('pre-import', 'current')).toBe('ok');
    expect(ls.writes).toEqual([`eisenhower:backup:manual:${TS}`, `${PRE_IMPORT_KEY}-11`]);
    expect(ls.data.get(PRE_IMPORT_KEY)).toBeUndefined();
  });

  it.each<[string, () => unknown, BackupResult]>([
    ['a quota error', quota, 'full'],
    ['a SecurityError', () => new DOMException('denied', 'SecurityError'), 'failed'],
    ['an odd thrown value', () => 'boom', 'failed'],
  ])('any setItem throw counts as failure: %s', (_name, error, result) => {
    const { ls, port } = setup();
    port.load();
    ls.failSet = () => error();
    expect(port.writeBackup('pre-import', 'current')).toBe(result);
    expect(ls.data.size).toBe(0);
  });

  it('fails when reading storage throws', () => {
    const { ls, port } = setup();
    port.load();
    ls.failGet = () => new DOMException('denied', 'SecurityError');
    expect(port.writeBackup('pre-import', 'current')).toBe('failed');
  });

  it('fails when the write does not read back', () => {
    const { ls, port } = setup();
    port.load();
    const setItem = ls.setItem.bind(ls);
    ls.setItem = (key, value) => setItem(key, value.slice(1));
    expect(port.writeBackup('pre-import', 'current')).toBe('failed');
  });

  it('writes nothing in read-only mode (data from a newer version)', () => {
    const newer = JSON.stringify({ version: 2, rev: 0, tasks: [] });
    const { ls, port } = setup({ [MAIN_KEY]: newer });
    expect(port.load().mode).toBe('readonly');
    expect(port.writeBackup('pre-import', 'current')).toBe('failed');
    expect(ls.writes).toEqual([]);
  });
});

describe('preImportBackupsToPrune (#11)', () => {
  const PRE = 'eisenhower:backup:pre-import:';
  const at = (minute: number, suffix = '') => `${PRE}2026-10-19T12:${String(minute).padStart(2, '0')}:00.000Z${suffix}`;

  it('keeps the newest, counting the one just written, and returns the rest', () => {
    const keys = [at(1), at(2), at(3), at(4), at(5)];
    expect(preImportBackupsToPrune(keys, at(5), 3).sort()).toEqual([at(1), at(2)]);
  });

  it('orders by the parsed timestamp, never by the order the keys arrive in', () => {
    const keys = [at(4), at(1), at(5), at(3), at(2)];
    expect(preImportBackupsToPrune(keys, at(5), 3).sort()).toEqual([at(1), at(2)]);
    expect(preImportBackupsToPrune([...keys].reverse(), at(5), 3).sort()).toEqual([at(1), at(2)]);
  });

  it('orders the same timestamp by its -N suffix, numerically', () => {
    const keys = [at(0, '-10'), at(0, '-2'), at(0), at(0, '-1'), at(0, '-11')];
    expect(preImportBackupsToPrune(keys, at(0, '-11'), 3).sort()).toEqual([at(0), at(0, '-1')]);
    // Two backups with the same timestamp: the suffixed one is newer.
    expect(preImportBackupsToPrune([at(0, '-1'), at(0)], at(0, '-1'), 1)).toEqual([at(0)]);
    // A later timestamp beats any suffix.
    expect(preImportBackupsToPrune([at(1), at(0, '-9')], at(1), 1)).toEqual([at(0, '-9')]);
  });

  it('never selects the key just written, even when its timestamp is the oldest (clock moved back)', () => {
    const keys = [at(1), at(2), at(3), at(4), at(0)];
    expect(preImportBackupsToPrune(keys, at(0), 3).sort()).toEqual([at(1), at(2)]);
  });

  it('returns nothing while there are no more than `keep` backups', () => {
    expect(preImportBackupsToPrune([at(1), at(2), at(3)], at(3), 3)).toEqual([]);
    expect(preImportBackupsToPrune([at(1)], at(1), 3)).toEqual([]);
  });

  it('only ever selects keys that parse exactly as a pre-import backup', () => {
    const others = [
      MAIN_KEY,
      `eisenhower:backup:${TS}`,
      `eisenhower:backup:${TS}-1`,
      `eisenhower:backup:pre-v1:${TS}`,
      `eisenhower:backup:pre-v2:${TS}-3`,
      'other-app:x',
      `other-app:${PRE}2026-10-19T11:00:00.000Z`,
      `eisenhower:backup:pre-importX:2026-10-19T11:00:00.000Z`,
      `eisenhower:backup:pre-import-2026-10-19T11:00:00.000Z`,
      `${PRE}`,
      `${PRE}not-a-date`,
      `${PRE}2026-10-19`,
      `${PRE}2026-10-19T11:00:00Z`,
      `${PRE}2026-13-45T11:00:00.000Z`,
      `${PRE}2026-02-30T11:00:00.000Z`,
      `${PRE}2026-10-19T11:00:00.000Z-0`,
      `${PRE}2026-10-19T11:00:00.000Z-01`,
      `${PRE}2026-10-19T11:00:00.000Z-x`,
      `${PRE}2026-10-19T11:00:00.000Z:extra`,
      `${PRE}2026-10-19T11:00:00.000Z `,
      ` ${PRE}2026-10-19T11:00:00.000Z`,
      `${PRE.toUpperCase()}2026-10-19T11:00:00.000Z`,
    ];
    const old = [at(1), at(2, '-1')];
    expect(preImportBackupsToPrune([...others, ...old, at(9)], at(9), 1).sort()).toEqual(old.sort());
    expect(preImportBackupsToPrune(others, at(9), 1)).toEqual([]);
  });
});

describe('pre-import backup retention in writeBackup (#11)', () => {
  const PRE = 'eisenhower:backup:pre-import:';
  const MAIN = serialize(stateAt(1));
  /** Present throughout: none of these may change. */
  const OTHERS: Record<string, string> = {
    [BACKUP_KEY]: 'corrupt {',
    [MIGRATION_KEY]: '{"version":0,"tasks":[]}',
    'other-app:x': 'theirs',
    'eisenhower:backup:pre-importX:2026-10-19T11:00:00.000Z': 'near miss',
  };

  function retention(initial: Record<string, string> = {}) {
    let t = NOW;
    const env = setup({ [MAIN_KEY]: MAIN, ...OTHERS, ...initial }, { now: () => t });
    env.port.load();
    const tick = () => (t += 60_000);
    const preImportKeys = () => [...env.ls.data.keys()].filter((k) => k.startsWith(PRE)).sort();
    const untouched = () => {
      expect(env.ls.data.get(MAIN_KEY)).toBe(MAIN);
      for (const [k, v] of Object.entries(OTHERS)) expect(env.ls.data.get(k)).toBe(v);
    };
    return { ...env, tick, preImportKeys, untouched };
  }
  const key = (minutes: number, suffix = '') => `${PRE}${new Date(NOW + minutes * 60_000).toISOString()}${suffix}`;

  it(`keeps ${PRE_IMPORT_KEEP}`, () => {
    expect(PRE_IMPORT_KEEP).toBe(3);
  });

  it('after 5 imports exactly the newest 3 remain, and every other key is byte-identical', () => {
    const { ls, port, tick, preImportKeys, untouched } = retention();
    for (let i = 0; i < 5; i++) {
      expect(port.writeBackup('pre-import', `board ${i}`)).toBe('ok');
      tick();
    }
    expect(preImportKeys()).toEqual([key(2), key(3), key(4)]);
    expect(ls.data.get(key(4))).toBe('board 4');
    expect(ls.data.get(key(2))).toBe('board 2');
    expect(ls.removes.sort()).toEqual([key(0), key(1)]);
    untouched();
  });

  it('with the same timestamp, the -N suffix decides which are newest', () => {
    const { ls, port, preImportKeys, untouched } = retention();
    for (let i = 0; i < 5; i++) expect(port.writeBackup('pre-import', `board ${i}`)).toBe('ok');
    expect(preImportKeys()).toEqual([key(0, '-2'), key(0, '-3'), key(0, '-4')]);
    expect(ls.data.get(key(0, '-4'))).toBe('board 4');
    untouched();
  });

  it('removes backups left by earlier sessions, oldest first by timestamp', () => {
    const { port, preImportKeys, untouched } = retention({
      [key(-3)]: 'b',
      [key(-60)]: 'a',
      [key(-2)]: 'c',
      [key(-1)]: 'd',
    });
    expect(port.writeBackup('pre-import', 'now')).toBe('ok');
    expect(preImportKeys()).toEqual([key(-2), key(-1), key(0)]);
    untouched();
  });

  it('prunes only after a pre-import backup, not after any other label', () => {
    const { ls, port, untouched } = retention({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' });
    expect(port.writeBackup('manual', 'x')).toBe('ok');
    expect(ls.removes).toEqual([]);
    untouched();
  });

  it.each<[BackupResult, () => unknown]>([
    ['full', quota],
    ['failed', () => new DOMException('denied', 'SecurityError')],
  ])('a failed backup write (%s) deletes nothing', (result, error) => {
    const seed = { [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' };
    const { ls, port, untouched } = retention(seed);
    const before = new Map(ls.data);
    ls.failSet = () => error();
    expect(port.writeBackup('pre-import', 'now')).toBe(result);
    expect(ls.removes).toEqual([]);
    expect(ls.data).toEqual(before);
    untouched();
  });

  it('a backup that reads back different deletes nothing', () => {
    const { ls, port, untouched } = retention({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' });
    const setItem = ls.setItem.bind(ls);
    ls.setItem = (k, v) => setItem(k, v.slice(1));
    expect(port.writeBackup('pre-import', 'now')).toBe('failed');
    expect(ls.removes).toEqual([]);
    for (const [k, v] of Object.entries({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' })) {
      expect(ls.data.get(k)).toBe(v);
    }
    untouched();
  });

  it('a removeItem that throws still reports the backup as kept, and touches nothing else', () => {
    const { ls, port, untouched } = retention({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' });
    ls.failRemove = () => new DOMException('denied', 'SecurityError');
    expect(port.writeBackup('pre-import', 'now')).toBe('ok');
    expect(ls.data.get(key(0))).toBe('now');
    expect(ls.data.get(key(-3))).toBe('a');
    expect(ls.removes).toEqual([]);
    untouched();
  });

  it('a store that stops listing its keys once the backup is written still reports it as kept', () => {
    const { ls, port, untouched } = retention({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' });
    const setItem = ls.setItem.bind(ls);
    ls.setItem = (k, v) => {
      setItem(k, v);
      ls.key = () => {
        throw new DOMException('denied', 'SecurityError');
      };
    };
    expect(port.writeBackup('pre-import', 'now')).toBe('ok');
    expect(ls.data.get(key(0))).toBe('now');
    expect(ls.data.get(key(-3))).toBe('a');
    untouched();
  });

  it('a store that cannot list its keys gets no backup, so nothing is deleted and the import aborts', () => {
    const { ls, port, untouched } = retention({ [key(-3)]: 'a', [key(-2)]: 'b', [key(-1)]: 'c' });
    const before = new Map(ls.data);
    ls.key = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    expect(port.writeBackup('pre-import', 'now')).toBe('failed');
    expect(ls.data).toEqual(before);
    untouched();
  });

  it('a pre-import backup never stands in for the backup of unreadable data, since it may be pruned', () => {
    const raw = 'not json {';
    const { ls, port } = setup({ [MAIN_KEY]: raw, [`${PRE}2026-10-19T11:00:00.000Z`]: raw });
    expect(port.load().warning).toBe(WARNINGS.corruptBackedUp);
    expect(ls.data.get(BACKUP_KEY)).toBe(raw);
  });
});
