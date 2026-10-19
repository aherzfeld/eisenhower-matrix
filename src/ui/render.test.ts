import { describe, expect, it } from 'vitest';
import type { Task } from '../core/task';
import { sortedFor } from './render';

const t = (id: string, order: number, done = false, urgent = true, important = true): Task => ({
  id,
  title: id,
  urgent,
  important,
  done,
  order,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('sortedFor', () => {
  it('keeps only the quadrant, sorted by order, with done tasks after open ones', () => {
    const tasks = [t('a', 2), t('b', 0, true), t('c', 1), t('d', 0), t('x', 0, false, false, true)];
    expect(sortedFor(tasks, 'do').map((x) => x.id)).toEqual(['d', 'c', 'a', 'b']);
    expect(sortedFor(tasks, 'schedule').map((x) => x.id)).toEqual(['x']);
    expect(sortedFor(tasks, 'delete')).toEqual([]);
  });
});
