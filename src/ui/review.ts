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
