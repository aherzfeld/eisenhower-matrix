/** State to DOM. Emits the structure and class names in docs/design.md; no styling here. */
import { QUADRANTS, quadrantOf, type Quadrant } from '../core/quadrant';
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
  backupStatus: HTMLElement;
  lists: Record<Quadrant, HTMLUListElement>;
  counts: Record<Quadrant, HTMLElement>;
};

export type Editing = { id: string; draft: string; error?: string };

export type BoardView = {
  /** The id of each quadrant's single Tab stop. Falls back to the first task. */
  tabStops: Partial<Record<Quadrant, string>>;
  editing?: Editing;
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
  const mini = el('div', 'mini');
  mini.hidden = true;
  mini.setAttribute('aria-hidden', 'true');
  const squares = {} as Record<Quadrant, HTMLElement>;
  for (const q of QUADRANTS) {
    squares[q.id] = el('span', `mini__sq mini__sq--${q.id}`);
    mini.append(squares[q.id]);
  }
  region.append(question, keys, mini);

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
    section.append(band, el('p', 'q__verb', VERBS[q.id]), lists[q.id], el('footer', 'q__footer'));
    board.append(section);
  }

  const toast = el('div', 'toast-slot');
  const footer = el('footer', 'footer');
  const main = el('main', 'main');
  main.append(capture, region, board);
  root.replaceChildren(header, banner, main, toast, footer);

  return {
    input,
    capture,
    message,
    prompt: { region, question, mini, squares },
    banner,
    toast,
    footer,
    backupStatus,
    lists,
    counts,
  };
}

function renderTask(task: Task, tabStop: boolean, editing: Editing | undefined): HTMLLIElement {
  const li = el('li', 'task');
  li.dataset.taskId = task.id;
  li.dataset.done = String(task.done);
  li.tabIndex = tabStop ? 0 : -1;

  const check = el('input', 'task__check');
  check.type = 'checkbox';
  check.checked = task.done;
  check.tabIndex = -1;
  check.setAttribute('aria-label', `Done: ${task.title}`);
  li.append(check);

  if (editing) {
    const edit = el('input', 'task__edit');
    edit.type = 'text';
    edit.value = editing.draft;
    edit.setAttribute('aria-label', 'Rename task');
    li.append(edit);
    const error = el('span', 'task__error', editing.error ?? '');
    error.setAttribute('role', 'alert');
    li.append(error);
  } else {
    li.append(el('span', 'task__title', task.title));
  }

  if (!editing) {
    const renameButton = el('button', 'task__rename');
    renameButton.type = 'button';
    renameButton.tabIndex = -1;
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
    b.setAttribute('aria-label', `Move to ${q.label}`);
    b.append(chip(q.key));
    moves.append(b);
  }
  li.append(moves);
  return li;
}

/** Re-renders every list and count. Callers restore focus afterwards. */
export function renderBoard(shell: Shell, tasks: readonly Task[], view: BoardView): void {
  for (const q of QUADRANTS) {
    const sorted = sortedFor(tasks, q.id);
    const stopId = sorted.some((t) => t.id === view.tabStops[q.id]) ? view.tabStops[q.id] : sorted[0]?.id;
    shell.lists[q.id].replaceChildren(
      ...sorted.map((t) =>
        renderTask(t, t.id === stopId, view.editing?.id === t.id ? view.editing : undefined),
      ),
    );
    shell.counts[q.id].textContent = String(sorted.filter((t) => !t.done).length);
  }
}
