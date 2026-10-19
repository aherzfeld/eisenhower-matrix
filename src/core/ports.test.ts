import { describe, it, expect, vi } from 'vitest';
import { createMemoryStorage, emptyState } from './ports';

describe('createMemoryStorage', () => {
  it('loads an empty state by default in persistent mode', () => {
    const r = createMemoryStorage().load();
    expect(r.state).toEqual({ version: 1, rev: 0, tasks: [] });
    expect(r.mode).toBe('persistent');
  });
  it('round-trips saves', () => {
    const s = createMemoryStorage();
    const state = { ...emptyState(), rev: 1 };
    expect(s.save(state).ok).toBe(true);
    expect(s.load().state).toEqual(state);
  });
  it('does not alias saved state', () => {
    const s = createMemoryStorage();
    const state = emptyState();
    s.save(state);
    state.rev = 99;
    expect(s.load().state.rev).toBe(0);
  });
  it('refuses to save in readonly mode', () => {
    const s = createMemoryStorage(undefined, 'readonly');
    expect(s.load().mode).toBe('readonly');
    expect(s.save(emptyState()).ok).toBe(false);
  });
  it('notifies subscribers of external changes until unsubscribed', () => {
    const s = createMemoryStorage();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.simulateExternalChange({ ...emptyState(), rev: 5 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.load().state.rev).toBe(5);
    off();
    s.simulateExternalChange(emptyState());
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
