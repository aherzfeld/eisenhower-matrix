/** Global keyboard map. Pure: turns a keydown into an action, or undefined to leave it alone. */
import type { Quadrant } from '../core/quadrant';

export type KeyAction =
  | { type: 'focusCapture' }
  | { type: 'move'; quadrant: Quadrant }
  | { type: 'focusStep'; delta: -1 | 1 }
  | { type: 'reorder'; direction: 'up' | 'down' }
  | { type: 'toggleDone' }
  | { type: 'rename' }
  | { type: 'remove' };

const MOVE_KEYS: Record<string, Quadrant> = { '1': 'do', '2': 'schedule', '3': 'delegate', '4': 'delete' };

/**
 * True while an IME is composing. Safari fires the Enter that confirms a composition after
 * compositionend, with isComposing false but keyCode 229, so that is checked too.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

/** True when the keystroke belongs to a text control or an IME, not to the board. */
export function isTyping(event: KeyboardEvent): boolean {
  if (isComposing(event)) return true;
  const t = event.target;
  if (!(t instanceof Element)) return false;
  if (t.closest('input, textarea, select')) return true;
  return t.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

export function resolveKey(event: KeyboardEvent): KeyAction | undefined {
  if (isTyping(event)) return undefined;
  if (event.ctrlKey || event.metaKey) return undefined;
  const { key } = event;

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    if (event.shiftKey) return undefined;
    const up = key === 'ArrowUp';
    if (event.altKey) return { type: 'reorder', direction: up ? 'up' : 'down' };
    return { type: 'focusStep', delta: up ? -1 : 1 };
  }
  if (event.altKey) return undefined;

  if (key === '/') return { type: 'focusCapture' };
  const quadrant = MOVE_KEYS[key];
  if (quadrant) return { type: 'move', quadrant };
  if (key === ' ') return { type: 'toggleDone' };
  if (key === 'Enter') return { type: 'rename' };
  // Not on auto-repeat: focus moves to the next row after a delete, so a held key would
  // empty the quadrant while Undo covers only the last removal.
  if (key === 'Delete' || key === 'Backspace') return event.repeat ? undefined : { type: 'remove' };
  // Later tasks bind here: 'r' starts review (T9).
  return undefined;
}
