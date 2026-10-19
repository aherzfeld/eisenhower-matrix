import { describe, expect, it } from 'vitest';
import type { Task } from '../core/task';
import { reviewKey, reviewProgress, reviewQueue, settleReview, startReview, type Review } from './review';

const NOW = '2026-03-01T12:00:00.000Z';
function task(id: string, urgent: boolean, important: boolean, order = 0, done = false): Task {
  return { id, title: id, urgent, important, done, order, createdAt: NOW, updatedAt: NOW };
}

describe('reviewQueue', () => {
  it('lists open tasks in quadrant order, by order within each, skipping done', () => {
    const tasks = [
      task('del', false, false),
      task('dg', true, false),
      task('s', false, true),
      task('d2', true, true, 1),
      task('d1', true, true, 0),
      task('dd', true, true, 2, true),
    ];
    expect(reviewQueue(tasks).map((t) => t.id)).toEqual(['d1', 'd2', 's', 'dg', 'del']);
  });
});

describe('startReview', () => {
  it('is undefined with no open tasks', () => {
    expect(startReview([])).toBeUndefined();
    expect(startReview([task('a', true, true, 0, true)])).toBeUndefined();
  });
  it('starts at the first task, asking Important', () => {
    const r = startReview([task('a', true, true)])!;
    expect(r.queue).toEqual(['a']);
    expect(r.index).toBe(0);
    expect(r.triage).toEqual({ step: 'important' });
    expect(reviewProgress(r)).toBe('1 of 1');
  });
});

describe('reviewKey', () => {
  const start = () => startReview([task('a', true, true), task('b', false, false), task('c', true, false)])!;

  it('ignores every key but y/n/Escape', () => {
    for (const k of ['Enter', ' ', 'x', '1', 'r']) expect(reviewKey(start(), k)).toEqual({ kind: 'ignore' });
  });

  it('asks Important then Urgent, then applies that task and moves on', () => {
    const first = reviewKey(start(), 'n');
    expect(first.kind).toBe('continue');
    if (first.kind !== 'continue') return;
    expect(first.review.index).toBe(0);
    expect(first.review.triage).toEqual({ step: 'urgent', important: false });
    const second = reviewKey(first.review, 'y');
    expect(second.kind).toBe('apply');
    if (second.kind !== 'apply') return;
    expect(second.id).toBe('a');
    expect(second.flags).toEqual({ important: false, urgent: true });
    expect(second.review?.index).toBe(1);
    expect(second.review?.triage).toEqual({ step: 'important' });
    expect(reviewProgress(second.review!)).toBe('2 of 3');
  });

  it('finishes (review undefined) after the last task', () => {
    let r: Review | undefined = start();
    const applied: string[] = [];
    for (let i = 0; i < 6 && r; i++) {
      const o = reviewKey(r, 'y');
      if (o.kind === 'continue') r = o.review;
      else if (o.kind === 'apply') {
        applied.push(o.id);
        r = o.review;
      }
    }
    expect(applied).toEqual(['a', 'c', 'b']); // Do, Delegate, Delete
    expect(r).toBeUndefined();
  });

  it('cancels on Escape', () => {
    expect(reviewKey(start(), 'Escape')).toEqual({ kind: 'cancel' });
  });
});

describe('settleReview', () => {
  const tasks = [task('a', true, true), task('b', false, true), task('c', false, false)];
  const at = (index: number, triage: Review['triage'] = { step: 'important' }): Review => ({
    queue: ['a', 'b', 'c'], index, triage,
  });

  it('leaves the review alone while its current task is still open', () => {
    const r = at(0, { step: 'urgent', important: true });
    expect(settleReview(r, tasks)).toBe(r);
    expect(settleReview(r, tasks.filter((t) => t.id !== 'b'))).toBe(r); // a later gap waits its turn
  });

  it('skips past deleted and done tasks, and restarts the pair on the next one', () => {
    const r = at(0, { step: 'urgent', important: false });
    const next = settleReview(r, [task('b', false, true, 0, true), task('c', false, false)]);
    expect(next).toEqual({ queue: ['a', 'b', 'c'], index: 2, triage: { step: 'important' } });
  });

  it('is undefined once nothing open is left in the queue', () => {
    expect(settleReview(at(1), [task('a', true, true)])).toBeUndefined();
  });
});
