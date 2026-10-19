import { describe, expect, it } from 'vitest';
import { quadrantOf, type Quadrant } from './quadrant';
import { createTask, setFlags, type Task } from './task';
import { clearDone, dropQuadrant, removeOne, restore } from './undo';

const NOW = '2026-03-01T12:00:00.000Z';

function task(id: string, q: Quadrant, order: number, done = false): Task {
  const flags = {
    do: { urgent: true, important: true },
    schedule: { urgent: false, important: true },
    delegate: { urgent: true, important: false },
    delete: { urgent: false, important: false },
  }[q];
  return { id, title: `T ${id}`, ...flags, done, order, createdAt: NOW, updatedAt: NOW };
}

/** Ids of a quadrant in `order`. */
const ids = (tasks: Task[], q: Quadrant) =>
  tasks
    .filter((t) => quadrantOf(t) === q)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);

function expectContiguous(tasks: Task[]) {
  for (const q of ['do', 'schedule', 'delegate', 'delete'] as const) {
    const orders = tasks.filter((t) => quadrantOf(t) === q).map((t) => t.order).sort((a, b) => a - b);
    expect(orders, q).toEqual(orders.map((_, i) => i));
  }
}

const board = () => [
  task('a', 'do', 0),
  task('b', 'do', 1, true),
  task('c', 'do', 2),
  task('d', 'do', 3, true),
  task('s', 'schedule', 0, true),
  task('x', 'delete', 0),
  task('y', 'delete', 1),
];

describe('removeOne', () => {
  it('removes the task, keeps orders contiguous and records what it removed', () => {
    const before = board();
    const r = removeOne(before, 'b');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.value.tasks, 'do')).toEqual(['a', 'c', 'd']);
    expectContiguous(r.value.tasks);
    expect(r.value.record.removed.map((t) => t.id)).toEqual(['b']);
    expect(r.value.record.removed[0].order).toBe(1);
  });

  it('fails for an unknown id', () => {
    expect(removeOne(board(), 'nope').ok).toBe(false);
  });

  it('never mutates its input', () => {
    const before = board();
    const copy = structuredClone(before);
    removeOne(before, 'a');
    expect(before).toEqual(copy);
  });
});

describe('clearDone', () => {
  it('removes every done task in every quadrant', () => {
    const r = clearDone(board());
    expect(r.record.removed.map((t) => t.id).sort()).toEqual(['b', 'd', 's']);
    expect(ids(r.tasks, 'do')).toEqual(['a', 'c']);
    expect(ids(r.tasks, 'schedule')).toEqual([]);
    expectContiguous(r.tasks);
  });

  it('returns the same array when nothing is done', () => {
    const tasks = [task('a', 'do', 0)];
    const r = clearDone(tasks);
    expect(r.tasks).toBe(tasks);
    expect(r.record.removed).toEqual([]);
  });
});

describe('dropQuadrant', () => {
  it('removes every task in the quadrant and nothing else', () => {
    const r = dropQuadrant(board(), 'delete');
    expect(r.record.removed.map((t) => t.id)).toEqual(['x', 'y']);
    expect(ids(r.tasks, 'delete')).toEqual([]);
    expect(r.tasks).toHaveLength(5);
  });

  it('returns the same array when the quadrant is empty', () => {
    const tasks = [task('a', 'do', 0)];
    expect(dropQuadrant(tasks, 'delete').tasks).toBe(tasks);
  });
});

describe('restore', () => {
  it('undoes each removal kind exactly', () => {
    const before = board();
    const one = removeOne(before, 'c');
    if (!one.ok) throw new Error(one.error);
    for (const r of [one.value, clearDone(before), dropQuadrant(before, 'delete')]) {
      const back = restore(r.tasks, r.record);
      expect(back.sort((p, q) => p.id.localeCompare(q.id))).toEqual(
        [...before].sort((p, q) => p.id.localeCompare(q.id)),
      );
    }
  });

  it('puts tasks back in their original relative positions, orders contiguous', () => {
    const r = clearDone(board()); // removes b and d from a,b,c,d
    const back = restore(r.tasks, r.record);
    expect(ids(back, 'do')).toEqual(['a', 'b', 'c', 'd']);
    expectContiguous(back);
  });

  it('keeps a task added during the window (re-inserts by id, not a snapshot)', () => {
    const r = removeOne(board(), 'a');
    if (!r.ok) throw new Error(r.error);
    const added = createTask(r.value.tasks, { title: 'New', urgent: true, important: true }, { id: 'n', now: NOW });
    if (!added.ok) throw new Error(added.error);
    const back = restore(added.value, r.value.record);
    expect(ids(back, 'do')).toEqual(['a', 'b', 'c', 'd', 'n']);
    expectContiguous(back);
  });

  it('keeps changes made during the window to surviving tasks', () => {
    const r = removeOne(board(), 'b');
    if (!r.ok) throw new Error(r.error);
    const moved = setFlags(r.value.tasks, 'c', { urgent: false, important: true }, '2026-03-01T12:00:01.000Z');
    if (!moved.ok) throw new Error(moved.error);
    const back = restore(moved.value, r.value.record);
    expect(ids(back, 'do')).toEqual(['a', 'b', 'd']);
    expect(ids(back, 'schedule')).toEqual(['s', 'c']);
    expect(back.find((t) => t.id === 'c')!.updatedAt).toBe('2026-03-01T12:00:01.000Z');
    expectContiguous(back);
  });

  it('skips any id that already exists, and returns the same array when nothing is restored', () => {
    const r = removeOne(board(), 'b');
    if (!r.ok) throw new Error(r.error);
    const once = restore(r.value.tasks, r.value.record);
    const twice = restore(once, r.value.record);
    expect(twice).toBe(once);
    expect(twice.filter((t) => t.id === 'b')).toHaveLength(1);
  });

  it('puts a task back first when everything before it is gone', () => {
    const r = removeOne(board(), 'a');
    if (!r.ok) throw new Error(r.error);
    const r2 = removeOne(r.value.tasks, 'b');
    if (!r2.ok) throw new Error(r2.error);
    const back = restore(r2.value.tasks, r.value.record); // undo only the first removal
    expect(ids(back, 'do')).toEqual(['a', 'c', 'd']);
    expectContiguous(back);
  });

  it('never mutates its input', () => {
    const r = clearDone(board());
    const copy = structuredClone(r.tasks);
    restore(r.tasks, r.record);
    expect(r.tasks).toEqual(copy);
  });
});
