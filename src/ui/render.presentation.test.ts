/** Presentational hooks in render.ts that the stylesheet relies on (T12). */
import { describe, expect, it } from 'vitest';
import type { Task } from '../core/task';
import { buildShell, renderBoard } from './render';

const task = (id: string, order: number, urgent = true, important = true): Task => ({
  id,
  title: id,
  urgent,
  important,
  done: false,
  order,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const view = { tabStops: {}, today: '2026-01-01' };
const newIds = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('.task.is-new')].map((li) => li.dataset.taskId);

describe('is-new (print-in hook)', () => {
  it('marks nothing on the first render, so a page load does not animate', () => {
    const root = document.createElement('div');
    const shell = buildShell(root);
    renderBoard(shell, [task('a', 0), task('b', 1)], view);
    expect(newIds(root)).toEqual([]);
  });

  it('marks only rows that were not in that list at the previous render', () => {
    const root = document.createElement('div');
    const shell = buildShell(root);
    renderBoard(shell, [task('a', 0)], view);
    renderBoard(shell, [task('a', 0), task('b', 1)], view);
    expect(newIds(root)).toEqual(['b']);
    renderBoard(shell, [task('a', 0), task('b', 1)], view);
    expect(newIds(root)).toEqual([]);
  });

  it('marks a task moved into another quadrant, which lands there like a new one', () => {
    const root = document.createElement('div');
    const shell = buildShell(root);
    renderBoard(shell, [task('a', 0), task('b', 1)], view);
    renderBoard(shell, [task('a', 0), task('b', 0, false, true)], view);
    expect(newIds(root)).toEqual(['b']);
    expect(root.querySelector('.q--schedule .task')?.classList.contains('is-new')).toBe(true);
  });
});
