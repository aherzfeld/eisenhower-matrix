/**
 * Removal with undo. Pure: every function returns new arrays and never mutates its input.
 *
 * Undo re-inserts the removed tasks by id; it never restores a snapshot, so tasks added
 * or changed after the removal survive it.
 */
import { QUADRANTS, quadrantOf, type Quadrant } from './quadrant';
import { normalizeOrders, type Task } from './task';
import type { Result } from './validate';

export type RemovalRecord = {
  /** The removed tasks as they were, `order` included. */
  removed: Task[];
  /** Each affected quadrant's ids in order, as they stood before the removal. */
  sequences: Partial<Record<Quadrant, string[]>>;
};

export type Removal = { tasks: Task[]; record: RemovalRecord };

function idsByOrder(tasks: readonly Task[], q: Quadrant): string[] {
  return tasks
    .filter((t) => quadrantOf(t) === q)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.id);
}

/** Removes every task matching `pick`. With no match it returns `tasks` itself. */
function removeWhere(tasks: Task[], pick: (t: Task) => boolean): Removal {
  const removed = tasks.filter(pick);
  if (removed.length === 0) return { tasks, record: { removed: [], sequences: {} } };
  const sequences: RemovalRecord['sequences'] = {};
  for (const t of removed) sequences[quadrantOf(t)] ??= idsByOrder(tasks, quadrantOf(t));
  return {
    tasks: normalizeOrders(tasks.filter((t) => !pick(t))),
    record: { removed: removed.map((t) => ({ ...t })), sequences },
  };
}

export function removeOne(tasks: Task[], id: string): Result<Removal> {
  if (!tasks.some((t) => t.id === id)) return { ok: false, error: `No task with id ${id}.` };
  return { ok: true, value: removeWhere(tasks, (t) => t.id === id) };
}

export function clearDone(tasks: Task[]): Removal {
  return removeWhere(tasks, (t) => t.done);
}

export function dropQuadrant(tasks: Task[], q: Quadrant): Removal {
  return removeWhere(tasks, (t) => quadrantOf(t) === q);
}

/**
 * Re-inserts the record's tasks. An id that already exists is skipped. Each task goes back
 * right after its nearest original predecessor that is still in the quadrant (or first,
 * if none is), so original relative positions hold and newer tasks keep their place.
 * Orders stay contiguous. With nothing to restore it returns `tasks` itself.
 */
export function restore(tasks: Task[], record: RemovalRecord): Task[] {
  const present = new Set(tasks.map((t) => t.id));
  const back = record.removed.filter((t) => !present.has(t.id));
  if (back.length === 0) return tasks;

  const position = new Map<string, number>();
  for (const { id: q } of QUADRANTS) {
    const returning = back.filter((t) => quadrantOf(t) === q);
    if (returning.length === 0) continue;
    const original = record.sequences[q] ?? [];
    const indexIn = (id: string) => original.indexOf(id);
    const current = idsByOrder(tasks, q);
    for (const t of [...returning].sort((a, b) => indexIn(a.id) - indexIn(b.id))) {
      let at = 0;
      for (let i = indexIn(t.id) - 1; i >= 0; i--) {
        const k = current.indexOf(original[i]);
        if (k !== -1) {
          at = k + 1;
          break;
        }
      }
      current.splice(at, 0, t.id);
    }
    current.forEach((id, i) => position.set(id, i));
  }

  const place = (t: Task): Task => {
    const p = position.get(t.id);
    return p === undefined || p === t.order ? { ...t } : { ...t, order: p };
  };
  return [...tasks.map(place), ...back.map(place)];
}
