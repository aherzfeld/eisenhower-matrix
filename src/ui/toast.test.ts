import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToaster, TOAST_MS, type Timers } from './toast';

/** A hand-rolled clock, to show the toaster uses only the timers it is given. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      pending.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimeout: (h) => {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [h, p] of [...pending]) {
      if (p.at <= now) {
        pending.delete(h);
        p.fn();
      }
    }
  };
  return { timers, advance, pending };
}

let slot: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div class="toast-slot"></div>';
  slot = document.querySelector('.toast-slot')!;
});

const undoButton = () => slot.querySelector<HTMLButtonElement>('.toast__undo');

describe('toaster', () => {
  it('shows the message with an Undo button and the duration for the countdown', () => {
    const { timers } = fakeTimers();
    const toaster = createToaster(slot, timers);
    toaster.show("Deleted 'Call Sam'", () => {});
    const toast = slot.querySelector<HTMLElement>('.toast')!;
    expect(toast.querySelector('.toast__text')!.textContent).toBe("Deleted 'Call Sam'");
    expect(undoButton()!.textContent).toBe('Undo');
    expect(toast.dataset.duration).toBe(String(TOAST_MS));
    expect(toast.style.getPropertyValue('--toast-duration')).toBe(`${TOAST_MS}ms`);
    expect(toast.querySelector('.toast__bar')!.getAttribute('aria-hidden')).toBe('true');
    expect(TOAST_MS).toBe(5000);
  });

  it('Undo runs the action once and clears the toast', () => {
    const { timers } = fakeTimers();
    const toaster = createToaster(slot, timers);
    const action = vi.fn();
    toaster.show('x', action);
    undoButton()!.click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(slot.children).toHaveLength(0);
    expect(toaster.undo()).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('expires after the duration; undo then does nothing', () => {
    const { timers, advance } = fakeTimers();
    const toaster = createToaster(slot, timers);
    const action = vi.fn();
    toaster.show('x', action);
    advance(TOAST_MS - 1);
    expect(undoButton()).not.toBeNull();
    advance(1);
    expect(slot.children).toHaveLength(0);
    expect(toaster.undo()).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it('a second toast replaces the first, with its own timer and action', () => {
    const { timers, advance, pending } = fakeTimers();
    const toaster = createToaster(slot, timers);
    const first = vi.fn();
    const second = vi.fn();
    toaster.show('first', first);
    advance(3000);
    toaster.show('second', second);
    expect(pending.size).toBe(1);
    expect(slot.querySelectorAll('.toast')).toHaveLength(1);
    advance(3000); // 6 s after the first, 3 s after the second
    expect(undoButton()).not.toBeNull();
    expect(toaster.undo()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('a toast without an action has no Undo button', () => {
    const { timers } = fakeTimers();
    createToaster(slot, timers).show("Restored 'Call Sam'");
    expect(slot.querySelector('.toast__text')!.textContent).toBe("Restored 'Call Sam'");
    expect(undoButton()).toBeNull();
  });
});
