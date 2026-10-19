import { describe, expect, it } from 'vitest';
import { daysSince, isDue, localToday, msUntilMidnight } from './dates';
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
  it('holds around midnight on the DST days of both pinned zones', () => {
    for (const [m, d] of [[3, 8], [11, 1], [4, 5], [9, 27]] as const) {
      const day = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      expect(localToday(local(2026, m, d, 0, 30))).toBe(day);
      expect(localToday(local(2026, m, d, 23, 30))).toBe(day);
      expect(localToday(local(2026, m, d, 23, 59, 59, 999))).toBe(day);
    }
  });
});

describe('msUntilMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msUntilMidnight(local(2026, 3, 1, 23, 30))).toBe(30 * 60 * 1000);
    expect(msUntilMidnight(local(2026, 3, 1, 0, 0, 0, 0))).toBeGreaterThanOrEqual(23 * 3600 * 1000);
  });

  // Every day of the year, so each pinned zone's own DST days (23 h and 25 h) are covered:
  // Los Angeles 8 Mar and 1 Nov 2026, Auckland 5 Apr and 27 Sep 2026.
  it('lands exactly on the next local midnight on every day, DST days included', () => {
    for (let d = 1; d <= 365; d++) {
      const next = local(2026, 1, d + 1); // the Date constructor rolls day 32 into February, etc.
      for (const [h, mi] of [[0, 0], [1, 30], [3, 30], [12, 0], [23, 30]] as const) {
        const now = local(2026, 1, d, h, mi);
        expect(new Date(now.getTime() + msUntilMidnight(now)), now.toString()).toEqual(next);
      }
    }
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

describe('daysSince (local calendar days)', () => {
  const now = local(2026, 10, 19, 0, 30);
  it.each<[string, Date, number]>([
    ['earlier the same day', local(2026, 10, 19, 0, 5), 0],
    ['23:59 yesterday, a minute ago', local(2026, 10, 18, 23, 59), 1],
    ['a week ago', local(2026, 10, 12, 23, 30), 7],
    ['eight days ago', local(2026, 10, 11, 9), 8],
    ['across a month boundary', local(2026, 9, 30, 12), 19],
    ['in the future (clock skew) counts as today', local(2026, 10, 21), 0],
  ])('%s', (_label, then, days) => {
    expect(daysSince(then.toISOString(), now)).toBe(days);
  });

  // A day that is 23 hours long (spring forward) or 25 (fall back) still counts as one day.
  it.each<[string, Date, Date, number]>([
    ['across US spring forward', local(2026, 3, 7, 12), local(2026, 3, 9, 0, 30), 2],
    ['across US fall back', local(2026, 10, 31, 23, 30), local(2026, 11, 1, 23, 45), 1],
    ['same day as US fall back', local(2026, 11, 1, 0, 15), local(2026, 11, 1, 23, 45), 0],
    ['across NZ spring forward', local(2026, 9, 26, 12), local(2026, 9, 28, 0, 30), 2],
    ['across NZ fall back', local(2026, 4, 4, 23, 30), local(2026, 4, 5, 23, 45), 1],
    ['same day as NZ fall back', local(2026, 4, 5, 0, 15), local(2026, 4, 5, 23, 45), 0],
  ])('DST: %s', (_label, then, now, days) => {
    expect(daysSince(then.toISOString(), now)).toBe(days);
  });
});
