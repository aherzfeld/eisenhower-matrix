import { describe, expect, it } from 'vitest';
import { START, squareClasses, triageKey } from './capture';

describe('triageKey', () => {
  it('asks Important first, then Urgent, and lands on all four combinations', () => {
    const cases: [string, string, boolean, boolean][] = [
      ['y', 'y', true, true],
      ['y', 'n', false, true],
      ['n', 'y', true, false],
      ['n', 'n', false, false],
    ];
    for (const [imp, urg, urgent, important] of cases) {
      const a = triageKey(START, imp);
      expect(a.kind).toBe('continue');
      if (a.kind !== 'continue') return;
      expect(triageKey(a.state, urg)).toEqual({ kind: 'done', flags: { urgent, important } });
    }
  });

  it('accepts upper case', () => {
    expect(triageKey(START, 'Y').kind).toBe('continue');
    expect(triageKey(START, 'N').kind).toBe('continue');
  });

  it('ignores every other key: no default answer', () => {
    for (const key of ['Enter', ' ', 'x', '1', 'ArrowUp', 'Tab', 'yy', '']) {
      expect(triageKey(START, key)).toEqual({ kind: 'ignore' });
      expect(triageKey({ step: 'urgent', important: true }, key)).toEqual({ kind: 'ignore' });
    }
  });

  it('cancels with Escape at either step', () => {
    expect(triageKey(START, 'Escape')).toEqual({ kind: 'cancel' });
    expect(triageKey({ step: 'urgent', important: false }, 'Escape')).toEqual({ kind: 'cancel' });
  });
});

describe('squareClasses', () => {
  it('lights nothing before any answer', () => {
    expect(squareClasses({})).toEqual({ do: '', schedule: '', delegate: '', delete: '' });
  });
  it('lights the row after Important', () => {
    expect(squareClasses({ important: true })).toEqual({
      do: 'is-row',
      schedule: 'is-row',
      delegate: '',
      delete: '',
    });
    expect(squareClasses({ important: false }).delete).toBe('is-row');
  });
  it('lights the column and the target after Urgent', () => {
    const c = squareClasses({ important: true, urgent: false });
    expect(c.schedule).toBe('is-row is-col is-target');
    expect(c.do).toBe('is-row');
    expect(c.delete).toBe('is-col');
    expect(c.delegate).toBe('');
  });
});
