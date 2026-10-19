import { describe, expect, it } from 'vitest';
import { resolveKey } from './keys';

function press(init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) {
    document.body.append(target);
    target.dispatchEvent(e);
    target.remove();
  }
  return e;
}

describe('resolveKey', () => {
  it('maps the global shortcuts', () => {
    expect(resolveKey(press({ key: '/' }))).toEqual({ type: 'focusCapture' });
    expect(resolveKey(press({ key: '1' }))).toEqual({ type: 'move', quadrant: 'do' });
    expect(resolveKey(press({ key: '2' }))).toEqual({ type: 'move', quadrant: 'schedule' });
    expect(resolveKey(press({ key: '3' }))).toEqual({ type: 'move', quadrant: 'delegate' });
    expect(resolveKey(press({ key: '4' }))).toEqual({ type: 'move', quadrant: 'delete' });
    expect(resolveKey(press({ key: 'ArrowUp' }))).toEqual({ type: 'focusStep', delta: -1 });
    expect(resolveKey(press({ key: 'ArrowDown' }))).toEqual({ type: 'focusStep', delta: 1 });
    expect(resolveKey(press({ key: 'ArrowUp', altKey: true }))).toEqual({
      type: 'reorder',
      direction: 'up',
    });
    expect(resolveKey(press({ key: 'ArrowDown', altKey: true }))).toEqual({
      type: 'reorder',
      direction: 'down',
    });
    expect(resolveKey(press({ key: ' ' }))).toEqual({ type: 'toggleDone' });
    expect(resolveKey(press({ key: 'Enter' }))).toEqual({ type: 'rename' });
  });

  it('leaves unbound keys alone (Delete and r belong to later tasks)', () => {
    for (const key of ['Delete', 'Backspace', 'r', 'x', '5', '0']) {
      expect(resolveKey(press({ key }))).toBeUndefined();
    }
  });

  it('ignores chords with ctrl or meta, and Alt on anything but arrows', () => {
    expect(resolveKey(press({ key: '1', ctrlKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: '/', metaKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: '1', altKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'ArrowUp', shiftKey: true }))).toBeUndefined();
  });

  it('ignores everything typed into an input, textarea or contenteditable', () => {
    const targets = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
    ];
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    targets.push(editable);
    for (const t of targets) {
      for (const key of ['/', '1', 'ArrowUp', ' ', 'Enter']) {
        expect(resolveKey(press({ key }, t))).toBeUndefined();
      }
    }
  });

  it('ignores keys during IME composition', () => {
    expect(resolveKey(press({ key: '1', isComposing: true }))).toBeUndefined();
  });
});
