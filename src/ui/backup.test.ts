import { describe, expect, it } from 'vitest';
import { backupReminder } from './backup';

// Built from local components, so these pass in either pinned time zone.
const local = (y: number, mo: number, d: number, h = 12) => new Date(y, mo - 1, d, h);
const NOW = local(2026, 10, 19, 9);
const exportedDaysAgo = (n: number) => local(2026, 10, 19 - n, 18).toISOString();

describe('backupReminder', () => {
  it('never backed up: says so, as a warning', () => {
    expect(backupReminder(undefined, NOW)).toEqual({ text: 'Never backed up', warn: true });
  });

  it.each<[number, string, boolean]>([
    [0, 'Last backup today', false],
    [1, 'Last backup 1 day ago', false],
    [7, 'Last backup 7 days ago', false],
    [8, 'Last backup 8 days ago', true],
  ])('%i days ago', (days, text, warn) => {
    expect(backupReminder(exportedDaysAgo(days), NOW)).toEqual({ text, warn });
  });
});
