/** State to DOM. Emits the structure and class names in docs/design.md; no styling here. */
import { QUADRANTS, quadrantOf, type Quadrant } from '../core/quadrant';
import { isDue } from '../core/dates';
import type { Task } from '../core/task';
import type { PromptEls } from './capture';

export type Shell = {
  input: HTMLInputElement;
  capture: HTMLElement;
  message: HTMLElement;
  prompt: PromptEls;
  banner: HTMLElement;
  toast: HTMLElement;
  footer: HTMLElement;
  /** Shown only while some task is done. */
  clearDone: HTMLButtonElement;
  /** In the Delete quadrant's footer; shown only while that quadrant has tasks. */
  dropAll: HTMLButtonElement;
  backupStatus: HTMLElement;
  lists: Record<Quadrant, HTMLUListElement>;
  counts: Record<Quadrant, HTMLElement>;
  footers: Record<Quadrant, HTMLElement>;
};

export type Editing = { id: string; draft: string; error?: string };

/** A rejected date or Who? value's message, shown beside that field (#14). */
export type FieldError = { field: 'when' | 'who'; text: string };

export type BoardView = {
  /** The id of each quadrant's single Tab stop. Falls back to the first task. */
  tabStops: Partial<Record<Quadrant, string>>;
  editing?: Editing;
  /** Local 'YYYY-MM-DD'. Due status is derived from it on every render. */
  today: string;
  /** By task id. Shown only while the row still has that kind of field. */
  fieldErrors?: ReadonlyMap<string, FieldError>;
};

const VERBS: Record<Quadrant, string> = {
  do: 'DO IT NOW',
  schedule: 'PICK A DATE',
  delegate: 'HAND IT OFF',
  delete: 'LET IT GO',
};

const AXES: Record<Quadrant, string> = {
  do: 'Important · Urgent',
  schedule: 'Important · Not urgent',
  delegate: 'Not important · Urgent',
  delete: 'Not important · Not urgent',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function textButton(className: string, text: string): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.hidden = true;
  return b;
}

function chip(text: string, extra = ''): HTMLElement {
  const c = el('span', `key ${extra}`.trim(), text);
  c.setAttribute('aria-hidden', 'true');
  return c;
}

/** Open tasks first, then done; each group by `order`. */
export function sortedFor(tasks: readonly Task[], q: Quadrant): Task[] {
  return tasks
    .filter((t) => quadrantOf(t) === q)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.order - b.order);
}

/** Builds the static page structure once and returns handles to the parts that change. */
export function buildShell(root: HTMLElement): Shell {
  const header = el('header', 'header');
  header.append(el('h1', 'wordmark', 'Eisenhower'));
  const backupStatus = el('div', 'backup-status');
  header.append(backupStatus);

  const banner = el('div', 'banner-slot');
  banner.setAttribute('role', 'status'); // the live region exists before any warning is put in it

  const capture = el('div', 'capture');
  const input = el('input', 'capture__input');
  input.type = 'text';
  input.placeholder = 'What needs doing?';
  input.setAttribute('aria-label', 'New task');
  input.autocomplete = 'off';
  const slash = chip('/', 'capture__key');
  const message = el('p', 'capture__message');
  message.setAttribute('role', 'alert');
  capture.append(input, slash, message);

  const region = el('div', 'prompt');
  region.setAttribute('aria-live', 'assertive');
  region.tabIndex = -1;
  region.dataset.active = 'false';
  const question = el('p', 'prompt__question');
  const keys = el('p', 'prompt__keys');
  keys.append(chip('Y'), chip('N'));
  const detail = el('p', 'prompt__detail');
  const title = el('span', 'prompt__task');
  const progress = el('span', 'prompt__progress');
  detail.append(title, progress);
  const mini = el('div', 'mini');
  mini.hidden = true;
  mini.setAttribute('aria-hidden', 'true');
  const squares = {} as Record<Quadrant, HTMLElement>;
  for (const q of QUADRANTS) {
    squares[q.id] = el('span', `mini__sq mini__sq--${q.id}`);
    mini.append(squares[q.id]);
  }
  region.append(detail, question, keys, mini);

  const board = el('div', 'board');
  const axis = (cls: string, text: string) => {
    const a = el('span', `axis ${cls}`, text);
    a.setAttribute('aria-hidden', 'true');
    return a;
  };
  board.append(
    axis('axis--col axis--urgent', 'Urgent'),
    axis('axis--col axis--not-urgent', 'Not urgent'),
    axis('axis--row axis--important', 'Important'),
    axis('axis--row axis--not-important', 'Not important'),
  );
  const lists = {} as Record<Quadrant, HTMLUListElement>;
  const counts = {} as Record<Quadrant, HTMLElement>;
  const footers = {} as Record<Quadrant, HTMLElement>;
  for (const q of QUADRANTS) {
    const section = el('section', `q q--${q.id}`);
    const titleId = `q-${q.id}-title`;
    section.setAttribute('aria-labelledby', titleId);
    const band = el('div', 'q__band');
    const name = el('h2', 'q__name', q.label);
    name.id = titleId;
    counts[q.id] = el('span', 'q__count', '0');
    band.append(chip(q.key, 'q__key'), name, counts[q.id], el('span', 'q__axes', AXES[q.id]));
    lists[q.id] = el('ul', 'q__list');
    footers[q.id] = el('footer', 'q__footer');
    section.append(band, el('p', 'q__verb', VERBS[q.id]), lists[q.id], footers[q.id]);
    board.append(section);
  }

  const dropAll = textButton('q__drop', 'Drop all');
  footers.delete.append(dropAll);

  const toast = el('div', 'toast-slot');
  toast.setAttribute('role', 'status'); // announces removals and undos
  const footer = el('footer', 'footer');
  const clearDone = textButton('clear-done', 'Clear done');
  footer.append(clearDone);
  const main = el('main', 'main');
  main.append(capture, region, board);
  root.replaceChildren(header, banner, main, toast, footer);

  return {
    input,
    capture,
    message,
    prompt: { region, question, title, progress, mini, squares },
    banner,
    toast,
    footer,
    clearDone,
    dropAll,
    backupStatus,
    lists,
    counts,
    footers,
  };
}

/**
 * The stamps (and Due's "Move to Do" button) for one row. Rebuilt in place by refreshStamps
 * when a date or who changes, so a field being edited is never torn down under the user.
 */
function buildStamps(task: Task, today: string, isNext: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (isNext && !task.done) out.push(el('span', 'stamp stamp--next', 'Next'));
  if (isDue(task, today)) {
    out.push(el('span', 'stamp stamp--due', 'Due'));
    const promote = el('button', 'task__promote', 'Move to Do');
    promote.type = 'button';
    promote.tabIndex = -1;
    promote.dataset.move = 'do';
    promote.dataset.control = 'promote';
    promote.setAttribute('aria-label', `Move to Do: ${task.title}`);
    out.push(promote);
  }
  if (quadrantOf(task) === 'delegate' && task.who) {
    out.push(el('span', 'stamp stamp--waiting', `Waiting on ${task.who}`));
  }
  return out;
}

export function refreshStamps(li: HTMLElement, task: Task, today: string): void {
  const slot = li.querySelector('.task__stamps');
  if (!slot) return;
  const isNext = slot.querySelector('.stamp--next') !== null;
  slot.replaceChildren(...buildStamps(task, today, isNext));
}

/**
 * Each control in a row carries `data-control`, unique within the row and the same on every
 * render, so focus can be put back on a rebuilt row's matching control (#12).
 */
/** Unique ids for the field errors, so each field's aria-describedby names its own. */
let fieldErrorSeq = 0;

/** The message element for a date or Who? field, tied to it by aria-describedby. */
function fieldErrorFor(field: HTMLInputElement, text: string): HTMLElement {
  const msg = el('span', 'task__field-error', text);
  msg.id = `task-field-error-${++fieldErrorSeq}`;
  msg.setAttribute('role', 'alert');
  field.setAttribute('aria-describedby', msg.id);
  return msg;
}

function renderTask(
  task: Task,
  tabStop: boolean,
  editing: Editing | undefined,
  today: string,
  isNext: boolean,
  fieldError: FieldError | undefined,
): HTMLLIElement {
  const li = el('li', 'task');
  li.dataset.taskId = task.id;
  li.dataset.done = String(task.done);
  li.tabIndex = tabStop ? 0 : -1;

  const check = el('input', 'task__check');
  check.type = 'checkbox';
  check.checked = task.done;
  check.tabIndex = -1;
  check.dataset.control = 'check';
  check.setAttribute('aria-label', `Done: ${task.title}`);
  li.append(check);

  if (editing) {
    const edit = el('input', 'task__edit');
    edit.type = 'text';
    edit.value = editing.draft;
    edit.dataset.control = 'edit';
    edit.setAttribute('aria-label', 'Rename task');
    li.append(edit);
    const error = el('span', 'task__error', editing.error ?? '');
    error.setAttribute('role', 'alert');
    li.append(error);
  } else {
    li.append(el('span', 'task__title', task.title));
  }

  const stamps = el('span', 'task__stamps');
  stamps.append(...buildStamps(task, today, isNext));
  li.append(stamps);

  const quadrant = quadrantOf(task);
  if (quadrant === 'schedule') {
    const when = el('input', 'task__when');
    when.type = 'date';
    when.value = task.when ?? '';
    when.dataset.control = 'when';
    when.setAttribute('aria-label', `Date for ${task.title}`);
    li.append(when, fieldErrorFor(when, fieldError?.field === 'when' ? fieldError.text : ''));
  } else if (quadrant === 'delegate') {
    const who = el('input', 'task__who');
    who.type = 'text';
    who.placeholder = 'Who?';
    who.value = task.who ?? '';
    who.dataset.control = 'who';
    who.autocomplete = 'off';
    who.setAttribute('aria-label', `Who is handling ${task.title}`);
    li.append(who, fieldErrorFor(who, fieldError?.field === 'who' ? fieldError.text : ''));
  }

  if (!editing) {
    const renameButton = el('button', 'task__rename');
    renameButton.type = 'button';
    renameButton.tabIndex = -1;
    renameButton.dataset.control = 'rename';
    renameButton.setAttribute('aria-label', `Rename ${task.title}`);
    renameButton.append(chip('↵'));
    li.append(renameButton);
  }

  const moves = el('span', 'task__moves');
  for (const q of QUADRANTS) {
    const b = el('button', 'task__move');
    b.type = 'button';
    b.tabIndex = -1;
    b.dataset.move = q.id;
    b.dataset.control = `move-${q.id}`;
    b.setAttribute('aria-label', `Move to ${q.label}`);
    b.append(chip(q.key));
    moves.append(b);
  }
  li.append(moves);

  const del = el('button', 'task__delete');
  del.type = 'button';
  del.tabIndex = -1;
  del.dataset.control = 'delete';
  del.setAttribute('aria-label', `Delete ${task.title}`);
  del.append(chip('⌫'));
  li.append(del);
  return li;
}

/**
 * The task ids each list showed at its last render. Presentational only: a row that was not
 * there before gets `is-new`, which the stylesheet uses to print it in. Nothing on a list's
 * first render, so loading the page does not animate.
 */
const shownIds = new WeakMap<HTMLUListElement, ReadonlySet<string>>();

/** Re-renders every list and count. Callers restore focus afterwards. */
export function renderBoard(shell: Shell, tasks: readonly Task[], view: BoardView): void {
  for (const q of QUADRANTS) {
    const sorted = sortedFor(tasks, q.id);
    const stopId = sorted.some((t) => t.id === view.tabStops[q.id]) ? view.tabStops[q.id] : sorted[0]?.id;
    const list = shell.lists[q.id];
    const before = shownIds.get(list);
    list.replaceChildren(
      ...sorted.map((t) => {
        const li = renderTask(
          t,
          t.id === stopId,
          view.editing?.id === t.id ? view.editing : undefined,
          view.today,
          q.id === 'do' && t.id === sorted[0]?.id,
          view.fieldErrors?.get(t.id),
        );
        if (before && !before.has(t.id)) li.classList.add('is-new');
        return li;
      }),
    );
    shownIds.set(list, new Set(sorted.map((t) => t.id)));
    shell.counts[q.id].textContent = String(sorted.filter((t) => !t.done).length);
    if (q.id === 'delete') shell.dropAll.hidden = sorted.length === 0;
  }
  shell.clearDone.hidden = !tasks.some((t) => t.done);
}
