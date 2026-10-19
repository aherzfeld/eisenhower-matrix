/** Reordering by what the user sees. Pure. */
import { quadrantOf } from '../core/quadrant';
import { reorder, type Task } from '../core/task';
import type { Result } from '../core/validate';
import { sortedFor } from './render';

/**
 * Done tasks are shown below open ones, so the on-screen neighbour is not always the
 * neighbour by `order`. Steps core `reorder` until the task passes its visible neighbour.
 * With no visible neighbour it returns `tasks` itself (same array), which commit treats as a no-op.
 */
export function reorderVisible(tasks: Task[], id: string, direction: 'up' | 'down', now: string): Result<Task[]> {
  const task = tasks.find((t) => t.id === id);
  if (!task) return reorder(tasks, id, direction, now);
  const group = sortedFor(tasks, quadrantOf(task)).filter((t) => t.done === task.done);
  const i = group.findIndex((t) => t.id === id);
  const neighbour = group[direction === 'up' ? i - 1 : i + 1];
  if (!neighbour) return { ok: true, value: tasks };
  const orderOf = (ts: Task[], tid: string) => ts.find((t) => t.id === tid)!.order;
  let current = tasks;
  for (let step = 0; step < tasks.length; step++) {
    const result = reorder(current, id, direction, now);
    if (!result.ok) return result;
    current = result.value;
    const mine = orderOf(current, id);
    const theirs = orderOf(current, neighbour.id);
    if (direction === 'up' ? mine < theirs : mine > theirs) break;
  }
  return { ok: true, value: current };
}
