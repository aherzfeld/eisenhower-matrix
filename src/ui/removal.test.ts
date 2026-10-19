/** AC7: Delete, Clear done and Drop all can be undone within 5 s, without losing newer work. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, emptyState, type MemoryStorage } from '../core/ports';
import { quadrantOf } from '../core/quadrant';
import type { StoredState, Task } from '../core/task';
import { createApp, type App } from './app';

const NOW = '2026-03-01T12:00:00.000Z';

function task(id: string, title: string, urgent: boolean, important: boolean, order = 0, done = false): Task {
  return { id, title, urgent, important, done, order, createdAt: NOW, updatedAt: NOW };
}

let root: HTMLElement;
let app: App | undefined;
let n = 0;

function boot(opts: { tasks?: Task[]; storage?: MemoryStorage } = {}) {
  const initial: StoredState = { ...emptyState(), tasks: opts.tasks ?? [] };
  const storage = opts.storage ?? createMemoryStorage({ initial });
  app = createApp({ root, storage, now: () => NOW, newId: () => `id-${++n}` });
  return { app, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
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
const titles = (name: string) => [...q(name).querySelectorAll('.task__title')].map((e) => e.textContent);
const row = (id: string) => root.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
const input = () => root.querySelector<HTMLInputElement>('.capture__input')!;
const toastSlot = () => root.querySelector<HTMLElement>('.toast-slot')!;
const toastText = () => toastSlot().querySelector('.toast__text')?.textContent ?? null;
const undoButton = () => toastSlot().querySelector<HTMLButtonElement>('.toast__undo');
const clearDoneButton = () => root.querySelector<HTMLButtonElement>('.footer .clear-done')!;
const dropAllButton = () => q('delete').querySelector<HTMLButtonElement>('.q__footer .q__drop')!;
const storedIds = (storage: MemoryStorage) => storage.load().state.tasks.map((t) => t.id).sort();

function key(target: Element, k: string): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function pressDelete(id: string, k = 'Delete') {
  const r = row(id)!;
  r.focus();
  return key(r, k);
}

/** Adds a task through the capture flow: title, Enter, y, y (Do). */
function addThroughCapture(title: string) {
  input().value = title;
  input().focus();
  key(input(), 'Enter');
  const region = root.querySelector('.prompt')!;
  key(region, 'y');
  key(region, 'y');
}

function contiguous(tasks: Task[]) {
  for (const name of ['do', 'schedule', 'delegate', 'delete'] as const) {
    const orders = tasks.filter((t) => quadrantOf(t) === name).map((t) => t.order).sort((a, b) => a - b);
    expect(orders, name).toEqual(orders.map((_, i) => i));
  }
}

const sam = () => [task('sam', 'Call Sam', true, true, 0), task('b', 'B', true, true, 1), task('c', 'C', true, true, 2)];

describe('deleting a task', () => {
  it('Delete on a focused row removes it, saves at once, and offers Undo', () => {
    const { storage } = boot({ tasks: sam() });
    const e = pressDelete('sam');
    expect(e.defaultPrevented).toBe(true);
    expect(titles('do')).toEqual(['B', 'C']);
    expect(storedIds(storage)).toEqual(['b', 'c']);
    expect(toastText()).toBe("Deleted 'Call Sam'");
    expect(undoButton()!.textContent).toBe('Undo');
  });

  it('Backspace does the same', () => {
    boot({ tasks: sam() });
    pressDelete('b', 'Backspace');
    expect(titles('do')).toEqual(['Call Sam', 'C']);
  });

  it('clicking Undo puts the task back and saves', () => {
    const { storage } = boot({ tasks: sam() });
    pressDelete('sam');
    undoButton()!.click();
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
    expect(storedIds(storage)).toEqual(['b', 'c', 'sam']);
    expect(undoButton()).toBeNull();
  });

  it('each row has a labelled delete button with a key chip, out of the Tab order', () => {
    boot({ tasks: sam() });
    const button = row('sam')!.querySelector<HTMLButtonElement>('.task__delete')!;
    expect(button.getAttribute('aria-label')).toBe('Delete Call Sam');
    expect(button.tabIndex).toBe(-1);
    expect(button.type).toBe('button');
    expect(button.querySelector('.key')!.getAttribute('aria-hidden')).toBe('true');
    button.click();
    expect(titles('do')).toEqual(['B', 'C']);
    expect(toastText()).toBe("Deleted 'Call Sam'");
  });

  it('deleting the row being renamed closes the editor', () => {
    boot({ tasks: sam() });
    row('sam')!.querySelector<HTMLButtonElement>('.task__rename')!.click();
    expect(root.querySelector('.task__edit')).not.toBeNull();
    row('sam')!.querySelector<HTMLButtonElement>('.task__delete')!.click();
    expect(root.querySelector('.task__edit')).toBeNull();
    expect(titles('do')).toEqual(['B', 'C']);
  });
});

describe('the undo window (AC7)', () => {
  it('Undo at 4.9 s restores', () => {
    boot({ tasks: sam() });
    pressDelete('sam');
    vi.advanceTimersByTime(4900);
    undoButton()!.click();
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
  });

  it('at 5.1 s the toast is gone and undo does nothing', () => {
    const { storage } = boot({ tasks: sam() });
    pressDelete('sam');
    vi.advanceTimersByTime(5100);
    expect(undoButton()).toBeNull();
    expect(app!.undo()).toBe(false);
    expect(titles('do')).toEqual(['B', 'C']);
    expect(storedIds(storage)).toEqual(['b', 'c']);
  });

  it('delete A, add B, undo: A and B are both present', () => {
    const { storage } = boot({ tasks: [task('a', 'A', true, true, 0)] });
    pressDelete('a');
    addThroughCapture('B');
    expect(titles('do')).toEqual(['B']);
    expect(app!.undo()).toBe(true);
    expect(titles('do')).toEqual(['A', 'B']);
    expect(storage.load().state.tasks.map((t) => t.title).sort()).toEqual(['A', 'B']);
  });

  it('two deletes in a row: the second Undo restores only the second task', () => {
    boot({ tasks: sam() });
    pressDelete('sam');
    vi.advanceTimersByTime(3000);
    pressDelete('b');
    expect(toastSlot().querySelectorAll('.toast')).toHaveLength(1);
    expect(toastText()).toBe("Deleted 'B'");
    vi.advanceTimersByTime(3000); // past the first toast's 5 s, inside the second's
    undoButton()!.click();
    expect(titles('do')).toEqual(['B', 'C']);
    expect(app!.undo()).toBe(false);
    expect(titles('do')).toEqual(['B', 'C']);
  });

  it('a reload forfeits undo: nothing about the window is persisted', () => {
    const { storage } = boot({ tasks: sam() });
    pressDelete('sam');
    app!.destroy();
    app = createApp({ root, storage, now: () => NOW, newId: () => 'z' });
    expect(app.undo()).toBe(false);
    expect(titles('do')).toEqual(['B', 'C']);
    expect(Object.keys(storage.load().state).sort()).toEqual(['rev', 'tasks', 'version']);
  });

  it('the order is contiguous after a restore', () => {
    const { storage } = boot({
      tasks: [
        task('a', 'A', true, true, 0, true),
        task('b', 'B', true, true, 1),
        task('c', 'C', true, true, 2, true),
        task('d', 'D', true, true, 3),
      ],
    });
    clearDoneButton().click();
    addThroughCapture('E');
    app!.undo();
    const tasks = storage.load().state.tasks;
    contiguous(tasks);
    expect(tasks.filter((t) => quadrantOf(t) === 'do').sort((x, y) => x.order - y.order).map((t) => t.id))
      .toEqual(['a', 'b', 'c', 'd', 'id-1']);
  });
});

describe('Clear done and Drop all', () => {
  const mixed = () => [
    task('a', 'A', true, true, 0, true),
    task('b', 'B', true, true, 1),
    task('s', 'S', false, true, 0, true),
    task('d', 'D', true, false, 0, true),
    task('w', 'W', false, false, 0),
    task('x', 'X', false, false, 1),
    task('y', 'Y', false, false, 2),
    task('z', 'Z', false, false, 3),
  ];

  it('Clear done removes every done task, says how many, and can be undone', () => {
    const { storage } = boot({ tasks: mixed() });
    expect(clearDoneButton().hidden).toBe(false);
    expect(clearDoneButton().textContent).toBe('Clear done');
    clearDoneButton().click();
    expect(storedIds(storage)).toEqual(['b', 'w', 'x', 'y', 'z']);
    expect(toastText()).toBe('Cleared 3 done tasks');
    expect(clearDoneButton().hidden).toBe(true);
    undoButton()!.click();
    expect(storedIds(storage)).toEqual(['a', 'b', 'd', 's', 'w', 'x', 'y', 'z']);
    expect(titles('do')).toEqual(['B', 'A']);
  });

  it('Drop all empties the Delete quadrant, says how many, and can be undone', () => {
    const { storage } = boot({ tasks: mixed() });
    expect(dropAllButton().hidden).toBe(false);
    expect(dropAllButton().textContent).toBe('Drop all');
    dropAllButton().click();
    expect(titles('delete')).toEqual([]);
    expect(storedIds(storage)).toEqual(['a', 'b', 'd', 's']);
    expect(toastText()).toBe('Dropped 4 tasks');
    expect(dropAllButton().hidden).toBe(true);
    undoButton()!.click();
    expect(titles('delete')).toEqual(['W', 'X', 'Y', 'Z']);
  });

  it('uses the singular for one task', () => {
    boot({ tasks: [task('a', 'A', true, true, 0, true), task('w', 'W', false, false, 0)] });
    clearDoneButton().click();
    expect(toastText()).toBe('Cleared 1 done task');
    dropAllButton().click();
    expect(toastText()).toBe('Dropped 1 task');
  });

  it('Clear done shows only when a task is done; Drop all only when Delete has tasks', () => {
    boot({ tasks: [task('a', 'A', true, true, 0)] });
    expect(clearDoneButton().hidden).toBe(true);
    expect(dropAllButton().hidden).toBe(true);
    row('a')!.focus();
    key(row('a')!, ' ');
    expect(clearDoneButton().hidden).toBe(false);
    key(row('a')!, '4');
    expect(dropAllButton().hidden).toBe(false);
  });
});

describe('focus after a removal', () => {
  it('moves to the next row in the quadrant', () => {
    boot({ tasks: sam() });
    pressDelete('b');
    expect(document.activeElement).toBe(row('c'));
  });

  it('else to the previous row', () => {
    boot({ tasks: sam() });
    pressDelete('c');
    expect(document.activeElement).toBe(row('b'));
  });

  it('else to the capture input', () => {
    boot({ tasks: [task('a', 'A', true, true, 0)] });
    pressDelete('a');
    expect(document.activeElement).toBe(input());
  });

  it('after Drop all, to the capture input', () => {
    boot({ tasks: [task('w', 'W', false, false, 0)] });
    dropAllButton().focus();
    dropAllButton().click();
    expect(document.activeElement).toBe(input());
  });

  it('after Undo, to the first restored task', () => {
    boot({ tasks: sam() });
    pressDelete('b');
    undoButton()!.focus();
    undoButton()!.click();
    expect(document.activeElement).toBe(row('b'));
  });
});

describe('guards', () => {
  it('Delete is ignored while typing in the capture input', () => {
    boot({ tasks: sam() });
    input().value = 'abc';
    input().focus();
    const e = key(input(), 'Backspace');
    expect(e.defaultPrevented).toBe(false);
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
    expect(toastText()).toBeNull();
  });

  it('Delete is ignored in the rename editor', () => {
    boot({ tasks: sam() });
    row('b')!.focus();
    key(row('b')!, 'Enter');
    const edit = root.querySelector<HTMLInputElement>('.task__edit')!;
    key(edit, 'Delete');
    expect(row('b')).not.toBeNull();
  });

  it('Delete is ignored while the triage prompt is open', () => {
    boot({ tasks: sam() });
    input().value = 'New';
    input().focus();
    key(input(), 'Enter');
    row('b')!.focus();
    key(row('b')!, 'Delete');
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
    expect(toastText()).toBeNull();
  });

  it('holding Delete removes only the focused task, not each row focus moves to', () => {
    // Focus moves to the next row after a delete, so auto-repeat would empty the quadrant
    // while Undo could bring back only the last one.
    boot({ tasks: sam() });
    pressDelete('sam');
    for (let i = 0; i < 3; i++) {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Delete', repeat: true, bubbles: true, cancelable: true }),
      );
    }
    expect(titles('do')).toEqual(['B', 'C']);
    expect(toastText()).toBe("Deleted 'Call Sam'");
  });

  it('Delete is ignored during IME composition', () => {
    boot({ tasks: sam() });
    row('b')!.focus();
    const init = { bubbles: true, cancelable: true };
    row('b')!.dispatchEvent(new KeyboardEvent('keydown', { ...init, key: 'Delete', isComposing: true }));
    row('b')!.dispatchEvent(new KeyboardEvent('keydown', { ...init, key: 'Backspace', keyCode: 229 }));
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
  });

  it('a failed save during a removal shows the banner; the removal holds in memory and can be undone', () => {
    const storage = createMemoryStorage({ initial: { ...emptyState(), tasks: sam() }, mode: 'memory' });
    boot({ storage });
    pressDelete('sam');
    expect(root.querySelector('.banner')!.textContent).toBe('Storage is unavailable.');
    expect(titles('do')).toEqual(['B', 'C']);
    expect(toastText()).toBe("Deleted 'Call Sam'");
    undoButton()!.click();
    expect(titles('do')).toEqual(['Call Sam', 'B', 'C']);
  });
});

describe('announcements', () => {
  it('the toast slot is a polite live region that says what was removed and restored', () => {
    boot({ tasks: sam() });
    expect(toastSlot().getAttribute('role')).toBe('status');
    pressDelete('sam');
    expect(toastSlot().textContent).toContain("Deleted 'Call Sam'");
    undoButton()!.click();
    expect(toastText()).toBe("Restored 'Call Sam'");
    expect(undoButton()).toBeNull();
  });

  it('a multi-task undo says how many came back', () => {
    boot({ tasks: [task('w', 'W', false, false, 0), task('x', 'X', false, false, 1)] });
    dropAllButton().click();
    undoButton()!.click();
    expect(toastText()).toBe('Restored 2 tasks');
  });
});
