/** AC9, AC10, AC11, plus Cmd/Ctrl+Z undo and the placement announcement. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, emptyState } from '../core/ports';
import type { Task } from '../core/task';
import { createApp, type App } from './app';

// Built from local components so "today" is 2026-03-10 in any time zone.
let clock = new Date(2026, 2, 10, 12, 0, 0);
const NOW = '2026-03-01T12:00:00.000Z';

function task(id: string, title: string, urgent: boolean, important: boolean, over: Partial<Task> = {}): Task {
  return { id, title, urgent, important, done: false, order: 0, createdAt: NOW, updatedAt: NOW, ...over };
}

let root: HTMLElement;
let app: App | undefined;
let n = 0;

function boot(tasks: Task[] = []) {
  app?.destroy(); // a leaked app would keep its document listeners
  const storage = createMemoryStorage({ initial: { ...emptyState(), tasks } });
  app = createApp({ root, storage, now: () => clock.toISOString(), newId: () => `id-${++n}` });
  return { app, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = new Date(2026, 2, 10, 12, 0, 0);
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  n = 0;
});
afterEach(() => {
  app?.destroy();
  app = undefined;
  vi.useRealTimers();
});

const q = (name: string) => root.querySelector<HTMLElement>(`.q--${name}`)!;
const row = (id: string) => root.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;
const titles = (name: string) => [...q(name).querySelectorAll('.task__title')].map((e) => e.textContent);
const input = () => root.querySelector<HTMLInputElement>('.capture__input')!;
const prompt = () => root.querySelector<HTMLElement>('.prompt')!;
const toast = () => root.querySelector<HTMLElement>('.toast-slot')!;
const message = () => root.querySelector<HTMLElement>('.capture__message')!;
const taskIn = (id: string) => app!.getState().tasks.find((t) => t.id === id)!;

function key(target: Element | Document, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

function setField(el: HTMLInputElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Schedule rows: date and Due (AC9)', () => {
  it('shows a native date input only on Schedule rows, bound to when', () => {
    boot([task('s', 'Pay rent', false, true), task('d', 'Fire', true, true)]);
    const date = row('s').querySelector<HTMLInputElement>('input.task__when')!;
    expect(date.type).toBe('date');
    expect(date.getAttribute('aria-label')).toBe('Date for Pay rent');
    expect(row('d').querySelector('.task__when')).toBeNull();

    setField(date, '2026-03-20');
    expect(taskIn('s').when).toBe('2026-03-20');
    setField(row('s').querySelector<HTMLInputElement>('.task__when')!, '');
    expect(taskIn('s').when).toBeUndefined();
  });

  it('does not rebuild the field while it is being edited', () => {
    boot([task('s', 'Pay rent', false, true)]);
    const date = row('s').querySelector<HTMLInputElement>('.task__when')!;
    date.focus();
    setField(date, '2026-03-20');
    expect(row('s').querySelector('.task__when')).toBe(date);
    expect(document.activeElement).toBe(date);
  });

  it('flags yesterday and today as DUE, not tomorrow', () => {
    boot([
      task('y', 'Yesterday', false, true, { when: '2026-03-09', order: 0 }),
      task('t', 'Today', false, true, { when: '2026-03-10', order: 1 }),
      task('m', 'Tomorrow', false, true, { when: '2026-03-11', order: 2 }),
      task('n', 'No date', false, true, { order: 3 }),
    ]);
    expect(row('y').querySelector('.stamp--due')).not.toBeNull();
    expect(row('t').querySelector('.stamp--due')).not.toBeNull();
    expect(row('m').querySelector('.stamp--due')).toBeNull();
    expect(row('n').querySelector('.stamp--due')).toBeNull();
    expect(row('y').querySelector('.stamp--due')!.textContent).toBe('Due');
  });

  it('flags only Schedule tasks, and not done ones', () => {
    boot([
      task('do', 'Do it', true, true, { when: '2026-03-01' }),
      task('dg', 'Hand off', true, false, { when: '2026-03-01' }),
      task('sd', 'Done one', false, true, { when: '2026-03-01', done: true }),
    ]);
    expect(root.querySelectorAll('.stamp--due')).toHaveLength(0);
    expect(root.querySelectorAll('.task__promote')).toHaveLength(0);
  });

  it('pressing 1 on a due row moves it to Do', () => {
    boot([task('y', 'Yesterday', false, true, { when: '2026-03-09' })]);
    row('y').focus();
    key(row('y'), '1');
    expect(titles('do')).toEqual(['Yesterday']);
    expect(titles('schedule')).toEqual([]);
    expect(root.querySelector('.stamp--due')).toBeNull();
  });

  it('the Move to Do button does the same', () => {
    boot([task('y', 'Yesterday', false, true, { when: '2026-03-09' })]);
    const button = row('y').querySelector<HTMLButtonElement>('.task__promote')!;
    expect(button.textContent).toBe('Move to Do');
    button.click();
    expect(titles('do')).toEqual(['Yesterday']);
  });

  it('setting a past date flags the row at once, and a future date unflags it', () => {
    boot([task('s', 'Pay rent', false, true)]);
    setField(row('s').querySelector<HTMLInputElement>('.task__when')!, '2026-03-01');
    expect(row('s').querySelector('.stamp--due')).not.toBeNull();
    expect(row('s').querySelector('.task__promote')).not.toBeNull();
    setField(row('s').querySelector<HTMLInputElement>('.task__when')!, '2026-04-01');
    expect(row('s').querySelector('.stamp--due')).toBeNull();
    expect(row('s').querySelector('.task__promote')).toBeNull();
  });

  it('Alt+ArrowUp still reorders a row that has a date', () => {
    boot([
      task('a', 'A', false, true, { order: 0, when: '2026-04-01' }),
      task('b', 'B', false, true, { order: 1, when: '2026-04-02' }),
    ]);
    row('b').focus();
    key(row('b'), 'ArrowUp', { altKey: true });
    expect(titles('schedule')).toEqual(['B', 'A']);
  });
});

describe('due rechecks', () => {
  const dueTask = () => task('s', 'Tomorrow', false, true, { when: '2026-03-11' });

  it('recomputes on the local-midnight timer, and re-arms it', () => {
    boot([dueTask()]);
    expect(root.querySelector('.stamp--due')).toBeNull();
    clock = new Date(2026, 2, 11, 0, 0, 0, 0);
    vi.advanceTimersByTime(12 * 3600 * 1000);
    expect(root.querySelector('.stamp--due')).not.toBeNull();

    // Re-armed: the next midnight flags a task dated the day after.
    app!.commit((tasks) => ({ ok: true, value: tasks.map((t) => ({ ...t, when: '2026-03-12' })) }));
    expect(root.querySelector('.stamp--due')).toBeNull();
    clock = new Date(2026, 2, 12, 0, 0, 0, 0);
    vi.advanceTimersByTime(24 * 3600 * 1000);
    expect(root.querySelector('.stamp--due')).not.toBeNull();
  });

  it('recomputes when the page becomes visible', () => {
    boot([dueTask()]);
    clock = new Date(2026, 2, 11, 9, 0, 0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(root.querySelector('.stamp--due')).not.toBeNull();
  });

  it('does not rebuild a field the user is typing in', () => {
    boot([dueTask()]);
    const date = row('s').querySelector<HTMLInputElement>('.task__when')!;
    date.focus();
    clock = new Date(2026, 2, 11, 0, 0, 0, 0);
    vi.advanceTimersByTime(12 * 3600 * 1000);
    expect(row('s').querySelector('.task__when')).toBe(date);
    date.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(row('s').querySelector('.stamp--due')).not.toBeNull();
  });

  describe('focus after a deferred render (#12)', () => {
    /** Focus leaves the field for `next`, as Tab or a click would: focusout first, then focus. */
    function moveFocus(from: HTMLElement, next: HTMLElement) {
      key(from, 'Tab');
      next.focus();
    }

    it('lands on the control in the same row that focus moved to, not on body', () => {
      boot([dueTask()]);
      const date = row('s').querySelector<HTMLInputElement>('.task__when')!;
      date.focus();
      clock = new Date(2026, 2, 11, 0, 0, 0, 0);
      vi.advanceTimersByTime(12 * 3600 * 1000);
      expect(row('s').querySelector('.task__when')).toBe(date); // deferred while typing
      const rename = row('s').querySelector<HTMLElement>('.task__rename')!;
      moveFocus(date, rename);
      expect(row('s').querySelector('.stamp--due')).not.toBeNull(); // the render ran
      expect(rename.isConnected).toBe(false); // and rebuilt the row
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(row('s').querySelector('.task__rename'));
    });

    it('lands on the same control in another row', () => {
      boot([dueTask(), task('o', 'Other', true, true)]);
      const date = row('s').querySelector<HTMLInputElement>('.task__when')!;
      date.focus();
      clock = new Date(2026, 2, 11, 0, 0, 0, 0);
      vi.advanceTimersByTime(12 * 3600 * 1000);
      moveFocus(date, row('o').querySelector<HTMLElement>('.task__delete')!);
      expect(document.activeElement).toBe(row('o').querySelector('.task__delete'));
    });

    it('falls back to the row when the control is gone after the render', () => {
      const { storage } = boot([task('s', 'Today', false, true, { when: '2026-03-10' })]);
      const date = row('s').querySelector<HTMLInputElement>('.task__when')!;
      date.focus();
      const state = app!.getState();
      storage.simulateExternalChange({
        ...state,
        tasks: state.tasks.map((t) => ({ ...t, when: '2026-03-20' })),
      });
      const promote = row('s').querySelector<HTMLElement>('.task__promote')!; // still Due on screen
      moveFocus(date, promote);
      expect(row('s').querySelector('.task__promote')).toBeNull();
      expect(document.activeElement).toBe(row('s'));
    });

    it('falls back to the capture input when the row is gone', () => {
      const { storage } = boot([dueTask()]);
      row('s').querySelector<HTMLInputElement>('.task__when')!.focus();
      storage.simulateExternalChange({ ...app!.getState(), tasks: [] });
      expect(root.querySelector('.task')).toBeNull();
      expect(document.activeElement).toBe(input());
    });
  });

  it('fires once at each local midnight for a whole year, DST days included, with one timer armed', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12, 0, 0));
    const fired: Date[] = [];
    const timers = {
      setTimeout: (fn: () => void, ms: number) => setTimeout(() => { fired.push(new Date()); fn(); }, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    const storage = createMemoryStorage({ initial: { ...emptyState(), tasks: [dueTask()] } });
    app = createApp({ root, storage, now: () => new Date().toISOString(), newId: () => 'x', timers });
    for (let day = 1; day <= 365; day++) {
      vi.advanceTimersByTime(24 * 3600 * 1000);
      expect(vi.getTimerCount()).toBe(1);
    }
    expect(fired).toHaveLength(365);
    fired.forEach((at, i) => expect(at, `firing ${i}`).toEqual(new Date(2026, 0, 2 + i)));
    // Rendered on the day it fell due: the task is dated 2026-03-11.
    expect(root.querySelector('.stamp--due')).not.toBeNull();
  });

  it('stops the timer on destroy', () => {
    boot([dueTask()]);
    app!.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Delegate and Do follow-through (AC10)', () => {
  it('shows "Waiting on Sam" once who is set, and nothing when empty', () => {
    boot([task('g', 'Send quote', true, false)]);
    const who = row('g').querySelector<HTMLInputElement>('input.task__who')!;
    expect(who.placeholder).toBe('Who?');
    expect(row('g').querySelector('.stamp--waiting')).toBeNull();
    setField(who, 'Sam');
    expect(taskIn('g').who).toBe('Sam');
    expect(row('g').querySelector('.stamp--waiting')!.textContent).toBe('Waiting on Sam');
    setField(row('g').querySelector<HTMLInputElement>('.task__who')!, '   ');
    expect(taskIn('g').who).toBeUndefined();
    expect(row('g').querySelector('.stamp--waiting')).toBeNull();
  });

  it('renders a stored who, and no who field outside Delegate', () => {
    boot([task('g', 'Send quote', true, false, { who: 'Sam' }), task('d', 'Fire', true, true)]);
    expect(row('g').querySelector('.stamp--waiting')!.textContent).toBe('Waiting on Sam');
    expect(row('d').querySelector('.task__who')).toBeNull();
  });

  /** The error beside a row's date or Who? field (#14). */
  const fieldError = (id: string) => row(id).querySelector<HTMLElement>('.task__field-error')!;
  const WHO_TOO_LONG = 'Who must be at most 80 characters.';

  // Changed for #14: these asserted the error in .capture__message; it now sits beside the field.
  it('rejects an over-long who without losing the old value, and says why beside the field', () => {
    boot([task('g', 'Send quote', true, false, { who: 'Sam' })]);
    const who = row('g').querySelector<HTMLInputElement>('.task__who')!;
    setField(who, 'x'.repeat(81));
    expect(taskIn('g').who).toBe('Sam');
    expect(who.value).toBe('Sam'); // the field shows what was saved, not the rejected text
    const error = fieldError('g');
    expect(error.textContent).toBe(WHO_TOO_LONG);
    expect(error.getAttribute('role')).toBe('alert'); // announced
    expect(error.id).not.toBe('');
    expect(who.getAttribute('aria-describedby')?.split(' ')).toContain(error.id);
    expect(message().textContent).toBe('');
    expect(row('g').querySelector('.stamp--waiting')!.textContent).toBe('Waiting on Sam');
  });

  it('clears that error once the field saves', () => {
    boot([task('g', 'Send quote', true, false, { who: 'Sam' })]);
    const who = row('g').querySelector<HTMLInputElement>('.task__who')!;
    setField(who, 'x'.repeat(81));
    setField(who, 'Ana');
    expect(taskIn('g').who).toBe('Ana');
    expect(fieldError('g').textContent).toBe('');
    expect(message().textContent).toBe('');
  });

  it('clears that error when the field is put back to its saved value', () => {
    boot([task('g', 'Send quote', true, false, { who: 'Sam' })]);
    const who = row('g').querySelector<HTMLInputElement>('.task__who')!;
    setField(who, 'x'.repeat(81));
    setField(who, 'Sam');
    expect(fieldError('g').textContent).toBe('');
  });

  it('keeps the error beside its own field through a re-render, and off the others', () => {
    boot([task('g', 'Send quote', true, false, { who: 'Sam' }), task('h', 'Book room', true, false, { order: 1 })]);
    setField(row('g').querySelector<HTMLInputElement>('.task__who')!, 'x'.repeat(81));
    app!.render();
    expect(fieldError('g').textContent).toBe(WHO_TOO_LONG);
    expect(fieldError('h').textContent).toBe('');
    expect(message().textContent).toBe('');
  });

  it('gives every date and Who? field its own error element, and none to other rows', () => {
    boot([task('g', 'Send quote', true, false), task('s', 'Pay rent', false, true), task('d', 'Fire', true, true)]);
    const ids = [fieldError('g').id, fieldError('s').id];
    expect(new Set(ids).size).toBe(2);
    expect(row('s').querySelector('.task__when')!.getAttribute('aria-describedby')).toBe(ids[1]);
    expect(row('d').querySelector('.task__field-error')).toBeNull();
  });

  it('shows the trimmed who in the field, and an empty field for whitespace', () => {
    boot([task('g', 'Send quote', true, false)]);
    const who = row('g').querySelector<HTMLInputElement>('.task__who')!;
    setField(who, '  Sam  ');
    expect(who.value).toBe('Sam');
    setField(who, '   ');
    expect(who.value).toBe('');
  });

  it('keeps a stored who quiet once the task leaves Delegate', () => {
    boot([task('g', 'Send quote', true, true, { who: 'Sam' })]);
    expect(root.querySelector('.stamp--waiting')).toBeNull();
  });

  it('marks the top open Do task as Next', () => {
    boot([task('a', 'A', true, true, { order: 0 }), task('b', 'B', true, true, { order: 1 })]);
    expect(row('a').querySelector('.stamp--next')!.textContent).toBe('Next');
    expect(row('b').querySelector('.stamp--next')).toBeNull();
  });

  it('skips a done top item, and never marks a done task', () => {
    boot([task('a', 'A', true, true, { order: 0, done: true }), task('b', 'B', true, true, { order: 1 })]);
    expect(row('a').querySelector('.stamp--next')).toBeNull();
    expect(row('b').querySelector('.stamp--next')).not.toBeNull();
    boot([task('c', 'C', true, true, { done: true })]);
    expect(root.querySelector('.stamp--next')).toBeNull();
  });

  it('moves Next after a reorder, a done toggle, a removal and its undo', () => {
    boot([task('a', 'A', true, true, { order: 0 }), task('b', 'B', true, true, { order: 1 })]);
    const nextId = () => root.querySelector('.stamp--next')?.closest<HTMLElement>('.task')?.dataset.taskId;
    row('b').focus();
    key(row('b'), 'ArrowUp', { altKey: true });
    expect(nextId()).toBe('b');
    row('b').focus();
    key(row('b'), ' ');
    expect(nextId()).toBe('a');
    app!.deleteTask('a');
    expect(nextId()).toBeUndefined(); // only the done task is left
    app!.undo();
    expect(nextId()).toBe('a');
    expect(root.querySelectorAll('.stamp--next')).toHaveLength(1);
  });

  it('does not put Next on other quadrants', () => {
    boot([task('s', 'S', false, true), task('g', 'G', true, false)]);
    expect(root.querySelector('.stamp--next')).toBeNull();
  });
});

describe('review mode (AC11)', () => {
  const three = () => [
    task('a', 'Alpha', true, true),
    task('b', 'Beta', false, true),
    task('c', 'Gamma', false, false),
  ];

  it('r starts review: shows title and progress, and re-asks both questions for every task', () => {
    boot(three());
    key(document.body, 'r');
    expect(prompt().dataset.active).toBe('true');
    expect(prompt().textContent).toContain('Alpha');
    expect(prompt().textContent).toContain('1 of 3');
    expect(prompt().querySelector('.prompt__question')!.textContent).toBe('Important?');

    key(document.body, 'n'); // Alpha: not important
    expect(prompt().querySelector('.prompt__question')!.textContent).toBe('Urgent?');
    expect(prompt().textContent).toContain('1 of 3');
    key(document.body, 'n'); // not urgent -> Delete
    expect(titles('delete')).toContain('Alpha');
    expect(prompt().textContent).toContain('Beta');
    expect(prompt().textContent).toContain('2 of 3');

    key(document.body, 'y');
    key(document.body, 'y'); // Beta -> Do
    key(document.body, 'y');
    key(document.body, 'n'); // Gamma -> Schedule
    expect(titles('do')).toEqual(['Beta']);
    expect(titles('schedule')).toEqual(['Gamma']);
    expect(titles('delete')).toEqual(['Alpha']);
    expect(prompt().dataset.active).toBe('false');
  });

  it('Esc mid-review keeps the answers already given', () => {
    boot(three());
    key(document.body, 'r');
    key(document.body, 'n');
    key(document.body, 'n'); // Alpha -> Delete
    key(document.body, 'y'); // Beta, Important only
    key(document.body, 'Escape');
    expect(prompt().dataset.active).toBe('false');
    expect(titles('delete')).toContain('Alpha');
    expect(titles('schedule')).toEqual(['Beta']); // untouched: its pair was incomplete
    expect(titles('delete')).toContain('Gamma');
  });

  it('ignores other keys during review, so there is no default answer', () => {
    boot(three());
    key(document.body, 'r');
    for (const k of ['Enter', ' ', 'x', '1']) key(document.body, k);
    expect(prompt().querySelector('.prompt__question')!.textContent).toBe('Important?');
    expect(titles('do')).toEqual(['Alpha']);
  });

  it('with no open tasks, announces "Nothing to review"', () => {
    boot([task('a', 'Done', true, true, { done: true })]);
    key(document.body, 'r');
    expect(toast().textContent).toContain('Nothing to review');
    expect(prompt().dataset.active).toBe('false');
  });

  it('skips done tasks', () => {
    boot([task('a', 'Alpha', true, true), task('b', 'Beta', true, true, { done: true, order: 1 })]);
    key(document.body, 'r');
    expect(prompt().textContent).toContain('1 of 1');
  });

  it('is ignored while typing in the capture input', () => {
    boot(three());
    input().focus();
    key(input(), 'r');
    expect(prompt().dataset.active).toBe('false');
  });

  it('blocks Delete, Backspace and Cmd/Ctrl+Z while it runs', () => {
    boot(three());
    app!.deleteTask('c');
    row('a').focus();
    key(document.body, 'r');
    key(row('a'), 'Delete');
    key(row('a'), 'Backspace');
    const z = key(document.body, 'z', { metaKey: true });
    key(document.body, 'z', { ctrlKey: true });
    expect(z.defaultPrevented).toBe(false);
    expect(app!.getState().tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(prompt().textContent).toContain('Alpha');
  });

  it('returns focus to the row it started from, or to the capture input', () => {
    boot(three());
    row('b').focus();
    key(row('b'), 'r');
    key(document.body, 'Escape');
    expect(document.activeElement).toBe(row('b'));
    (document.activeElement as HTMLElement).blur();
    key(document.body, 'r');
    key(document.body, 'Escape');
    expect(document.activeElement).toBe(input());
  });

  it('skips a queued task that was deleted mid-review', () => {
    boot(three());
    key(document.body, 'r');
    row('b').querySelector<HTMLButtonElement>('.task__delete')!.click();
    key(document.body, 'y');
    key(document.body, 'y'); // Alpha stays in Do
    expect(prompt().textContent).toContain('Gamma');
    expect(prompt().textContent).toContain('3 of 3');
  });

  it('moves on when the task being asked about is deleted or marked done mid-pair', () => {
    boot(three());
    key(document.body, 'r');
    key(document.body, 'n'); // Alpha: answered Important only
    row('a').querySelector<HTMLButtonElement>('.task__delete')!.click();
    expect(prompt().textContent).toContain('Beta');
    expect(prompt().querySelector('.prompt__question')!.textContent).toBe('Important?');
    row('b').querySelector<HTMLInputElement>('.task__check')!.click();
    expect(prompt().textContent).toContain('Gamma');
  });

  it('ends when every remaining task is gone', () => {
    boot([task('a', 'Alpha', true, true)]);
    key(document.body, 'r');
    row('a').querySelector<HTMLButtonElement>('.task__delete')!.click();
    expect(prompt().dataset.active).toBe('false');
    key(document.body, 'z', { metaKey: true }); // undo is live again once review has ended
    expect(titles('do')).toEqual(['Alpha']);
  });
});

describe('Cmd/Ctrl+Z undo', () => {
  const two = () => [task('a', 'Alpha', true, true, { order: 0 }), task('b', 'Beta', true, true, { order: 1 })];

  it('undoes the removal on the live toast', () => {
    boot(two());
    app!.deleteTask('a');
    expect(titles('do')).toEqual(['Beta']);
    const e = key(row('b'), 'z', { metaKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(titles('do')).toEqual(['Alpha', 'Beta']);
  });

  it('works with Ctrl as well', () => {
    boot(two());
    app!.deleteTask('a');
    key(document.body, 'z', { ctrlKey: true });
    expect(titles('do')).toEqual(['Alpha', 'Beta']);
  });

  it('is ignored inside an input, where the browser undo must keep working', () => {
    boot(two());
    app!.deleteTask('a');
    input().focus();
    const e = key(input(), 'z', { metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(titles('do')).toEqual(['Beta']);
    const date = createDateField();
    const e2 = key(date, 'z', { ctrlKey: true });
    expect(e2.defaultPrevented).toBe(false);
    expect(titles('do')).toEqual(['Beta']);
  });

  it('does nothing, and leaves the key to the browser, when no toast is live', () => {
    boot(two());
    const e = key(document.body, 'z', { metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    app!.deleteTask('a');
    vi.advanceTimersByTime(5100);
    expect(key(document.body, 'z', { metaKey: true }).defaultPrevented).toBe(false);
    expect(titles('do')).toEqual(['Beta']);
  });

  it('is ignored during the triage prompt', () => {
    boot(two());
    app!.deleteTask('a');
    input().value = 'New';
    key(input(), 'Enter');
    expect(prompt().dataset.active).toBe('true');
    const e = key(document.body, 'z', { metaKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(titles('do')).toEqual(['Beta']);
  });

  it('does not treat Shift+Cmd+Z (redo) as undo', () => {
    boot(two());
    app!.deleteTask('a');
    key(document.body, 'z', { metaKey: true, shiftKey: true });
    expect(titles('do')).toEqual(['Beta']);
  });

  function createDateField(): HTMLInputElement {
    const f = document.createElement('input');
    f.type = 'date';
    root.append(f);
    return f;
  }
});

describe('placement announcement', () => {
  function addByKeys(title: string, imp: string, urg: string) {
    input().value = title;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    key(input(), 'Enter');
    key(document.body, imp);
    key(document.body, urg);
  }

  it('announces where a triaged task landed, in the existing status slot', () => {
    boot();
    addByKeys('Call Sam', 'y', 'n');
    expect(titles('schedule')).toEqual(['Call Sam']);
    expect(toast().getAttribute('role')).toBe('status');
    expect(toast().textContent).toContain('Added to Schedule');
  });

  it('names each quadrant', () => {
    const cases: [string, string, string][] = [
      ['y', 'y', 'Do'],
      ['n', 'y', 'Delegate'],
      ['n', 'n', 'Delete'],
    ];
    for (const [imp, urg, label] of cases) {
      boot();
      addByKeys('T', imp, urg);
      expect(toast().textContent).toContain(`Added to ${label}`);
      app!.destroy();
      document.body.innerHTML = '<div id="app"></div>';
      root = document.getElementById('app')!;
    }
  });

  it('neither shortens nor extends the undo window (AC7)', () => {
    boot([task('a', 'Alpha', true, true)]);
    app!.deleteTask('a');
    vi.advanceTimersByTime(3000);
    addByKeys('Call Sam', 'y', 'n');
    vi.advanceTimersByTime(1900); // 4.9 s after the delete
    expect(toast().querySelector('.toast__undo')).not.toBeNull();
    vi.advanceTimersByTime(200); // 5.1 s
    expect(toast().querySelector('.toast__undo')).toBeNull();
    expect(app!.undo()).toBe(false);
  });

  it('does not take away a live Undo', () => {
    boot([task('a', 'Alpha', true, true)]);
    app!.deleteTask('a');
    addByKeys('Call Sam', 'y', 'n');
    expect(toast().querySelector('.toast__undo')).not.toBeNull();
    expect(toast().textContent).toContain('Added to Schedule');
  });
});
