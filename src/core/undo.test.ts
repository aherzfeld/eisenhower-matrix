import { describe, expect, it } from 'vitest';
import { QUADRANTS, quadrantOf, type Quadrant } from './quadrant';
import { createTask, rename, reorder, setFlags, toggleDone, type Task } from './task';
import { clearDone, dropQuadrant, removeOne, restore, type Removal } from './undo';
import type { Result } from './validate';

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
    expect(r.value.record.removed[0]?.order).toBe(1);
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

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A task without its order, which a restore may renumber. */
const strip = (t: Task) => ({ ...t, order: undefined });

function randomOp(rnd: () => number, tasks: Task[], next: () => string): Result<Task[]> {
  const pick = () => (tasks.length ? tasks[Math.floor(rnd() * tasks.length)]!.id : 'missing');
  switch (Math.floor(rnd() * 6)) {
    case 0:
      return createTask(tasks, { title: 'x', urgent: rnd() < 0.5, important: rnd() < 0.5 }, { id: next(), now: NOW });
    case 1:
      return rename(tasks, pick(), 'renamed', NOW);
    case 2:
      return setFlags(tasks, pick(), { urgent: rnd() < 0.5, important: rnd() < 0.5 }, NOW);
    case 3:
      return toggleDone(tasks, pick(), NOW);
    case 4:
      return reorder(tasks, pick(), rnd() < 0.5 ? 'up' : 'down', NOW);
    default: {
      const r = removeOne(tasks, pick());
      return r.ok ? { ok: true, value: r.value.tasks } : r;
    }
  }
}

describe('restore over random boards, removals and changes made during the window', () => {
  it('keeps every task, brings back each missing one after its nearest original predecessor, orders contiguous', () => {
    let restoredSeen = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const rnd = rng(seed);
      let k = 0;
      const next = () => `t${k++}`;
      let tasks: Task[] = [];
      for (let i = 0; i < 1 + rnd() * 25; i++) {
        const r = randomOp(rnd, tasks, next);
        if (r.ok) tasks = r.value;
      }
      const kind = Math.floor(rnd() * 3);
      let removal: Removal;
      if (kind === 0) {
        const r = removeOne(tasks, tasks.length ? tasks[Math.floor(rnd() * tasks.length)]!.id : 'm');
        if (!r.ok) continue;
        removal = r.value;
      } else if (kind === 1) removal = clearDone(tasks);
      else removal = dropQuadrant(tasks, QUADRANTS[Math.floor(rnd() * 4)]!.id);

      let mid = removal.tasks;
      const steps = rnd() < 0.3 ? 0 : Math.floor(rnd() * 8);
      for (let i = 0; i < steps; i++) {
        const r = randomOp(rnd, mid, next);
        if (r.ok) mid = r.value;
      }
      const out = restore(mid, removal.record);
      const msg = `seed ${seed}`;
      // contiguity
      for (const q of QUADRANTS) {
        const orders = out.filter((t) => quadrantOf(t) === q.id).map((t) => t.order).sort((a, b) => a - b);
        expect(orders, msg).toEqual(orders.map((_, i) => i));
      }
      // ids unique
      expect(new Set(out.map((t) => t.id)).size, msg).toBe(out.length);
      // every mid task survives, unchanged except order, relative order kept
      for (const t of mid) expect(strip(out.find((o) => o.id === t.id)!), msg).toEqual(strip(t));
      for (const q of QUADRANTS) {
        const m = ids(mid, q.id);
        expect(ids(out, q.id).filter((id) => m.includes(id)), msg).toEqual(m);
      }
      // removed tasks not already present come back as they were
      const midIds = new Set(mid.map((t) => t.id));
      const back = removal.record.removed.filter((t) => !midIds.has(t.id));
      restoredSeen += back.length;
      expect(out.length, msg).toBe(mid.length + back.length);
      for (const t of back) expect(strip(out.find((o) => o.id === t.id)!), msg).toEqual(strip(t));
      // no intervening ops: exact original
      if (steps === 0) {
        const sort = (a: Task[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
        expect(sort(out), msg).toEqual(sort(tasks));
      }
      // each restored task sits right after its nearest original predecessor still present (or first)
      for (const t of back) {
        const q = quadrantOf(t);
        const orig = removal.record.sequences[q]!;
        const seq = ids(out, q);
        const i = orig.indexOf(t.id);
        const pred = orig.slice(0, i).reverse().find((id) => seq.includes(id));
        const at = seq.indexOf(t.id);
        expect(pred === undefined ? at === 0 : seq[at - 1] === pred, `${msg} ${t.id} after ${pred}: ${seq.join(',')}`).toBe(true);
      }
    }
    expect(restoredSeen).toBeGreaterThan(400);
  });
});
