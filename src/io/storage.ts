/**
 * The StoragePort over window.localStorage, following the Data safety table in
 * docs/plans/v1.md. The rule underneath every branch: never write the main key unless what
 * it holds is either ours (a rev we know) or already safely copied to a backup key.
 */
import { CURRENT_VERSION, parse, serialize } from '../core/codec';
import { emptyState, type LoadResult, type SaveResult, type StorageMode, type StoragePort } from '../core/ports';
import type { StoredState } from '../core/task';

export const MAIN_KEY = 'eisenhower:v1';
export const BACKUP_PREFIX = 'eisenhower:backup:';

/** Banner text. Plain words; the first three are the plan's own. */
export const WARNINGS = {
  blocked: 'Not saving: your browser is blocking storage. Export before closing.',
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
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

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

/** The main key holds a value we could not save over without a backup, and the backup exists. */
type Guarded = { raw: string; rev: number; label: string; warning: string };

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
  let guarded: Guarded | null = null;
  /** The last backup written per label, so reloading the same bad value doesn't copy it twice. */
  const backups = new Map<string, { raw: string; key: string }>();

  requestPersistence(nav);

  /** Copies `raw` to a fresh backup key and checks it reads back. Returns false on any failure. */
  function ensureBackup(store: KeyValueStore, label: string, raw: string): boolean {
    try {
      const known = backups.get(label);
      if (known && known.raw === raw && store.getItem(known.key) === raw) return true;
      const base = `${BACKUP_PREFIX}${label ? `${label}:` : ''}${new Date(now()).toISOString()}`;
      let key = base;
      for (let i = 1; store.getItem(key) !== null; i++) {
        if (i > 100) return false;
        key = `${base}-${i}`;
      }
      store.setItem(key, raw);
      if (store.getItem(key) !== raw) return false;
      backups.set(label, { raw, key });
      return true;
    } catch {
      return false;
    }
  }

  function locked(next: Lock, state: StoredState, extra: { raw?: string } = {}): LoadResult {
    lock = next;
    mode = next.mode;
    return { state, mode, warning: next.warning, ...extra };
  }

  function load(): LoadResult {
    lock = null;
    guarded = null;
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
    if (parsed.ok && parsed.migratedFrom === undefined) return { state: parsed.value, mode };

    if (parsed.ok) {
      const label = `pre-v${CURRENT_VERSION}`;
      const warning = WARNINGS.migrationNotBackedUp;
      if (!ensureBackup(store, label, raw)) return locked({ mode: 'memory', warning }, parsed.value);
      guarded = { raw, rev: parsed.value.rev, label, warning };
      return { state: parsed.value, mode };
    }

    if (parsed.error.kind === 'future-version') {
      return locked({ mode: 'readonly', warning: WARNINGS.newer }, emptyState());
    }

    const warning = WARNINGS.corruptNotBackedUp;
    if (!ensureBackup(store, '', raw)) return locked({ mode: 'memory', warning }, emptyState(), { raw });
    guarded = { raw, rev: 0, label: '', warning };
    return { state: emptyState(), mode, warning: WARNINGS.corruptBackedUp, raw };
  }

  function save(state: StoredState): SaveResult {
    if (lock) {
      return { ok: false, mode, reason: lock.mode === 'readonly' ? 'readonly' : 'unavailable', error: lock.warning };
    }
    const unavailable = (): SaveResult => {
      mode = 'memory';
      return { ok: false, mode, reason: 'unavailable', error: WARNINGS.blocked };
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
      if (guarded && raw === guarded.raw) {
        if (state.rev !== guarded.rev) return conflict();
        if (!ensureBackup(store, guarded.label, raw)) {
          lock = { mode: 'memory', warning: guarded.warning };
          mode = 'memory';
          return { ok: false, mode, reason: 'unavailable', error: lock.warning };
        }
      } else {
        const current = parse(raw);
        if (!current.ok && current.error.kind === 'future-version') {
          lock = { mode: 'readonly', warning: WARNINGS.newer };
          mode = 'readonly';
          return { ok: false, mode, reason: 'readonly', error: WARNINGS.newer };
        }
        // Unreadable or old-format data that appeared since load() is not ours to overwrite:
        // the caller reloads, and load() backs it up.
        if (!current.ok || current.migratedFrom !== undefined) return conflict();
        if (current.value.rev !== state.rev) return conflict();
      }
    }

    const rev = state.rev + 1;
    try {
      store.setItem(MAIN_KEY, serialize({ ...state, rev }));
    } catch {
      return unavailable();
    }
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

  return { load, save, subscribe };
}

/** Asks the browser not to evict our data (Safari's 7-day rule). Best effort, never awaited. */
function requestPersistence(nav: PersistNavigator | undefined): void {
  try {
    nav?.storage?.persist?.()?.catch(() => {});
  } catch {
    // Unsupported or refused: nothing to do.
  }
}
