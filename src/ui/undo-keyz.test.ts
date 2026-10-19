/** #13: Cmd/Ctrl+Z undo by physical key (code KeyZ) on non-Latin layouts, with the app-level guards. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStorage, emptyState } from '../core/ports';
import type { Task } from '../core/task';
import { createApp, type App } from './app';

const NOW = '2026-03-01T12:00:00.000Z';

function task(id: string, title: string, order: number): Task {
  return { id, title, urgent: true, important: true, done: false, order, createdAt: NOW, updatedAt: NOW };
}

let root: HTMLElement;
let app: App | undefined;

function boot() {
  const storage = createMemoryStorage({ initial: { ...emptyState(), tasks: [task('a', 'Alpha', 0), task('b', 'Beta', 1)] } });
  app = createApp({ root, storage, now: () => NOW, newId: () => 'new' });
  return app;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
});
afterEach(() => {
  app?.destroy();
  app = undefined;
  vi.useRealTimers();
});

const titles = () => [...root.querySelectorAll('.q--do .task__title')].map((e) => e.textContent);
const row = (id: string) => root.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;
const input = () => root.querySelector<HTMLInputElement>('.capture__input')!;
const prompt = () => root.querySelector<HTMLElement>('.prompt')!;

function press(target: Element | Document, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** Cmd+Z on a Russian layout: the Z-position key reports 'я'. */
const russianCmdZ = { key: 'я', code: 'KeyZ', metaKey: true };
/** Cmd+W on AZERTY: the physical key in the US Z position is W there. */
const azertyCmdW = { key: 'w', code: 'KeyZ', metaKey: true };

describe('Cmd/Ctrl+Z by physical key (#13)', () => {
  it('restores the removal on the live toast and claims the key', () => {
    boot().deleteTask('a');
    expect(titles()).toEqual(['Beta']);
    const e = press(row('b'), russianCmdZ);
    expect(e.defaultPrevented).toBe(true);
    expect(titles()).toEqual(['Alpha', 'Beta']);
  });

  it('works with Ctrl as well', () => {
    boot().deleteTask('a');
    const e = press(document.body, { key: 'я', code: 'KeyZ', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(titles()).toEqual(['Alpha', 'Beta']);
  });

  it('leaves the key to the browser when no undo is live', () => {
    boot();
    expect(press(document.body, russianCmdZ).defaultPrevented).toBe(false);
    app!.deleteTask('a');
    vi.advanceTimersByTime(5100);
    expect(press(document.body, russianCmdZ).defaultPrevented).toBe(false);
    expect(titles()).toEqual(['Beta']);
  });

  it('is ignored inside an input, where the browser undo must keep working', () => {
    boot().deleteTask('a');
    input().focus();
    expect(press(input(), russianCmdZ).defaultPrevented).toBe(false);
    expect(titles()).toEqual(['Beta']);
  });

  it('does nothing during the triage prompt', () => {
    boot().deleteTask('a');
    input().value = 'New';
    press(input(), { key: 'Enter' });
    expect(prompt().dataset.active).toBe('true');
    expect(press(document.body, russianCmdZ).defaultPrevented).toBe(false);
    expect(titles()).toEqual(['Beta']);
    expect(prompt().dataset.active).toBe('true');
  });

  it('does nothing during review', () => {
    boot().deleteTask('a');
    press(document.body, { key: 'r' });
    expect(prompt().dataset.active).toBe('true');
    expect(press(document.body, russianCmdZ).defaultPrevented).toBe(false);
    expect(titles()).toEqual(['Beta']);
    expect(prompt().textContent).toContain('Beta');
  });

  it('does not take Cmd+W on AZERTY (code KeyZ, key w) as undo, so the tab can still close', () => {
    boot().deleteTask('a');
    expect(press(document.body, azertyCmdW).defaultPrevented).toBe(false);
    expect(press(document.body, { ...azertyCmdW, metaKey: false, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(titles()).toEqual(['Beta']);
  });
});
