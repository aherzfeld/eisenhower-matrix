/** The app controller: holds state, applies core ops, saves, re-renders, routes events. */
import { QUADRANTS, flagsFor, quadrantOf, type Quadrant } from '../core/quadrant';
import type { LoadResult, StoragePort } from '../core/ports';
import { localToday, msUntilMidnight } from '../core/dates';
import { createTask, rename, sameTasks, setFlags, setWhen, setWho, toggleDone, type StoredState, type Task } from '../core/task';
import { clearDone, dropQuadrant, removeOne, restore, type Removal, type RemovalRecord } from '../core/undo';
import { validateTitle, type Result } from '../core/validate';
import { downloadText, safeFilename } from '../io/download';
import { backupReminder, renderBackupStatus } from './backup';
import { EARLIER_UNREADABLE, lostChangesWarning, renderBanner, type Notice } from './banner';
import { START, paintSquares, renderPrompt, squareClasses, triageKey, type Triage } from './capture';
import { isComposing, resolveKey, type KeyAction } from './keys';
import { reorderVisible } from './order';
import { buildShell, refreshStamps, renderBoard, sortedFor, type Editing, type Shell } from './render';
import { reviewKey, reviewProgress, settleReview, startReview, type Review } from './review';
import { browserTimers, createToaster, type Timers } from './toast';
import { createTransfer, type SaveOutcome } from './transfer';

export type AppOptions = {
  root: HTMLElement;
  storage: StoragePort;
  /** ISO timestamp. Injected so tests are deterministic. */
  now: () => string;
  newId: () => string;
  /** For the undo toast's 5 s window. Defaults to the browser's timers. */
  timers?: Timers;
  /** Saves a file (export). Defaults to a browser download. */
  download?: (text: string, filename: string) => void;
};

export type App = {
  getState(): StoredState;
  /**
   * Applies a core op to the tasks, saves, and re-renders. On failure nothing changes.
   * An op that leaves the tasks as they were (ignoring updatedAt) saves nothing. When the save
   * finds another tab has saved since, nothing is written: the tab reloads from storage, the
   * banner says how many changes were lost, and the result is a failure.
   * `focusId` moves focus to that task after the render (focus follows the task).
   * `render: false` saves without re-rendering, for edits to a field the user is still in.
   * T7-T10 add their features by calling this.
   */
  commit(op: (tasks: Task[]) => Result<Task[]>, opts?: { focusId?: string; render?: boolean }): Result<Task[]>;
  render(focusId?: string): void;
  /**
   * Removals save at once and show an undo toast. Each returns false when nothing was
   * removed. A new removal replaces the toast, and its Undo covers only that removal.
   */
  deleteTask(id: string): boolean;
  clearDone(): boolean;
  /** Removes every task in the Delete quadrant. */
  dropAll(): boolean;
  /** Undoes the removal on the live toast. False once it has expired or been replaced. */
  undo(): boolean;
  focusCapture(): void;
  /** Downloads the board as JSON, then records the time as the last backup. */
  exportTasks(): void;
  /** Validates the file and asks before replacing the board (see transfer.ts). */
  importFile(file: File): Promise<void>;
  shell: Shell;
  destroy(): void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const UPDATED_ELSEWHERE = 'Updated from another tab';
export const NOT_SAVED_CONFLICT = "Changed in another tab, so this wasn't saved. Try again.";

export function createApp({
  root,
  storage,
  now,
  newId,
  timers = browserTimers,
  download = (text, filename) => downloadText(text, filename),
}: AppOptions): App {
  const doc = root.ownerDocument;
  const shell = buildShell(root);
  let state: StoredState = { version: 1, rev: 0, tasks: [] }; // replaced by the first load, below
  /** The latest load's warning; replaced on every reload. */
  let loadWarning: string | undefined;
  /** Unreadable stored data, once seen, stays on offer for the session, even across reloads. */
  let rawNotice: Notice | undefined;
  /** The latest failed save's error; cleared by a successful save or a reload. */
  let saveWarning: string | undefined;
  /** Changes a reload discarded; shown until the next successful save. */
  let lostWarning: string | undefined;
  /** Commits since the last successful save, which a reload would discard. */
  let unsaved = 0;
  /** Counts reloads, so a caller can tell its commit ended in one. */
  let reloads = 0;
  let shownNotices: Notice[] = [];

  let triage: Triage | undefined;
  let review: Review | undefined;
  let reviewReturnId: string | undefined;
  let renderedToday = '';
  /** A render was put off while the user was typing in a task's field. */
  let renderStale = false;
  let midnightTimer: unknown;
  let pendingTitle = '';
  let editing: Editing | undefined;
  const tabStops: Partial<Record<Quadrant, string>> = {};

  const rowOf = (t: EventTarget | null): HTMLElement | null =>
    t instanceof Element ? t.closest<HTMLElement>('.task') : null;
  const findRow = (id: string) =>
    [...root.querySelectorAll<HTMLElement>('.task')].find((r) => r.dataset.taskId === id);
  const taskOf = (id: string) => state.tasks.find((t) => t.id === id);
  /** The local calendar day, from the injected clock. */
  const today = () => localToday(new Date(now()));

  /** Every current warning, once each; a notice with the raw data keeps its download. */
  function notices(): Notice[] {
    const list: Notice[] = [];
    const candidates: (Notice | undefined)[] = [
      lostWarning === undefined ? undefined : { text: lostWarning },
      saveWarning === undefined ? undefined : { text: saveWarning },
      rawNotice,
      loadWarning === undefined ? undefined : { text: loadWarning },
    ];
    for (const n of candidates) {
      if (!n) continue;
      const same = list.find((x) => x.text === n.text);
      if (!same) list.push({ ...n });
      else if (same.raw === undefined && n.raw !== undefined) same.raw = n.raw;
    }
    return list;
  }

  function updateBanner() {
    shownNotices = notices();
    renderBanner(shell.banner, shownNotices);
  }

  function updateBackupStatus() {
    renderBackupStatus(shell.backupStatus, backupReminder(state.lastExportAt, new Date(now())));
  }

  /** Takes a load's state and warnings. Returns how many unsaved changes it discarded. */
  function applyLoad(res: LoadResult): number {
    const lost = unsaved;
    state = res.state;
    loadWarning = res.warning;
    if (res.raw !== undefined && res.warning !== undefined) rawNotice = { text: res.warning, raw: res.raw };
    else if (rawNotice) rawNotice = { text: EARLIER_UNREADABLE, raw: rawNotice.raw };
    saveWarning = undefined;
    unsaved = 0;
    if (lost > 0) lostWarning = lostChangesWarning(lost);
    if (editing && !taskOf(editing.id)) editing = undefined;
    updateBanner();
    updateBackupStatus();
    return lost;
  }

  function reloadFromStorage(): number {
    reloads++;
    return applyLoad(storage.load());
  }

  /** Saves the current state. A conflict reloads from storage instead of writing. */
  function persist(): SaveOutcome {
    const res = storage.save(state);
    if (res.ok) {
      state = { ...state, rev: res.rev };
      unsaved = 0;
      saveWarning = undefined;
      lostWarning = undefined;
      updateBanner();
      return 'saved';
    }
    unsaved++;
    if (res.reason === 'conflict') {
      reloadFromStorage();
      return 'reloaded';
    }
    saveWarning = res.error; // the change stays in memory; the banner says it isn't saved
    updateBanner();
    return 'failed';
  }

  /** Another tab changed the data: take it, and say so. */
  function onExternalChange() {
    const lost = reloadFromStorage();
    if (lost === 0) toaster.announce(UPDATED_ELSEWHERE);
    renderSoon();
    if (review) syncReview();
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
    renderedToday = today();
    renderStale = false;
    renderBoard(shell, state.tasks, { tabStops, editing, today: renderedToday });
    updateBackupStatus();
    if (id) focusRow(id);
  }

  /**
   * Renders now, unless the user is typing in a field of a task that still exists: then on
   * focusout, so a reload never wipes a half-typed date or name.
   */
  function renderSoon() {
    const id = rowOf(doc.activeElement)?.dataset.taskId;
    if (inTaskField() && id && taskOf(id)) {
      renderStale = true;
      return;
    }
    render();
  }

  function commit(
    op: (tasks: Task[]) => Result<Task[]>,
    opts: { focusId?: string; render?: boolean } = {},
  ): Result<Task[]> {
    const result = op(state.tasks);
    if (!result.ok) return result;
    if (sameTasks(state.tasks, result.value)) return result; // changed nothing: no save, no render
    state = { ...state, tasks: result.value };
    const saved = persist();
    if (saved === 'reloaded') {
      render(opts.focusId && taskOf(opts.focusId) ? opts.focusId : undefined);
    } else if (opts.render !== false) render(opts.focusId);
    if (review) syncReview();
    return saved === 'reloaded' ? { ok: false, error: NOT_SAVED_CONFLICT } : result;
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
    if (result.ok) {
      shell.input.value = '';
      const label = QUADRANTS.find((info) => info.id === quadrantOf(flags))!.label;
      toaster.announce(`Added to ${label}`);
    } else shell.message.textContent = result.error;
    endTriage();
  }

  // ---- review ----

  function showReview() {
    if (!review) return;
    const current = taskOf(review.queue[review.index]!);
    renderPrompt(shell.prompt, review.triage, {
      title: current?.title ?? '',
      progress: reviewProgress(review),
    });
  }

  /** After any commit mid-review: skip queued tasks a click deleted or completed. */
  function syncReview() {
    if (!review) return;
    const settled = settleReview(review, state.tasks);
    if (settled === review) return;
    review = settled;
    if (review) showReview();
    else endReview('Review complete');
  }

  function startReviewMode() {
    if (triage || review) return;
    const started = startReview(state.tasks);
    if (!started) return toaster.announce('Nothing to review');
    review = started;
    reviewReturnId = rowOf(doc.activeElement)?.dataset.taskId;
    showReview();
    shell.prompt.region.focus();
  }

  function endReview(message?: string) {
    review = undefined;
    renderPrompt(shell.prompt, undefined);
    if (reviewReturnId && findRow(reviewReturnId)) focusRow(reviewReturnId);
    else focusCapture();
    reviewReturnId = undefined;
    if (message) toaster.announce(message);
  }

  function handleReviewKey(event: KeyboardEvent) {
    if (!review) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const outcome = reviewKey(review, event.key);
    if (outcome.kind === 'ignore') return;
    if (outcome.kind === 'cancel') return endReview();
    if (outcome.kind === 'continue') {
      review = outcome.review;
      return showReview();
    }
    const current = taskOf(outcome.id);
    if (current && quadrantOf(current) !== quadrantOf(outcome.flags)) {
      commit((tasks) => setFlags(tasks, outcome.id, outcome.flags, now()));
    }
    review = outcome.review && settleReview(outcome.review, state.tasks);
    if (review) showReview();
    else endReview('Review complete');
  }

  // ---- due dates ----

  function inTaskField(): boolean {
    const a = doc.activeElement;
    return a instanceof HTMLInputElement && root.contains(a) && a.matches('.task__when, .task__who, .task__edit');
  }

  /** Re-renders when the local day has changed, unless the user is in a field (then on focusout). */
  function recheckDue() {
    updateBackupStatus();
    if (today() === renderedToday) return;
    if (inTaskField()) {
      renderStale = true;
      return;
    }
    render();
  }

  function armMidnight() {
    if (midnightTimer !== undefined) timers.clearTimeout(midnightTimer);
    midnightTimer = timers.setTimeout(() => {
      recheckDue();
      armMidnight();
    }, msUntilMidnight(new Date(now())));
  }

  /** Saves a row's date or who. The field stays in place; only its stamps are refreshed. */
  function saveField(field: HTMLInputElement) {
    const rowEl = rowOf(field);
    const id = rowEl?.dataset.taskId;
    const current = id ? taskOf(id) : undefined;
    if (!rowEl || !id || !current) return;
    const isWhen = field.classList.contains('task__when');
    const result = commit(
      (tasks) => (isWhen ? setWhen(tasks, id, field.value || undefined, now()) : setWho(tasks, id, field.value, now())),
      { render: false },
    );
    const saved = taskOf(id) ?? current;
    shell.message.textContent = result.ok ? '' : result.error;
    // Only when it differs: writing a date input, even with its own value, wipes the parts of
    // a date the user is part-way through retyping (Chrome reports those as '').
    const shown = (isWhen ? saved.when : saved.who) ?? '';
    if (field.value !== shown) field.value = shown;
    refreshStamps(rowEl, saved, today());
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
    const before = reloads;
    const result = commit((tasks) => rename(tasks, current.id, current.draft, now()), { focusId: current.id });
    if (result.ok) return;
    if (reloads !== before) {
      // Refused as stale: reopen on the fresh data with the draft, so Enter tries again.
      if (!taskOf(current.id)) return;
      editing = { ...current, error: result.error };
      return render(current.id);
    }
    editing = { ...current, error: result.error };
    const msg = findRow(current.id)?.querySelector('.task__error');
    if (msg) msg.textContent = result.error;
  }

  // ---- removal and undo ----

  /**
   * Where focus goes once `removed` is gone: the next row of the anchor's quadrant, else
   * the previous one. Undefined means no row is left to take it.
   */
  function survivorNear(anchorId: string, removed: ReadonlySet<string>): string | undefined {
    const anchor = taskOf(anchorId);
    if (!anchor) return undefined;
    const rows = sortedFor(state.tasks, quadrantOf(anchor));
    const i = rows.findIndex((t) => t.id === anchorId);
    const keep = (t: Task) => !removed.has(t.id);
    return (rows.slice(i + 1).find(keep) ?? rows.slice(0, i).reverse().find(keep))?.id;
  }

  /** Applies a removal, saves, re-renders, moves focus and offers Undo. */
  function removeWith(op: (tasks: Task[]) => Removal, message: (removed: Task[]) => string, anchorId?: string) {
    const removal = op(state.tasks);
    const { removed } = removal.record;
    if (removed.length === 0) return false;
    const ids = new Set(removed.map((t) => t.id));
    const focusedId = rowOf(doc.activeElement)?.dataset.taskId;
    const anchor = focusedId && ids.has(focusedId) ? focusedId : anchorId;
    const focusId = anchor ? survivorNear(anchor, ids) : undefined;
    if (editing && ids.has(editing.id)) editing = undefined;

    const before = reloads;
    commit(() => ({ ok: true, value: removal.tasks }), { focusId });
    if (reloads !== before) return false; // refused as stale: nothing was removed, so no undo

    const active = doc.activeElement;
    const lost = !(active instanceof HTMLElement) || active === doc.body || active.hidden || !active.isConnected;
    if (!focusId && (anchor || lost)) focusCapture();
    toaster.show(message(removed), () => undoRemoval(removal.record));
    return true;
  }

  function undoRemoval(record: RemovalRecord) {
    const present = new Set(state.tasks.map((t) => t.id));
    const back = record.removed.filter((t) => !present.has(t.id));
    if (back.length === 0) return;
    const next = restore(state.tasks, record);
    const backIds = new Set(back.map((t) => t.id));
    const first = QUADRANTS.map((q) => sortedFor(next, q.id).find((t) => backIds.has(t.id))).find(Boolean);
    if (!commit(() => ({ ok: true, value: next }), { focusId: first?.id }).ok) return;
    toaster.show(back.length === 1 ? `Restored '${back[0]!.title}'` : `Restored ${back.length} tasks`);
  }

  function deleteTask(id: string) {
    return removeWith(
      (tasks) => {
        const r = removeOne(tasks, id);
        return r.ok ? r.value : { tasks, record: { removed: [], sequences: {} } };
      },
      ([t]) => `Deleted '${t!.title}'`,
      id,
    );
  }

  function clearDoneTasks() {
    return removeWith(clearDone, (r) => `Cleared ${plural(r.length, 'done task', 'done tasks')}`);
  }

  function dropAll() {
    return removeWith((tasks) => dropQuadrant(tasks, 'delete'), (r) => `Dropped ${plural(r.length, 'task', 'tasks')}`);
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
    if (action.type === 'review') {
      event.preventDefault();
      return startReviewMode();
    }
    if (action.type === 'undo') {
      // Only claim the key while an undo is on offer; otherwise leave it to the browser.
      if (toaster.undo()) event.preventDefault();
      return;
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
        return void commit((tasks) => reorderVisible(tasks, id, action.direction, now()), { focusId: id });
      case 'remove':
        event.preventDefault();
        return void deleteTask(id);
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
    if (transfer.handleKey(event)) return; // the import panel is modal: no shortcuts while it is open
    if (triage) return handleTriageKey(event);
    if (review) return handleReviewKey(event);
    if (event.defaultPrevented) return;
    const action = resolveKey(event);
    if (action) handleAction(action, event);
  }

  // One signal removes every listener in destroy(); renders never add listeners (delegation).
  const listening = new AbortController();
  const opts = { signal: listening.signal };
  const toaster = createToaster(shell.toast, timers, opts);

  // ---- export / import ----

  const transfer = createTransfer({
    root,
    footer: shell.footer,
    getState: () => state,
    now,
    download,
    writeBackup: (label, text) => storage.writeBackup(label, text),
    recordExport(at) {
      state = { ...state, lastExportAt: at };
      const saved = persist();
      if (saved === 'reloaded') render();
      updateBackupStatus();
      return saved;
    },
    replace(tasks, at) {
      state = { ...state, tasks, lastExportAt: at };
      editing = undefined;
      const saved = persist(); // a conflict reloads instead, so nothing is replaced
      render();
      if (review) syncReview();
      return saved;
    },
    announce: (message) => toaster.announce(message),
    announceImport: (message) => toaster.show(message), // replaces the toast, ending any undo
    signal: listening.signal,
  });

  shell.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || isComposing(event) || triage || review || transfer.isOpen()) return;
    event.preventDefault();
    startTriage();
  });
  shell.input.addEventListener('input', () => {
    shell.message.textContent = '';
  }, opts);

  root.addEventListener('keydown', (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement) || !t.classList.contains('task__edit') || isComposing(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editing) editing.draft = t.value;
      saveRename();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
  }, opts);
  root.addEventListener('input', (event) => {
    const t = event.target;
    if (editing && t instanceof HTMLInputElement && t.classList.contains('task__edit')) editing.draft = t.value;
  }, opts);
  root.addEventListener('change', (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.classList.contains('task__when') || t.classList.contains('task__who')) return saveField(t);
    if (!t.classList.contains('task__check')) return;
    const id = rowOf(t)?.dataset.taskId;
    if (id) commit((tasks) => toggleDone(tasks, id, now()), { focusId: id });
  }, opts);
  root.addEventListener('click', (event) => {
    const t = event.target instanceof Element ? event.target.closest<HTMLElement>('.task__move, .task__promote, .task__rename, .task__delete') : null;
    const id = rowOf(t)?.dataset.taskId;
    if (!t || !id) return;
    if (t.classList.contains('task__rename')) startRename(id);
    else if (t.classList.contains('task__delete')) deleteTask(id);
    else moveTask(id, t.dataset.move as Quadrant);
  }, opts);
  shell.clearDone.addEventListener('click', () => void clearDoneTasks(), opts);
  shell.banner.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('.banner__download') : null;
    const raw = button ? shownNotices[Number(button.dataset.notice)]?.raw : undefined;
    if (raw !== undefined) downloadText(raw, safeFilename('eisenhower-unreadable', now(), 'json'));
  }, opts);
  shell.dropAll.addEventListener('click', () => void dropAll(), opts);
  root.addEventListener('focusin', (event) => {
    const row = rowOf(event.target);
    const id = row?.dataset.taskId;
    const task = id ? taskOf(id) : undefined;
    if (!row || !task) return;
    tabStops[quadrantOf(task)] = id;
    for (const r of row.parentElement?.children ?? []) (r as HTMLElement).tabIndex = r === row ? 0 : -1;
  }, opts);
  root.addEventListener('focusout', (event) => {
    const next = event.relatedTarget;
    const stillInField = next instanceof Element && next.matches('.task__when, .task__who, .task__edit');
    if (renderStale && !stillInField) render(); // activeElement may not have moved yet, so not recheckDue()
  }, opts);
  doc.addEventListener('keydown', onDocKeydown, opts);
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return;
    recheckDue();
    armMidnight(); // a sleeping machine can leave the timer late
  }, opts);

  applyLoad(storage.load());
  const unsubscribe = storage.subscribe(onExternalChange);
  renderPrompt(shell.prompt, undefined);
  render();
  armMidnight();

  return {
    getState: () => state,
    commit,
    render,
    focusCapture,
    exportTasks: () => transfer.exportTasks(),
    importFile: (file) => transfer.importFile(file),
    deleteTask,
    clearDone: clearDoneTasks,
    dropAll,
    undo: () => toaster.undo(),
    shell,
    destroy: () => {
      listening.abort();
      unsubscribe();
      toaster.clear();
      if (midnightTimer !== undefined) timers.clearTimeout(midnightTimer);
    },
  };
}
