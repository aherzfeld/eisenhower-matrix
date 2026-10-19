/**
 * The undo toast. One at a time: showing a new one replaces the old one and its action.
 * The countdown is exposed for styling as `data-duration` and `--toast-duration`, set once
 * when the toast appears, so CSS can shrink `.toast__bar` without any script ticking.
 */

export const TOAST_MS = 5000;

/** Injected so tests can run on fake timers. */
export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type Toaster = {
  /** Shows `message`; with `action`, an Undo button that runs it until the toast expires. */
  show(message: string, action?: () => void): void;
  /**
   * A plain status message. It never takes away a live Undo: while one is showing, the message
   * is added to that toast as a note, so the same live region still announces it.
   */
  announce(message: string): void;
  /** Runs the live toast's action, if any, and clears the toast. False when there is none. */
  undo(): boolean;
  clear(): void;
};

export function createToaster(
  slot: HTMLElement,
  timers: Timers,
  { ms = TOAST_MS, signal }: { ms?: number; signal?: AbortSignal } = {},
): Toaster {
  const doc = slot.ownerDocument;
  let handle: unknown;
  let action: (() => void) | undefined;

  function clear() {
    if (handle !== undefined) timers.clearTimeout(handle);
    handle = undefined;
    action = undefined;
    slot.replaceChildren();
  }

  function show(message: string, act?: () => void) {
    clear();
    const toast = doc.createElement('div');
    toast.className = 'toast';
    toast.dataset.duration = String(ms);
    toast.style.setProperty('--toast-duration', `${ms}ms`);
    const bar = doc.createElement('span');
    bar.className = 'toast__bar';
    bar.setAttribute('aria-hidden', 'true');
    const text = doc.createElement('p');
    text.className = 'toast__text';
    text.textContent = message;
    toast.append(bar, text);
    if (act) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'toast__undo';
      button.textContent = 'Undo';
      toast.append(button);
    }
    slot.append(toast);
    action = act;
    handle = timers.setTimeout(clear, ms);
  }

  function announce(message: string) {
    const live = action ? slot.querySelector('.toast') : null;
    if (!live) return show(message);
    live.querySelector('.toast__note')?.remove();
    const note = doc.createElement('p');
    note.className = 'toast__note';
    note.textContent = message;
    live.append(note);
  }

  function undo() {
    const act = action;
    if (!act) return false;
    clear();
    act();
    return true;
  }

  slot.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('.toast__undo')) undo();
  }, { signal });

  return { show, announce, undo, clear };
}
