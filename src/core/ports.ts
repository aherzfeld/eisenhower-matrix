/** The storage seam the UI depends on, plus an in-memory fake. No DOM, no real storage. */
import type { StoredState } from './task';

/**
 * persistent: saves reach durable storage. memory: storage is unavailable, nothing is
 * persisted. readonly: data from a newer version; the app must never write.
 */
export type StorageMode = 'persistent' | 'memory' | 'readonly';

/**
 * `warning` is text for a persistent banner (blocked storage, corrupt data, newer version).
 * `raw` is set only when the stored data could not be read: it is the unreadable value,
 * byte for byte, for the banner to offer as a download.
 */
export type LoadResult = { state: StoredState; mode: StorageMode; warning?: string; raw?: string };

/** conflict: another tab saved since our rev; load() again. unavailable: storage failed (memory mode). */
export type SaveFailure = 'conflict' | 'readonly' | 'unavailable';

export type SaveResult =
  | { ok: true; mode: StorageMode; rev: number }
  | { ok: false; mode: StorageMode; reason: SaveFailure; error: string };

/**
 * Named StoragePort, not Storage, so it never shadows the DOM's `Storage` (localStorage) type.
 *
 * Rev contract: `state.rev` passed to save() is the rev the caller last loaded or saved.
 * If the stored rev differs, nothing is written and the result is a 'conflict'. Otherwise
 * the state is written with rev + 1 and the result returns that rev for the caller to keep.
 * When nothing is stored at all there is nothing to overwrite, so that is not a conflict.
 * Revs restart at 0 when a tab starts from an empty board, so an adapter may also report a
 * conflict when the stored rev matches but the stored data is not what this tab last saw.
 */
export interface StoragePort {
  load(): LoadResult;
  save(state: StoredState): SaveResult;
  /** Called when another tab changes the data. Returns an unsubscribe function. */
  subscribe(onExternalChange: () => void): () => void;
}

export function emptyState(): StoredState {
  return { version: 1, rev: 0, tasks: [] };
}

export type MemoryStorage = StoragePort & {
  /** Test/UI-work hook: replace the stored state and notify subscribers. */
  simulateExternalChange(state: StoredState): void;
};

export type MemoryStorageOptions = { initial?: StoredState; mode?: StorageMode; warning?: string };

export function createMemoryStorage({
  initial = emptyState(),
  mode = 'persistent',
  warning,
}: MemoryStorageOptions = {}): MemoryStorage {
  let stored: StoredState = structuredClone(initial);
  const listeners = new Set<() => void>();
  return {
    load: () => ({
      state: structuredClone(stored),
      mode,
      ...(warning === undefined ? {} : { warning }),
    }),
    save(state) {
      if (mode === 'readonly') {
        return { ok: false, mode, reason: 'readonly', error: 'Storage is read-only.' };
      }
      if (mode === 'memory') {
        return { ok: false, mode, reason: 'unavailable', error: 'Storage is unavailable.' };
      }
      if (state.rev !== stored.rev) {
        return { ok: false, mode, reason: 'conflict', error: 'Changed in another tab.' };
      }
      stored = { ...structuredClone(state), rev: stored.rev + 1 };
      return { ok: true, mode, rev: stored.rev };
    },
    subscribe(onExternalChange) {
      listeners.add(onExternalChange);
      return () => {
        listeners.delete(onExternalChange);
      };
    },
    simulateExternalChange(state) {
      stored = structuredClone(state);
      for (const l of [...listeners]) l();
    },
  };
}
