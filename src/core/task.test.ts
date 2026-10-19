import { describe, it, expect } from 'vitest';
import {
  createTask,
  rename,
  reorder,
  setFlags,
  setWhen,
  setWho,
  toggleDone,
} from './task';
import { quadrantOf } from './quadrant';
import type { Task } from './task';

const T0 = '2026-10-19T12:00:00.000Z';
const T1 = '2026-10-19T13:00:00.000Z';

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function add(tasks: Task[], id: string, urgent = true, important = true, title = id): Task[] {
  return must(createTask(tasks, { title, urgent, important }, { id, now: T0 }));
}

function orders(tasks: Task[], urgent: boolean, important: boolean): [string, number][] {
  return tasks
    .filter((t) => t.urgent === urgent && t.important === important)
    .sort((a, b) => a.order - b.order)
    .map((t) => [t.id, t.order]);
}

describe('createTask', () => {
  it('appends to the quadrant with trimmed fields and timestamps', () => {
    let tasks = add([], 'a');
    tasks = must(
      createTask(tasks, { title: '  B  ', urgent: true, important: true, who: ' Sam ', when: '2026-10-20' }, { id: 'b', now: T1 }),
    );
    expect(tasks[1]).toEqual({
      id: 'b', title: 'B', urgent: true, important: true, done: false, order: 1,
      who: 'Sam', when: '2026-10-20', createdAt: T1, updatedAt: T1,
    });
  });
  it('starts each quadrant at order 0', () => {
    const tasks = add(add([], 'a', true, true), 'b', false, false);
    expect(tasks.map((t) => t.order)).toEqual([0, 0]);
  });
  it('rejects bad input without changing anything', () => {
    expect(createTask([], { title: '  ', urgent: true, important: true }, { id: 'a', now: T0 }).ok).toBe(false);
    expect(createTask([], { title: 'x', urgent: true, important: true }, { id: '', now: T0 }).ok).toBe(false);
    expect(createTask([], { title: 'x', urgent: true, important: true }, { id: 'a', now: 'bad' }).ok).toBe(false);
    expect(createTask([], { title: 'x', urgent: true, important: true, when: '2026-02-30' }, { id: 'a', now: T0 }).ok).toBe(false);
  });
  it('rejects a duplicate id', () => {
    expect(createTask(add([], 'a'), { title: 'x', urgent: true, important: true }, { id: 'a', now: T0 }).ok).toBe(false);
  });
});

describe('rename', () => {
  it('trims, sets updatedAt', () => {
    const t = must(rename(add([], 'a'), 'a', '  New ', T1))[0]!;
    expect(t.title).toBe('New');
    expect(t.updatedAt).toBe(T1);
    expect(t.createdAt).toBe(T0);
  });
  it('rejects invalid titles and unknown ids', () => {
    expect(rename(add([], 'a'), 'a', '', T1).ok).toBe(false);
    expect(rename(add([], 'a'), 'a', 'x'.repeat(201), T1).ok).toBe(false);
    expect(rename(add([], 'a'), 'zzz', 'x', T1).ok).toBe(false);
  });
});

describe('setFlags', () => {
  it('moves to the destination quadrant, appending to its order', () => {
    let tasks = add(add([], 'a', true, true), 'b', false, true);
    tasks = add(tasks, 'c', false, true);
    tasks = must(setFlags(tasks, 'a', { urgent: false, important: true }, T1));
    expect(orders(tasks, false, true)).toEqual([['b', 0], ['c', 1], ['a', 2]]);
    expect(quadrantOf(tasks.find((t) => t.id === 'a')!)).toBe('schedule');
    expect(tasks.find((t) => t.id === 'a')!.updatedAt).toBe(T1);
  });
  it('keeps the source quadrant contiguous', () => {
    let tasks = add(add(add([], 'a'), 'b'), 'c');
    tasks = must(setFlags(tasks, 'a', { urgent: false, important: false }, T1));
    expect(orders(tasks, true, true)).toEqual([['b', 0], ['c', 1]]);
  });
  it('is a no-op for the same quadrant', () => {
    const tasks = add(add([], 'a'), 'b');
    const out = must(setFlags(tasks, 'a', { urgent: true, important: true }, T1));
    expect(out).toEqual(tasks);
  });
  it('rejects unknown ids', () => {
    expect(setFlags([], 'a', { urgent: true, important: true }, T1).ok).toBe(false);
  });
});

describe('setWhen / setWho', () => {
  it('sets and clears when', () => {
    let tasks = must(setWhen(add([], 'a'), 'a', '2026-10-25', T1));
    expect(tasks[0]!.when).toBe('2026-10-25');
    tasks = must(setWhen(tasks, 'a', undefined, T1));
    expect('when' in tasks[0]!).toBe(false);
  });
  it('rejects a bad date', () => {
    expect(setWhen(add([], 'a'), 'a', '2026-02-30', T1).ok).toBe(false);
  });
  it('sets who, trims, removes the field when empty', () => {
    let tasks = must(setWho(add([], 'a'), 'a', ' Sam ', T1));
    expect(tasks[0]!.who).toBe('Sam');
    tasks = must(setWho(tasks, 'a', '  ', T1));
    expect('who' in tasks[0]!).toBe(false);
  });
  it('rejects who over 80 chars', () => {
    expect(setWho(add([], 'a'), 'a', 'x'.repeat(81), T1).ok).toBe(false);
    expect(setWho(add([], 'a'), 'a', 'x'.repeat(80), T1).ok).toBe(true);
  });
});

describe('toggleDone', () => {
  it('flips done and sets updatedAt', () => {
    let tasks = must(toggleDone(add([], 'a'), 'a', T1));
    expect(tasks[0]!.done).toBe(true);
    expect(tasks[0]!.updatedAt).toBe(T1);
    tasks = must(toggleDone(tasks, 'a', T1));
    expect(tasks[0]!.done).toBe(false);
  });
});

describe('reorder', () => {
  const three = () => add(add(add([], 'a'), 'b'), 'c');
  it('moves down and up within the quadrant', () => {
    let tasks = must(reorder(three(), 'a', 'down', T1));
    expect(orders(tasks, true, true)).toEqual([['b', 0], ['a', 1], ['c', 2]]);
    tasks = must(reorder(tasks, 'c', 'up', T1));
    expect(orders(tasks, true, true)).toEqual([['b', 0], ['c', 1], ['a', 2]]);
  });
  it('is a no-op at the edges', () => {
    const tasks = three();
    expect(must(reorder(tasks, 'a', 'up', T1))).toEqual(tasks);
    expect(must(reorder(tasks, 'c', 'down', T1))).toEqual(tasks);
  });
  it('only touches its own quadrant and stays contiguous', () => {
    let tasks = add(three(), 'x', false, false);
    tasks = must(reorder(tasks, 'b', 'up', T1));
    expect(orders(tasks, true, true).map(([, o]) => o)).toEqual([0, 1, 2]);
    expect(orders(tasks, false, false)).toEqual([['x', 0]]);
  });
  it('repairs a non-contiguous quadrant', () => {
    const tasks = three().map((t, i) => ({ ...t, order: i * 5 }));
    const out = must(reorder(tasks, 'b', 'up', T1));
    expect(orders(out, true, true)).toEqual([['b', 0], ['a', 1], ['c', 2]]);
  });
  it('rejects unknown ids', () => {
    expect(reorder(three(), 'zzz', 'up', T1).ok).toBe(false);
  });
});

describe('purity', () => {
  it('no operation mutates its input', () => {
    const tasks = add(add(add([], 'a'), 'b'), 'c', false, true);
    const frozen = structuredClone(tasks);
    const deepFreeze = (o: object): void => {
      Object.freeze(o);
      for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
    };
    deepFreeze(tasks);
    const results = [
      createTask(tasks, { title: 'n', urgent: true, important: true }, { id: 'n', now: T1 }),
      rename(tasks, 'a', 'z', T1),
      setFlags(tasks, 'a', { urgent: false, important: false }, T1),
      setWhen(tasks, 'a', '2026-10-25', T1),
      setWho(tasks, 'a', 'Sam', T1),
      toggleDone(tasks, 'a', T1),
      reorder(tasks, 'a', 'down', T1),
    ];
    for (const r of results) expect(r.ok).toBe(true);
    expect(tasks).toEqual(frozen);
  });
  it('returns a new array even for no-ops', () => {
    const tasks = add([], 'a');
    expect(must(reorder(tasks, 'a', 'up', T1))).not.toBe(tasks);
  });
});
