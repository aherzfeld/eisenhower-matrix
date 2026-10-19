/**
 * A realistic board for screenshots and visual checks: ten tasks across the four quadrants,
 * with one done, one Due, one Waiting on and one Next. Built with the codec's serialize, so it
 * is exactly what the app itself would have saved.
 */
import { serialize } from '../../src/core/codec';
import type { Task } from '../../src/core/task';

export const MAIN_KEY = 'eisenhower:v1';

const pad = (n: number) => String(n).padStart(2, '0');
/** A local calendar date `days` from now, as the app stores `when`. */
function localDate(days: number, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function seededBoard(now = new Date()): string {
  const at = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  let n = 0;
  const task = (
    title: string,
    urgent: boolean,
    important: boolean,
    order: number,
    extra: Partial<Task> = {},
  ): Task => ({
    id: `seed-${++n}`,
    title,
    urgent,
    important,
    done: false,
    order,
    createdAt: at,
    updatedAt: at,
    ...extra,
  });

  const tasks: Task[] = [
    task('Send the board pack to Priya', true, true, 0),
    task('Fix the failing payroll export', true, true, 1),
    task('Call the landlord about the leak', true, true, 2, { done: true }),
    task('Draft the Q1 hiring plan', false, true, 0, { when: localDate(-1, now) }),
    task('Book the team offsite venue', false, true, 1, { when: localDate(12, now) }),
    task('Read Thinking in Systems', false, true, 2),
    task('Collect receipts for the expense report', true, false, 0, { who: 'Sam' }),
    task('Reply to the vendor survey', true, false, 1),
    task('Reorganise the bookmarks bar', false, false, 0),
    task('Watch the conference livestream', false, false, 1),
  ];
  const lastExportAt = new Date(now.getTime() - 9 * 86_400_000).toISOString();
  return serialize({ version: 1, rev: 1, lastExportAt, tasks });
}
