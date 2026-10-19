import { describe, it, expect } from 'vitest';
import { QUADRANTS, flagsFor, quadrantOf, type Quadrant } from './quadrant';

describe('quadrantOf', () => {
  it.each([
    [true, true, 'do'],
    [false, true, 'schedule'],
    [true, false, 'delegate'],
    [false, false, 'delete'],
  ] as const)('urgent=%s important=%s -> %s', (urgent, important, q) => {
    expect(quadrantOf({ urgent, important })).toBe(q);
  });
});

describe('flagsFor', () => {
  it('round-trips for every quadrant', () => {
    for (const { id } of QUADRANTS) {
      expect(quadrantOf(flagsFor(id))).toBe(id);
    }
  });
  it('round-trips for every flag combination', () => {
    for (const urgent of [true, false]) {
      for (const important of [true, false]) {
        expect(flagsFor(quadrantOf({ urgent, important }))).toEqual({ urgent, important });
      }
    }
  });
});

describe('QUADRANTS', () => {
  it('is ordered Do, Schedule, Delegate, Delete with keys 1-4', () => {
    expect(QUADRANTS.map((q) => [q.id, q.label, q.key])).toEqual([
      ['do', 'Do', '1'],
      ['schedule', 'Schedule', '2'],
      ['delegate', 'Delegate', '3'],
      ['delete', 'Delete', '4'],
    ] satisfies [Quadrant, string, string][]);
  });
});
