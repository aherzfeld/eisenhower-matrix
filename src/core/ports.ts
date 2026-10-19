/** The Storage seam the UI depends on, plus an in-memory fake. No DOM, no real storage. */
import type { StoredState } from './task';

export type StorageMode = 'persistent' | 'memory' | 'readonly';

export type LoadResult = { state: StoredState; mode: StorageMode; warning?: string };

export type SaveResult = { ok: true; mode: StorageMode } | { ok: false; mode: StorageMode; error: string };

export interface Storage {
  load(): LoadResult;
  save(state: StoredState): SaveResult;
  /** Called when another tab changes the data. Returns an unsubscribe function. */
  subscribe(onExternalChange: () => void): () => void;
}

export function emptyState(): StoredState {
  return { version: 1, rev: 0, tasks: [] };
}

export type MemoryStorage = Storage & {
  /** Test/UI-work hook: replace the stored state and notify subscribers. */
  simulateExternalChange(state: StoredState): void;
};

export function createMemoryStorage(
  initial: StoredState = emptyState(),
  mode: StorageMode = 'persistent',
): MemoryStorage {
  let stored: StoredState = structuredClone(initial);
  const listeners = new Set<() => void>();
  return {
    load: () => ({ state: structuredClone(stored), mode }),
    save(state) {
      if (mode === 'readonly') return { ok: false, mode, error: 'Storage is read-only.' };
      stored = structuredClone(state);
      return { ok: true, mode };
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
