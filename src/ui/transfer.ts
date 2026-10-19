/**
 * Export and import (T11, AC6). Owns the footer's `.transfer` controls and the import
 * confirmation panel. The board's state and its saving stay with the app controller, which
 * passes in what this needs. Import follows the plan's Data safety row: validate, confirm,
 * then (1) back up the current board, aborting if that fails, (2) download it as a bonus,
 * (3) replace through the normal save path.
 */
import { parse, serialize, type ParseError } from '../core/codec';
import { localToday } from '../core/dates';
import type { StoredState } from '../core/task';

/** How a save through the app's normal path ended (see app.ts `persist`). */
export type SaveOutcome = 'saved' | 'failed' | 'reloaded';

export type TransferDeps = {
  /** The app root: everything in it outside the panel is made inert while the panel is open. */
  root: HTMLElement;
  footer: HTMLElement;
  getState(): StoredState;
  /** ISO timestamp. */
  now(): string;
  download(text: string, filename: string): void;
  writeBackup(label: string, text: string): boolean;
  /** Sets `lastExportAt` and saves. */
  recordExport(at: string): SaveOutcome;
  /** Replaces the tasks (keeping this tab's rev), sets `lastExportAt`, saves and re-renders. */
  replace(tasks: StoredState['tasks'], at: string): SaveOutcome;
  /** A plain status message. */
  announce(message: string): void;
  /** Announces a successful import and ends any undo window. */
  announceImport(message: string): void;
  signal: AbortSignal;
};

export type Transfer = {
  isOpen(): boolean;
  /**
   * Gives the panel first claim on every keydown. True while the panel is open: the key is the
   * panel's (Escape cancels, Tab stays inside) and nothing else may act on it.
   */
  handleKey(event: KeyboardEvent): boolean;
  exportTasks(): void;
  /** Reads and validates `file`, then shows the confirmation (or why it was rejected). */
  importFile(file: File): Promise<void>;
};

export const BACKUP_FAILED = "Nothing was imported: your current tasks couldn't be backed up first.";
export const IMPORT_CONFLICT = 'Changed in another tab, so nothing was imported. Check the board, then try again.';
export const UNREADABLE_FILE = "The file couldn't be read.";
const TEXT_ID = 'import-confirm-text';

const tasks = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`;

/** `eisenhower-YYYY-MM-DD.json`, by the local calendar date. */
export function exportFilename(nowIso: string): string {
  return `eisenhower-${localToday(new Date(nowIso))}.json`;
}

/** The codec speaks of "saved data"; here it is a file the user picked. */
export function importError(error: ParseError): string {
  if (error.kind === 'future-version') {
    return `This file was saved by a newer version of the app (format ${error.version}), so it can't be imported here.`;
  }
  return error.message.replace(/^The saved data/, 'The file');
}

export function confirmText(current: number, incoming: number, filename: string): string {
  return `Replace your ${tasks(current)} with ${tasks(incoming)} from ${filename}? Your current tasks are backed up first.`;
}

type Panel = {
  el: HTMLElement;
  text: HTMLElement;
  error: HTMLElement;
  replace: HTMLButtonElement;
  cancel: HTMLButtonElement;
};

export function createTransfer(deps: TransferDeps): Transfer {
  const doc = deps.footer.ownerDocument;
  const button = (className: string, label: string) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    return b;
  };

  const wrap = doc.createElement('div');
  wrap.className = 'transfer';
  const exportButton = button('transfer__export', 'Export');
  const importButton = button('transfer__import', 'Import');
  const input = doc.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.className = 'transfer__file';
  input.hidden = true; // the Import button is the control; this only opens the picker
  input.tabIndex = -1;
  wrap.append(exportButton, importButton, input);
  deps.footer.append(wrap);

  let panel: Panel | undefined;
  /** The file's validated board, while the confirmation offers it. */
  let pending: { state: StoredState; name: string } | undefined;
  let inerted: Element[] = [];

  function exportTasks() {
    const state = deps.getState();
    const at = deps.now();
    try {
      deps.download(serialize(state), exportFilename(at));
    } catch {
      return deps.announce("Export failed: the file couldn't be downloaded.");
    }
    const n = state.tasks.length;
    if (deps.recordExport(at) === 'saved') deps.announce(`Exported ${tasks(n)}`);
    else deps.announce(`Downloaded ${tasks(n)}, but the backup time couldn't be saved.`);
  }

  /** Makes every element outside the panel inert, level by level up to the root. */
  function inertOutside(el: HTMLElement) {
    for (let node: HTMLElement = el; node !== deps.root && node.parentElement; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.hasAttribute('inert')) continue;
        sibling.setAttribute('inert', '');
        inerted.push(sibling);
      }
    }
  }

  function buildPanel(): Panel {
    const el = doc.createElement('div');
    el.className = 'import-confirm';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', TEXT_ID);
    const text = doc.createElement('p');
    text.className = 'import-confirm__text';
    text.id = TEXT_ID;
    const error = doc.createElement('p');
    error.className = 'import-confirm__error';
    error.setAttribute('role', 'alert');
    const replace = button('import-confirm__replace', 'Replace');
    const cancel = button('import-confirm__cancel', 'Cancel');
    replace.addEventListener('click', confirmReplace);
    cancel.addEventListener('click', close);
    el.append(text, error, replace, cancel);
    return { el, text, error, replace, cancel };
  }

  function open(text: string, error = '') {
    if (!panel) {
      panel = buildPanel();
      wrap.append(panel.el);
      inertOutside(panel.el);
    }
    panel.text.textContent = text;
    panel.error.textContent = error;
    panel.replace.hidden = pending === undefined;
    panel.cancel.focus(); // the safe choice has focus
  }

  function close() {
    pending = undefined;
    panel?.el.remove();
    panel = undefined;
    for (const el of inerted) el.removeAttribute('inert');
    inerted = [];
    importButton.focus();
  }

  async function importFile(file: File) {
    const name = file.name || 'this file';
    let text: string;
    try {
      text = await file.text();
    } catch {
      pending = undefined;
      return open(`Can't import ${name}.`, UNREADABLE_FILE);
    }
    const parsed = parse(text);
    if (!parsed.ok) {
      pending = undefined;
      return open(`Can't import ${name}.`, importError(parsed.error));
    }
    pending = { state: parsed.value, name };
    open(confirmText(deps.getState().tasks.length, parsed.value.tasks.length, name));
  }

  function confirmReplace() {
    if (!pending || !panel) return;
    const current = serialize(deps.getState());
    // (1) The current board is backed up before anything else, or nothing happens.
    if (!deps.writeBackup('pre-import', current)) {
      panel.error.textContent = BACKUP_FAILED;
      return;
    }
    const at = deps.now();
    // (2) A copy outside the browser too. A bonus: a failed download does not stop the import.
    try {
      deps.download(current, exportFilename(at));
    } catch {
      // the backup key above already holds it
    }
    // (3) Replace, through the normal save path and its rev check.
    const { tasks: incoming } = pending.state;
    const outcome = deps.replace(incoming, at);
    if (outcome === 'reloaded') {
      // Another tab saved first: the board was reloaded instead, and nothing replaced.
      panel.text.textContent = confirmText(deps.getState().tasks.length, incoming.length, pending.name);
      panel.error.textContent = IMPORT_CONFLICT;
      return;
    }
    close();
    deps.announceImport(
      outcome === 'saved' ? `Imported ${tasks(incoming.length)}` : `Imported ${tasks(incoming.length)}, but they aren't saved.`,
    );
  }

  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return [panel.replace, panel.cancel].filter((b) => !b.hidden);
  }

  function handleKey(event: KeyboardEvent): boolean {
    if (!panel) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const items = focusables();
      const i = items.indexOf(doc.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      items[(i + step + items.length) % items.length]?.focus();
    }
    return true;
  }

  const opts = { signal: deps.signal };
  exportButton.addEventListener('click', exportTasks, opts);
  importButton.addEventListener('click', () => input.click(), opts);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again still fires change
    if (file) void importFile(file);
  }, opts);

  return { isOpen: () => panel !== undefined, handleKey, exportTasks, importFile };
}
