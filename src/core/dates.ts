/** Local calendar dates. Pure: the clock is passed in. Never uses toISOString (that is UTC). */
import { quadrantOf } from './quadrant';
import type { Task } from './task';

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The local calendar day of `now`, as 'YYYY-MM-DD'. */
export function localToday(now: Date): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Milliseconds from `now` to the next local midnight (DST-safe: built from local components). */
export function msUntilMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** An open Schedule task whose date is today or earlier. ISO dates compare correctly as strings. */
export function isDue(task: Task, today: string): boolean {
  return !task.done && quadrantOf(task) === 'schedule' && task.when !== undefined && task.when <= today;
}
