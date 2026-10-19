import { describe, expect, it } from 'vitest';
import { isDue, localToday, msUntilMidnight } from './dates';
import type { Task } from './task';

// Dates are built from local components, so these pass in any time zone (CI runs two).
const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  new Date(y, mo - 1, d, h, mi, s, ms);

function task(over: Partial<Task>): Task {
  return {
    id: 't', title: 'T', urgent: false, important: true, done: false, order: 0,
    createdAt: '2026-03-01T12:00:00.000Z', updatedAt: '2026-03-01T12:00:00.000Z', ...over,
  };
}

describe('localToday', () => {
  it('is the local calendar day at 23:30 and at 00:30', () => {
    expect(localToday(local(2026, 3, 1, 23, 30))).toBe('2026-03-01');
    expect(localToday(local(2026, 3, 2, 0, 30))).toBe('2026-03-02');
  });
  it('zero-pads month and day, and crosses a year end', () => {
    expect(localToday(local(2026, 1, 5, 9))).toBe('2026-01-05');
    expect(localToday(local(2026, 12, 31, 23, 59))).toBe('2026-12-31');
    expect(localToday(local(2027, 1, 1, 0, 0))).toBe('2027-01-01');
  });
});

describe('msUntilMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilMidnight(local(2026, 3, 1, 23, 30))).toBe(30 * 60 * 1000);
    expect(msUntilMidnight(local(2026, 3, 1, 0, 0, 0, 0))).toBeGreaterThanOrEqual(23 * 3600 * 1000);
  });
});

describe('isDue', () => {
  const today = '2026-03-10';
  it('is true for an open Schedule task dated yesterday or today, false for tomorrow', () => {
    expect(isDue(task({ when: '2026-03-09' }), today)).toBe(true);
    expect(isDue(task({ when: '2026-03-10' }), today)).toBe(true);
    expect(isDue(task({ when: '2026-03-11' }), today)).toBe(false);
  });
  it('is false with no date', () => {
    expect(isDue(task({}), today)).toBe(false);
  });
  it('is false for a done task', () => {
    expect(isDue(task({ when: '2026-03-01', done: true }), today)).toBe(false);
  });
  it('is false outside Schedule, whatever the date', () => {
    for (const flags of [
      { urgent: true, important: true },
      { urgent: true, important: false },
      { urgent: false, important: false },
    ]) {
      expect(isDue(task({ ...flags, when: '2026-03-01' }), today)).toBe(false);
    }
  });
});
