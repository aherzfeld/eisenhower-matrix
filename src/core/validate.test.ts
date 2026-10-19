import { describe, it, expect } from 'vitest';
import {
  validateId,
  validateOrder,
  validateTask,
  validateTimestamp,
  validateTitle,
  validateWhen,
  validateWho,
} from './validate';

const ok = (value: unknown) => ({ ok: true, value });

describe('validateTitle', () => {
  it('rejects empty', () => expect(validateTitle('').ok).toBe(false));
  it('rejects whitespace-only', () => expect(validateTitle('   \t ').ok).toBe(false));
  it('accepts 200 chars after trim', () => {
    expect(validateTitle(' ' + 'a'.repeat(200) + ' ')).toEqual(ok('a'.repeat(200)));
  });
  it('rejects 201 chars after trim', () => expect(validateTitle('a'.repeat(201)).ok).toBe(false));
  it('trims', () => expect(validateTitle('  hi ')).toEqual(ok('hi')));
  it('rejects non-strings', () => expect(validateTitle(5).ok).toBe(false));
});

describe('validateWho', () => {
  it('empty or whitespace means field removed, not an error', () => {
    expect(validateWho('')).toEqual(ok(undefined));
    expect(validateWho('  ')).toEqual(ok(undefined));
    expect(validateWho(undefined)).toEqual(ok(undefined));
  });
  it('accepts 80', () => expect(validateWho('a'.repeat(80))).toEqual(ok('a'.repeat(80))));
  it('rejects 81', () => expect(validateWho('a'.repeat(81)).ok).toBe(false));
  it('trims', () => expect(validateWho(' Sam ')).toEqual(ok('Sam')));
  it('rejects non-strings', () => expect(validateWho(3).ok).toBe(false));
});

describe('validateWhen', () => {
  it('accepts real dates', () => {
    expect(validateWhen('2026-10-19')).toEqual(ok('2026-10-19'));
    expect(validateWhen('2024-02-29')).toEqual(ok('2024-02-29'));
    expect(validateWhen('2028-02-29')).toEqual(ok('2028-02-29'));
  });
  it('accepts years below 100, which a native date input can produce', () => {
    expect(validateWhen('0001-01-01')).toEqual(ok('0001-01-01'));
    expect(validateWhen('0050-06-15')).toEqual(ok('0050-06-15'));
  });
  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-1', '26-10-19', '2026-10-19T00:00:00Z', '', 'x'])(
    'rejects %s',
    (s) => expect(validateWhen(s).ok).toBe(false),
  );
  it('rejects non-strings', () => expect(validateWhen(20261019).ok).toBe(false));
});

describe('validateOrder', () => {
  it('accepts non-negative integers', () => {
    expect(validateOrder(0)).toEqual(ok(0));
    expect(validateOrder(7)).toEqual(ok(7));
  });
  it.each([-1, 1.5, NaN, Infinity, '1', null])('rejects %s', (n) => {
    expect(validateOrder(n).ok).toBe(false);
  });
});

describe('validateId', () => {
  it('accepts non-empty strings', () => expect(validateId('a')).toEqual(ok('a')));
  it.each(['', 1, null])('rejects %s', (v) => expect(validateId(v).ok).toBe(false));
});

describe('validateTimestamp', () => {
  it('accepts ISO timestamps', () => {
    expect(validateTimestamp('2026-10-19T12:00:00.000Z').ok).toBe(true);
  });
  it.each(['yesterday', '', '2026-13-45T00:00:00Z', 5])('rejects %s', (v) => {
    expect(validateTimestamp(v).ok).toBe(false);
  });
});

describe('validateTask', () => {
  const base = {
    id: 'a',
    title: 'Write',
    urgent: true,
    important: false,
    done: false,
    order: 0,
    createdAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
  };
  it('accepts a minimal task', () => expect(validateTask(base)).toStrictEqual(ok(base)));
  it('accepts when and who', () => {
    const t = { ...base, when: '2026-10-20', who: 'Sam' };
    expect(validateTask(t)).toEqual(ok(t));
  });
  it('drops an empty who, removing the key', () => {
    expect(validateTask({ ...base, who: '' })).toStrictEqual(ok(base));
  });
  it('rejects non-objects', () => {
    expect(validateTask(null).ok).toBe(false);
    expect(validateTask([]).ok).toBe(false);
    expect(validateTask('x').ok).toBe(false);
  });
  it.each([
    ['id', ''],
    ['title', '  '],
    ['urgent', 'yes'],
    ['important', 1],
    ['done', undefined],
    ['order', -1],
    ['createdAt', 'nope'],
    ['updatedAt', undefined],
    ['when', '2026-02-30'],
  ])('rejects bad %s', (key, value) => {
    expect(validateTask({ ...base, [key]: value }).ok).toBe(false);
  });
});
