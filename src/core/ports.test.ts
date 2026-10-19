import { describe, it, expect, vi } from 'vitest';
import { createMemoryStorage, emptyState, type StoragePort } from './ports';

describe('createMemoryStorage', () => {
  it('loads an empty state by default in persistent mode, with no warning', () => {
    const r = createMemoryStorage().load();
    expect(r).toStrictEqual({ state: { version: 1, rev: 0, tasks: [] }, mode: 'persistent' });
  });
  it('is usable through the StoragePort type', () => {
    const s: StoragePort = createMemoryStorage();
    expect(s.load().mode).toBe('persistent');
  });
  it('reports a configured mode and warning, for banner work', () => {
    const r = createMemoryStorage({ mode: 'memory', warning: 'Not saving.' }).load();
    expect(r.mode).toBe('memory');
    expect(r.warning).toBe('Not saving.');
  });
  it('writes with rev + 1 and returns the new rev', () => {
    const s = createMemoryStorage();
    const r = s.save({ ...emptyState(), lastExportAt: '2026-10-19T12:00:00.000Z' });
    expect(r).toEqual({ ok: true, mode: 'persistent', rev: 1 });
    expect(s.load().state).toEqual({ ...emptyState(), rev: 1, lastExportAt: '2026-10-19T12:00:00.000Z' });
  });
  it('chains saves using the returned rev', () => {
    const s = createMemoryStorage();
    const first = s.save(emptyState());
    if (!first.ok) throw new Error('first save failed');
    expect(s.save({ ...emptyState(), rev: first.rev })).toMatchObject({ ok: true, rev: 2 });
  });
  it('refuses a save based on a stale rev, writing nothing', () => {
    const s = createMemoryStorage();
    s.simulateExternalChange({ ...emptyState(), rev: 5 });
    const r = s.save(emptyState());
    expect(r).toMatchObject({ ok: false, reason: 'conflict' });
    expect(s.load().state.rev).toBe(5);
  });
  it('does not alias saved state', () => {
    const s = createMemoryStorage();
    const state = emptyState();
    s.save(state);
    state.tasks.push({} as never);
    expect(s.load().state.tasks).toEqual([]);
  });
  it('refuses to save in readonly mode', () => {
    const s = createMemoryStorage({ mode: 'readonly' });
    expect(s.load().mode).toBe('readonly');
    expect(s.save(emptyState())).toMatchObject({ ok: false, mode: 'readonly', reason: 'readonly' });
    expect(s.load().state.rev).toBe(0);
  });
  it('does not persist in memory mode', () => {
    const s = createMemoryStorage({ mode: 'memory' });
    expect(s.save(emptyState())).toMatchObject({ ok: false, mode: 'memory', reason: 'unavailable' });
    expect(s.load().state.rev).toBe(0);
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
