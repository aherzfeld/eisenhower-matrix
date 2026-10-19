/**
 * The StoragePort over window.localStorage, following the Data safety table in
 * docs/plans/v1.md. The rule underneath every branch: never write the main key unless what
 * it holds is either ours (a rev we know) or already safely copied to a backup key.
 */
import { CURRENT_VERSION, parse, serialize } from '../core/codec';
import {
  emptyState,
  type BackupResult,
  type LoadResult,
  type SaveResult,
  type StorageMode,
  type StoragePort,
} from '../core/ports';
import type { StoredState } from '../core/task';

export const MAIN_KEY = 'eisenhower:v1';
export const BACKUP_PREFIX = 'eisenhower:backup:';

/** How many pre-import backups to keep, counting the one just written (decided on #11). */
export const PRE_IMPORT_KEEP = 3;
const PRE_IMPORT_LABEL = 'pre-import';
const PRE_IMPORT_PREFIX = `${BACKUP_PREFIX}${PRE_IMPORT_LABEL}:`;
/** What writeNewBackup puts after the prefix: an ISO timestamp, then `-N` (N from 1) if that key was taken. */
const BACKUP_STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)(?:-([1-9]\d*))?$/;

/** Banner text. Plain words; the first three are the plan's own. */
export const WARNINGS = {
  blocked: 'Not saving: your browser is blocking storage. Export before closing.',
  full: 'Not saving: browser storage is full. Export your tasks, then clear some space.',
  newer: 'Saved by a newer version. Reload the page.',
  conflict: "Changed in another tab. Your last change wasn't saved.",
  corruptBackedUp:
    "Your saved tasks couldn't be read, so the board has started empty. The old data was kept as a backup in this browser. Download it to keep a copy.",
  corruptNotBackedUp:
    "Not saving: your saved tasks couldn't be read, and a backup couldn't be made, so they've been left as they were. Download them, and export before closing.",
  migrationNotBackedUp:
    "Not saving: your tasks couldn't be backed up before updating their format, so they've been left as they were. Export before closing.",
} as const;

/** The part of the DOM Storage interface this adapter uses. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

type EventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
type PersistNavigator = { storage?: { persist?: () => Promise<boolean> } };

export type BrowserStorageOptions = {
  /** Returns the store. A getter, because merely reading window.localStorage can throw. */
  storage?: () => KeyValueStore;
  /** Milliseconds since the epoch, for backup key timestamps. */
  now?: () => number;
  /** Where `storage` events arrive (window). */
  events?: EventSource;
  navigator?: PersistNavigator;
};

/**
 * What this tab last read from or wrote to the main key, and the rev it handed the caller for
 * it. The main key may be overwritten only while it still holds exactly `raw` (or nothing).
 * Comparing the text, not just the rev, matters because revs restart at 0 whenever a tab
 * starts from an empty board: after the key is cleared, or after unreadable data is reset,
 * another tab's rev N is not this tab's rev N.
 */
type Base = { raw: string | null; rev: number };

/** `base.raw` is unreadable or old-format data: back it up (again, if needed) before overwriting it. */
type Guarded = { label: string; warning: string };

/** A session-long refusal to write: storage we can't read, a failed backup, or a newer version. */
type Lock = { mode: 'memory' | 'readonly'; warning: string };

export function createBrowserStorage({
  storage = () => window.localStorage,
  now = Date.now,
  events = typeof window === 'undefined' ? undefined : window,
  navigator: nav = typeof navigator === 'undefined' ? undefined : navigator,
}: BrowserStorageOptions = {}): StoragePort {
  let mode: StorageMode = 'persistent';
  let lock: Lock | null = null;
  let base: Base = { raw: null, rev: 0 };
  let guarded: Guarded | null = null;
  requestPersistence(nav);

  /**
   * Makes sure some backup key holds exactly `raw`: an existing one (from an earlier page load
   * or another tab, so reloading untouched bad data never piles up copies until the quota is
   * full), or else a fresh key that is checked to read back. Returns false on any failure.
   */
  function ensureBackup(store: KeyValueStore, label: string, raw: string): boolean {
    try {
      return hasBackup(store, raw) || writeNewBackup(store, label, raw) !== null;
    } catch {
      return false;
    }
  }

  /** Writes `raw` to an unused backup key and checks it reads back: the key, or null. May throw. */
  function writeNewBackup(store: KeyValueStore, label: string, raw: string): string | null {
    const key = nextBackupKey(store, `${BACKUP_PREFIX}${label ? `${label}:` : ''}${new Date(now()).toISOString()}`);
    if (store.getItem(key) !== null) return null; // never overwrite a backup
    store.setItem(key, raw);
    return store.getItem(key) === raw ? key : null;
  }

  /**
   * Always a fresh key, so an earlier backup is never overwritten. Never throws. Once a
   * pre-import backup has read back, older pre-import backups beyond the newest
   * PRE_IMPORT_KEEP are removed (#11); nothing is removed if the write failed.
   */
  function writeBackup(label: string, text: string): BackupResult {
    if (lock?.mode === 'readonly') return 'failed';
    let store: KeyValueStore;
    let key: string | null;
    try {
      store = storage();
      key = writeNewBackup(store, label, text);
    } catch (e) {
      return isQuotaError(e) ? 'full' : 'failed';
    }
    if (key === null) return 'failed';
    if (label === PRE_IMPORT_LABEL) prunePreImportBackups(store, key);
    return 'ok';
  }

  function locked(next: Lock, state: StoredState, extra: { raw?: string } = {}): LoadResult {
    lock = next;
    mode = next.mode;
    return { state, mode, warning: next.warning, ...extra };
  }

  function load(): LoadResult {
    lock = null;
    guarded = null;
    base = { raw: null, rev: 0 };
    let store: KeyValueStore;
    let raw: string | null;
    try {
      store = storage();
      raw = store.getItem(MAIN_KEY);
    } catch {
      // We can't see what is stored, so writing could destroy it.
      return locked({ mode: 'memory', warning: WARNINGS.blocked }, emptyState());
    }

    mode = 'persistent';
    if (raw === null) return { state: emptyState(), mode };

    const parsed = parse(raw);
    if (parsed.ok) base = { raw, rev: parsed.value.rev };
    if (parsed.ok && parsed.migratedFrom === undefined) return { state: parsed.value, mode };

    if (parsed.ok) {
      const label = `pre-v${CURRENT_VERSION}`;
      const warning = WARNINGS.migrationNotBackedUp;
      if (!ensureBackup(store, label, raw)) return locked({ mode: 'memory', warning }, parsed.value);
      guarded = { label, warning };
      return { state: parsed.value, mode };
    }

    if (parsed.error.kind === 'future-version') {
      return locked({ mode: 'readonly', warning: WARNINGS.newer }, emptyState());
    }

    const warning = WARNINGS.corruptNotBackedUp;
    if (!ensureBackup(store, '', raw)) return locked({ mode: 'memory', warning }, emptyState(), { raw });
    base = { raw, rev: 0 };
    guarded = { label: '', warning };
    return { state: emptyState(), mode, warning: WARNINGS.corruptBackedUp, raw };
  }

  function save(state: StoredState): SaveResult {
    if (lock) {
      return { ok: false, mode, reason: lock.mode === 'readonly' ? 'readonly' : 'unavailable', error: lock.warning };
    }
    const unavailable = (error: string = WARNINGS.blocked): SaveResult => {
      mode = 'memory';
      return { ok: false, mode, reason: 'unavailable', error };
    };
    const conflict = (): SaveResult => ({ ok: false, mode, reason: 'conflict', error: WARNINGS.conflict });

    let store: KeyValueStore;
    let raw: string | null;
    try {
      store = storage();
      raw = store.getItem(MAIN_KEY);
    } catch {
      return unavailable();
    }

    if (raw !== null) {
      if (raw !== base.raw) {
        const current = parse(raw);
        if (!current.ok && current.error.kind === 'future-version') {
          lock = { mode: 'readonly', warning: WARNINGS.newer };
          mode = 'readonly';
          return { ok: false, mode, reason: 'readonly', error: WARNINGS.newer };
        }
        // Anything else written since our last load or save is not ours to overwrite, even at
        // the same rev: the caller reloads, and load() backs up whatever needs it.
        return conflict();
      }
      if (state.rev !== base.rev) return conflict();
      if (guarded && !ensureBackup(store, guarded.label, raw)) {
        lock = { mode: 'memory', warning: guarded.warning };
        mode = 'memory';
        return { ok: false, mode, reason: 'unavailable', error: lock.warning };
      }
    }

    const rev = state.rev + 1;
    const text = serialize({ ...state, rev });
    try {
      store.setItem(MAIN_KEY, text);
    } catch (e) {
      return unavailable(isQuotaError(e) ? WARNINGS.full : WARNINGS.blocked);
    }
    base = { raw: text, rev };
    guarded = null;
    mode = 'persistent';
    return { ok: true, mode, rev };
  }

  function subscribe(onExternalChange: () => void): () => void {
    const listener = (e: Event) => {
      const key = (e as StorageEvent).key;
      // key is null when another tab called localStorage.clear().
      if (key === MAIN_KEY || key === null) onExternalChange();
    };
    events?.addEventListener('storage', listener);
    return () => events?.removeEventListener('storage', listener);
  }

  return { load, save, subscribe, writeBackup };
}

/**
 * A full store, as each engine reports it. Anything else that throws counts as blocked. Never
 * throws itself (reading `name` off an odd thrown value can), so every failed write stays a
 * failed save.
 */
function isQuotaError(e: unknown): boolean {
  try {
    if (typeof e !== 'object' || e === null) return false;
    const { name, code } = e as { name?: unknown; code?: unknown };
    return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
  } catch {
    return false;
  }
}

/**
 * `base`, or `base-N` with N past every `base` / `base-N` already stored. Never a freed lower
 * N, so a later backup always orders after an earlier one even once older ones are removed.
 * May throw.
 */
function nextBackupKey(store: KeyValueStore, base: string): string {
  let next = 0;
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === base) next = Math.max(next, 1);
    else if (key?.startsWith(`${base}-`)) {
      const suffix = key.slice(base.length + 1);
      const n = Number(suffix);
      if (/^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(n + 1)) next = Math.max(next, n + 1);
    }
  }
  return next === 0 ? base : `${base}-${next}`;
}

/**
 * Some backup key already holds exactly `raw`. Pre-import backups don't count: they may be
 * pruned, so they can't be the backup that guards the main key.
 */
function hasBackup(store: KeyValueStore, raw: string): boolean {
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(BACKUP_PREFIX) || key.startsWith(PRE_IMPORT_PREFIX)) continue;
    if (store.getItem(key) === raw) return true;
  }
  return false;
}

/** Orders a pre-import backup key: its timestamp, then its `-N` suffix (none is 0). Null for any other key. */
function parsePreImportKey(key: string): { ms: number; n: number } | null {
  if (!key.startsWith(PRE_IMPORT_PREFIX)) return null;
  const match = BACKUP_STAMP.exec(key.slice(PRE_IMPORT_PREFIX.length));
  if (!match) return null;
  const [, stamp, suffix] = match;
  const ms = Date.parse(stamp!);
  // Round-trips exactly, so no date the engine would quietly roll over (Feb 30) gets through.
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== stamp) return null;
  const n = suffix === undefined ? 0 : Number(suffix);
  return Number.isSafeInteger(n) ? { ms, n } : null;
}

/**
 * Pure: which of `keys` to remove so that `keep` pre-import backups remain, counting
 * `justWritten`, which is never selected (even if a clock moved back makes it look oldest).
 * Only keys that parse exactly as `eisenhower:backup:pre-import:<ISO ts>[-N]` are ever
 * selected; the rest are ordered newest first by timestamp, then by N.
 */
export function preImportBackupsToPrune(keys: readonly string[], justWritten: string, keep: number): string[] {
  const older: { key: string; ms: number; n: number }[] = [];
  for (const key of keys) {
    if (key === justWritten) continue;
    const parsed = parsePreImportKey(key);
    if (parsed) older.push({ key, ...parsed });
  }
  older.sort((a, b) => b.ms - a.ms || b.n - a.n);
  return older.slice(Math.max(keep - 1, 0)).map((b) => b.key);
}

/**
 * Removes the pre-import backups beyond the newest PRE_IMPORT_KEEP. Best effort and never
 * throws: the import it follows goes ahead regardless, and the first failure ends the pass.
 */
function prunePreImportBackups(store: KeyValueStore, justWritten: string): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key !== null) keys.push(key);
    }
    for (const key of preImportBackupsToPrune(keys, justWritten, PRE_IMPORT_KEEP)) store.removeItem(key);
  } catch {
    // Left for the next import to try again.
  }
}

/** Asks the browser not to evict our data (Safari's 7-day rule). Best effort, never awaited. */
function requestPersistence(nav: PersistNavigator | undefined): void {
  try {
    nav?.storage?.persist?.()?.catch(() => {});
  } catch {
    // Unsupported or refused: nothing to do.
  }
}
