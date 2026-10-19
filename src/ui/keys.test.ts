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
    expect(resolveKey(press({ key: 'Delete' }))).toEqual({ type: 'remove' });
    expect(resolveKey(press({ key: 'Backspace' }))).toEqual({ type: 'remove' });
  });

  it('maps r to review, and Ctrl/Cmd+Z to undo', () => {
    expect(resolveKey(press({ key: 'r' }))).toEqual({ type: 'review' });
    expect(resolveKey(press({ key: 'z', ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(resolveKey(press({ key: 'z', metaKey: true }))).toEqual({ type: 'undo' });
    expect(resolveKey(press({ key: 'Z', metaKey: true }))).toEqual({ type: 'undo' });
  });

  it('maps Ctrl/Cmd+Z to undo by physical key on a non-Latin layout (Russian)', () => {
    expect(resolveKey(press({ key: 'я', code: 'KeyZ', metaKey: true }))).toEqual({ type: 'undo' });
    expect(resolveKey(press({ key: 'я', code: 'KeyZ', ctrlKey: true }))).toEqual({ type: 'undo' });
  });

  it('leaves a KeyZ chord alone inside an input, with Shift, or with Alt', () => {
    expect(resolveKey(press({ key: 'я', code: 'KeyZ', metaKey: true }, document.createElement('input')))).toBeUndefined();
    expect(resolveKey(press({ key: 'я', code: 'KeyZ', metaKey: true, shiftKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'я', code: 'KeyZ', ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'я', code: 'KeyZ' }))).toBeUndefined();
  });

  it('never claims the key itself: app.ts does that only while an undo is live', () => {
    const e = press({ key: 'я', code: 'KeyZ', metaKey: true });
    resolveKey(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not treat Shift+Cmd+Z (redo), Alt chords or a bare z as undo', () => {
    expect(resolveKey(press({ key: 'z', metaKey: true, shiftKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'z', ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'z' }))).toBeUndefined();
    expect(resolveKey(press({ key: 'r', ctrlKey: true }))).toBeUndefined();
  });

  it('leaves unbound keys alone', () => {
    for (const key of ['x', '5', '0']) {
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
    const targets: HTMLElement[] = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
    ];
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    targets.push(editable);
    for (const t of targets) {
      for (const key of ['/', '1', 'ArrowUp', ' ', 'Enter', 'Delete', 'Backspace', 'r']) {
        expect(resolveKey(press({ key }, t))).toBeUndefined();
      }
      // The browser's own undo must keep working in a text field.
      expect(resolveKey(press({ key: 'z', metaKey: true }, t))).toBeUndefined();
      expect(resolveKey(press({ key: 'z', ctrlKey: true }, t))).toBeUndefined();
    }
  });

  it('ignores keys during IME composition', () => {
    expect(resolveKey(press({ key: '1', isComposing: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'r', isComposing: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'Backspace', isComposing: true }))).toBeUndefined();
  });

  it('ignores Delete and Backspace in a chord', () => {
    expect(resolveKey(press({ key: 'Backspace', metaKey: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'Delete', altKey: true }))).toBeUndefined();
  });

  it('ignores a held Delete or Backspace (auto-repeat), so one press removes one task', () => {
    expect(resolveKey(press({ key: 'Delete', repeat: true }))).toBeUndefined();
    expect(resolveKey(press({ key: 'Backspace', repeat: true }))).toBeUndefined();
  });
});
