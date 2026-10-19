/** Pure operations over a Task[]. Every op returns a new array and never mutates its input. */
import { flagsFor, quadrantOf, type Flags, type Quadrant } from './quadrant';
import {
  validateId,
  validateTimestamp,
  validateTitle,
  validateWhen,
  validateWho,
  type Result,
} from './validate';

export type Task = {
  id: string;
  title: string;
  urgent: boolean;
  important: boolean;
  done: boolean;
  when?: string;
  who?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export type StoredState = { version: 1; rev: number; lastExportAt?: string; tasks: Task[] };

export type NewTask = {
  title: string;
  urgent: boolean;
  important: boolean;
  when?: string;
  who?: string;
};

export type CreateContext = { id: string; now: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });

function inQuadrant(tasks: Task[], q: Quadrant): Task[] {
  return tasks.filter((t) => quadrantOf(t) === q);
}

/** Renumbers every quadrant's order contiguously from 0, keeping relative order. */
function normalizeOrders(tasks: Task[]): Task[] {
  const next = new Map<string, number>();
  for (const q of ['do', 'schedule', 'delegate', 'delete'] as const) {
    [...inQuadrant(tasks, q)]
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => next.set(t.id, i));
  }
  return tasks.map((t) => (next.get(t.id) === t.order ? { ...t } : { ...t, order: next.get(t.id)! }));
}

function find(tasks: Task[], id: string): Result<Task> {
  const t = tasks.find((x) => x.id === id);
  return t ? ok(t) : fail(`No task with id ${id}.`);
}

function update(tasks: Task[], id: string, change: (t: Task) => Task): Result<Task[]> {
  const found = find(tasks, id);
  if (!found.ok) return found;
  return ok(tasks.map((t) => (t.id === id ? change(t) : { ...t })));
}

export function createTask(tasks: Task[], input: NewTask, ctx: CreateContext): Result<Task[]> {
  const id = validateId(ctx.id);
  if (!id.ok) return id;
  const now = validateTimestamp(ctx.now);
  if (!now.ok) return now;
  if (tasks.some((t) => t.id === id.value)) return fail(`Duplicate id ${id.value}.`);
  const title = validateTitle(input.title);
  if (!title.ok) return title;
  const who = validateWho(input.who);
  if (!who.ok) return who;

  const flags = { urgent: input.urgent === true, important: input.important === true };
  const task: Task = {
    id: id.value,
    title: title.value,
    ...flags,
    done: false,
    order: inQuadrant(tasks, quadrantOf(flags)).length,
    createdAt: now.value,
    updatedAt: now.value,
  };
  if (input.when !== undefined) {
    const when = validateWhen(input.when);
    if (!when.ok) return when;
    task.when = when.value;
  }
  if (who.value !== undefined) task.who = who.value;
  return ok(normalizeOrders([...tasks, task]));
}

export function rename(tasks: Task[], id: string, title: string, now: string): Result<Task[]> {
  const t = validateTitle(title);
  if (!t.ok) return t;
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  return update(tasks, id, (task) => ({ ...task, title: t.value, updatedAt: n.value }));
}

/** Moving to a different quadrant appends the task to the destination's order. */
export function setFlags(tasks: Task[], id: string, flags: Flags, now: string): Result<Task[]> {
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  const found = find(tasks, id);
  if (!found.ok) return found;
  const dest = quadrantOf(flags);
  if (quadrantOf(found.value) === dest) return ok(tasks.map((t) => ({ ...t })));
  const f = flagsFor(dest);
  const appended = inQuadrant(tasks, dest).length;
  const moved = tasks.map((t) =>
    t.id === id ? { ...t, ...f, order: appended, updatedAt: n.value } : { ...t },
  );
  return ok(normalizeOrders(moved));
}

/** `undefined` clears the date. */
export function setWhen(tasks: Task[], id: string, when: string | undefined, now: string): Result<Task[]> {
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  if (when === undefined) {
    return update(tasks, id, (task) => {
      const { when: _removed, ...rest } = task;
      void _removed;
      return { ...rest, updatedAt: n.value };
    });
  }
  const w = validateWhen(when);
  if (!w.ok) return w;
  return update(tasks, id, (task) => ({ ...task, when: w.value, updatedAt: n.value }));
}

/** Empty or whitespace-only `who` removes the field. */
export function setWho(tasks: Task[], id: string, who: string, now: string): Result<Task[]> {
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  const w = validateWho(who);
  if (!w.ok) return w;
  return update(tasks, id, (task) => {
    const { who: _removed, ...rest } = task;
    void _removed;
    return w.value === undefined
      ? { ...rest, updatedAt: n.value }
      : { ...rest, who: w.value, updatedAt: n.value };
  });
}

export function toggleDone(tasks: Task[], id: string, now: string): Result<Task[]> {
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  return update(tasks, id, (task) => ({ ...task, done: !task.done, updatedAt: n.value }));
}

/** Swaps with the neighbour in the same quadrant; a no-op at the edge. Orders stay contiguous. */
export function reorder(tasks: Task[], id: string, direction: 'up' | 'down', now: string): Result<Task[]> {
  const n = validateTimestamp(now);
  if (!n.ok) return n;
  const found = find(tasks, id);
  if (!found.ok) return found;
  const sorted = [...inQuadrant(tasks, quadrantOf(found.value))].sort((a, b) => a.order - b.order);
  const i = sorted.findIndex((t) => t.id === id);
  const j = direction === 'up' ? i - 1 : i + 1;
  const neighbour = sorted[j];
  if (!neighbour) return ok(normalizeOrders(tasks));
  const swapped = [...sorted];
  swapped[i] = neighbour;
  swapped[j] = found.value;
  const position = new Map(swapped.map((t, k) => [t.id, k]));
  const out = tasks.map((t) => {
    const p = position.get(t.id);
    if (p === undefined) return { ...t };
    const touched = t.id === id || t.id === neighbour.id;
    return { ...t, order: p, ...(touched ? { updatedAt: n.value } : {}) };
  });
  return ok(out);
}
