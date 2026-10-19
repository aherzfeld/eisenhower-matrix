/** Review mode: re-asks both triage questions for every open task. Pure; app.ts does the DOM and saving. */
import { QUADRANTS, quadrantOf, type Flags } from '../core/quadrant';
import type { Task } from '../core/task';
import { START, triageKey, type Triage } from './capture';

/** `queue` is a snapshot of task ids taken at the start, so moving a task cannot reshuffle the walk. */
export type Review = { queue: string[]; index: number; triage: Triage };

export type ReviewOutcome =
  | { kind: 'continue'; review: Review }
  /** Apply `flags` to task `id` now. `review` is the next step, or undefined when that was the last task. */
  | { kind: 'apply'; id: string; flags: Flags; review: Review | undefined }
  | { kind: 'cancel' }
  | { kind: 'ignore' };

/** Open tasks in quadrant order (Do, Schedule, Delegate, Delete), by `order` within each. */
export function reviewQueue(tasks: readonly Task[]): Task[] {
  return QUADRANTS.flatMap((q) =>
    tasks.filter((t) => !t.done && quadrantOf(t) === q.id).sort((a, b) => a.order - b.order),
  );
}

export function startReview(tasks: readonly Task[]): Review | undefined {
  const queue = reviewQueue(tasks).map((t) => t.id);
  return queue.length === 0 ? undefined : { queue, index: 0, triage: START };
}

/**
 * Re-points the review after the tasks changed under it (a click deleted or completed one).
 * Skips queued tasks that are gone or done, restarting the pair on the next open one.
 * Returns `review` itself when its current task is still open; undefined when none is left.
 */
export function settleReview(review: Review, tasks: readonly Task[]): Review | undefined {
  const open = new Set(tasks.filter((t) => !t.done).map((t) => t.id));
  let index = review.index;
  while (index < review.queue.length && !open.has(review.queue[index]!)) index++;
  if (index === review.index) return review;
  return index < review.queue.length ? { ...review, index, triage: START } : undefined;
}

export function reviewProgress(review: Review): string {
  return `${review.index + 1} of ${review.queue.length}`;
}

export function reviewKey(review: Review, key: string): ReviewOutcome {
  const outcome = triageKey(review.triage, key);
  if (outcome.kind === 'ignore' || outcome.kind === 'cancel') return outcome;
  if (outcome.kind === 'continue') return { kind: 'continue', review: { ...review, triage: outcome.state } };
  const next = review.index + 1;
  return {
    kind: 'apply',
    id: review.queue[review.index]!,
    flags: outcome.flags,
    review: next < review.queue.length ? { ...review, index: next, triage: START } : undefined,
  };
}
