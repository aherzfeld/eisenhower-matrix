/** The app controller: holds state, applies core ops, saves, re-renders, routes events. */
import { flagsFor, quadrantOf, type Quadrant } from '../core/quadrant';
import type { StoragePort } from '../core/ports';
import { createTask, rename, reorder, setFlags, toggleDone, type StoredState, type Task } from '../core/task';
import { validateTitle, type Result } from '../core/validate';
import { renderBanner } from './banner';
import { START, paintSquares, renderPrompt, squareClasses, triageKey, type Triage } from './capture';
import { resolveKey, type KeyAction } from './keys';
import { buildShell, renderBoard, type Editing, type Shell } from './render';

export type AppOptions = {
  root: HTMLElement;
  storage: StoragePort;
  /** ISO timestamp. Injected so tests are deterministic. */
  now: () => string;
  newId: () => string;
};

export type App = {
  getState(): StoredState;
  /**
   * Applies a core op to the tasks, saves, and re-renders. On failure nothing changes.
   * `focusId` moves focus to that task after the render (focus follows the task).
   * T7-T10 add their features by calling this.
   */
  commit(op: (tasks: Task[]) => Result<Task[]>, opts?: { focusId?: string }): Result<Task[]>;
  render(focusId?: string): void;
  focusCapture(): void;
  shell: Shell;
  destroy(): void;
};

export function createApp({ root, storage, now, newId }: AppOptions): App {
  const doc = root.ownerDocument;
  const shell = buildShell(root);
  const loaded = storage.load();
  let state: StoredState = loaded.state;
  const loadWarning = loaded.warning;
  let saveWarning: string | undefined;

  let triage: Triage | undefined;
  let pendingTitle = '';
  let editing: Editing | undefined;
  const tabStops: Partial<Record<Quadrant, string>> = {};

  const rowOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? t.closest<HTMLElement>('.task') : null;
  const findRow = (id: string) =>
    [...root.querySelectorAll<HTMLElement>('.task')].find((r) => r.dataset.taskId === id);
  const taskOf = (id: string) => state.tasks.find((t) => t.id === id);

  function updateBanner() {
    renderBanner(shell.banner, saveWarning ?? loadWarning);
  }

  function persist() {
    const res = storage.save(state);
    if (res.ok) {
      state = { ...state, rev: res.rev };
      saveWarning = undefined;
    } else {
      saveWarning = res.error; // state stays in memory; T10 refines this
    }
    updateBanner();
  }

  function focusRow(id: string) {
    const task = taskOf(id);
    if (task) tabStops[quadrantOf(task)] = id;
    const row = findRow(id);
    if (!row) return;
    if (editing?.id === id) row.querySelector<HTMLInputElement>('.task__edit')?.focus();
    else row.focus();
  }

  function render(focusId?: string) {
    const id = focusId ?? rowOf(doc.activeElement)?.dataset.taskId;
    if (focusId) {
      const t = taskOf(focusId);
      if (t) tabStops[quadrantOf(t)] = focusId;
    }
    renderBoard(shell, state.tasks, { tabStops, editing });
    if (id) focusRow(id);
  }

  function commit(op: (tasks: Task[]) => Result<Task[]>, opts: { focusId?: string } = {}) {
    const result = op(state.tasks);
    if (!result.ok) return result;
    state = { ...state, tasks: result.value };
    persist();
    render(opts.focusId);
    return result;
  }

  function focusCapture() {
    shell.input.focus();
  }

  // ---- capture / triage ----

  function startTriage() {
    const title = validateTitle(shell.input.value);
    if (!title.ok) {
      shell.message.textContent = title.error;
      return;
    }
    shell.message.textContent = '';
    pendingTitle = title.value;
    triage = START;
    renderPrompt(shell.prompt, triage);
    shell.prompt.region.focus();
  }

  function endTriage() {
    triage = undefined;
    renderPrompt(shell.prompt, undefined);
    focusCapture();
  }

  function handleTriageKey(event: KeyboardEvent) {
    if (!triage) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return; // leave browser chords alone
    event.preventDefault();
    const outcome = triageKey(triage, event.key);
    if (outcome.kind === 'ignore') return;
    if (outcome.kind === 'cancel') return endTriage();
    if (outcome.kind === 'continue') {
      triage = outcome.state;
      renderPrompt(shell.prompt, triage);
      return;
    }
    const { flags } = outcome;
    paintSquares(shell.prompt, squareClasses(flags));
    const result = commit((tasks) => createTask(tasks, { title: pendingTitle, ...flags }, { id: newId(), now: now() }));
    if (result.ok) shell.input.value = '';
    else shell.message.textContent = result.error;
    endTriage();
  }

  // ---- board actions ----

  function startRename(id: string) {
    const task = taskOf(id);
    if (!task) return;
    editing = { id, draft: task.title };
    render(id);
  }

  function cancelRename() {
    const id = editing?.id;
    editing = undefined;
    render(id);
  }

  function saveRename() {
    const current = editing;
    if (!current) return;
    const task = taskOf(current.id);
    if (!task) return cancelRename();
    const trimmed = validateTitle(current.draft);
    if (trimmed.ok && trimmed.value === task.title) return cancelRename();
    editing = undefined;
    const result = commit((tasks) => rename(tasks, current.id, current.draft, now()), { focusId: current.id });
    if (!result.ok) {
      editing = { ...current, error: result.error };
      const msg = findRow(current.id)?.querySelector('.task__error');
      if (msg) msg.textContent = result.error;
    }
  }

  function moveTask(id: string, to: Quadrant) {
    commit((tasks) => setFlags(tasks, id, flagsFor(to), now()), { focusId: id });
  }

  function stepFocus(row: HTMLElement, delta: -1 | 1) {
    const rows = [...(row.parentElement?.children ?? [])] as HTMLElement[];
    const next = rows[rows.indexOf(row) + delta];
    if (next) next.focus();
  }

  function handleAction(action: KeyAction, event: KeyboardEvent) {
    if (action.type === 'focusCapture') {
      event.preventDefault();
      return focusCapture();
    }
    const row = rowOf(event.target);
    const id = row?.dataset.taskId;
    if (!row || !id) return;
    switch (action.type) {
      case 'move':
        event.preventDefault();
        return moveTask(id, action.quadrant);
      case 'focusStep':
        event.preventDefault();
        return stepFocus(row, action.delta);
      case 'reorder':
        event.preventDefault();
        return void commit((tasks) => reorder(tasks, id, action.direction, now()), { focusId: id });
      case 'toggleDone':
      case 'rename':
        // Only when the row itself has focus: on a button, Space/Enter must still click it.
        if (event.target !== row) return;
        event.preventDefault();
        if (action.type === 'rename') return startRename(id);
        return void commit((tasks) => toggleDone(tasks, id, now()), { focusId: id });
    }
  }

  // ---- listeners ----

  function onDocKeydown(event: KeyboardEvent) {
    if (triage) return handleTriageKey(event);
    if (event.defaultPrevented) return;
    const action = resolveKey(event);
    if (action) handleAction(action, event);
  }

  shell.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || triage) return;
    event.preventDefault();
    startTriage();
  });
  shell.input.addEventListener('input', () => {
    shell.message.textContent = '';
  });

  root.addEventListener('keydown', (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('task__edit') || event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editing) editing.draft = t.value;
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  });
  root.addEventListener('input', (event) => {
    const t = event.target;
    if (editing && t instanceof HTMLInputElement && t.classList.contains('task__edit')) editing.draft = t.value;
  });
  root.addEventListener('change', (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('task__check')) return;
    const id = rowOf(t)?.dataset.taskId;
    if (id) commit((tasks) => toggleDone(tasks, id, now()), { focusId: id });
  });
  root.addEventListener('click', (event) => {
    const t = event.target instanceof Element ? event.target.closest<HTMLElement>('.task__move') : null;
    const id = rowOf(t)?.dataset.taskId;
    if (t && id) moveTask(id, t.dataset.move as Quadrant);
  });
  root.addEventListener('focusin', (event) => {
    const row = rowOf(event.target);
    const id = row?.dataset.taskId;
    const task = id ? taskOf(id) : undefined;
    if (!row || !task) return;
    tabStops[quadrantOf(task)] = id;
    for (const r of row.parentElement?.children ?? []) (r as HTMLElement).tabIndex = r === row ? 0 : -1;
  });
  doc.addEventListener('keydown', onDocKeydown);

  renderPrompt(shell.prompt, undefined);
  updateBanner();
  render();

  return {
    getState: () => state,
    commit,
    render,
    focusCapture,
    shell,
    destroy: () => doc.removeEventListener('keydown', onDocKeydown),
  };
}
