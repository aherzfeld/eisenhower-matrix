/**
 * The save format: serialize a StoredState to text, and parse untrusted text back into one.
 * Pure. Every task is checked by validate.ts, the same validators the edit operations use,
 * so anything the app can produce it can also load (AC13).
 */
import { quadrantOf, type Quadrant } from './quadrant';
import type { StoredState, Task } from './task';
import { validateTask, validateTimestamp } from './validate';

export const CURRENT_VERSION = 1;

/**
 * malformed: not JSON, the wrong shape, or a value that fails validation.
 * future-version: written by a newer build; the shape is unknown, so nothing else is checked.
 */
export type ParseError =
  | { kind: 'malformed'; message: string }
  | { kind: 'future-version'; version: number; message: string };

/** `migratedFrom` is present only when the stored version was older and migrations ran. */
export type ParseResult =
  | { ok: true; value: StoredState; migratedFrom?: number }
  | { ok: false; error: ParseError };

/** An untrusted, partly migrated document. */
export type Doc = Record<string, unknown>;
export type Migration = (doc: Doc) => Doc;

/**
 * Version 0 is the v1 shape without `rev` on the state or `order` on tasks.
 * Order is assigned per quadrant in array order. Bad values are carried through untouched
 * for validation to reject; a migration never throws and never invents data beyond its step.
 */
function v0ToV1(doc: Doc): Doc {
  if (!Array.isArray(doc.tasks)) return { ...doc, version: 1, rev: 0 };
  const next = new Map<Quadrant, number>();
  const tasks = doc.tasks.map((t: unknown) => {
    if (!isObject(t)) return t;
    const q = quadrantOf({ urgent: t.urgent === true, important: t.important === true });
    const order = next.get(q) ?? 0;
    next.set(q, order + 1);
    return { ...t, order };
  });
  return { ...doc, version: 1, rev: 0, tasks };
}

/** MIGRATIONS[n] turns a version-n document into version n + 1. */
export const MIGRATIONS: readonly Migration[] = [v0ToV1];

/** Runs every step from `fromVersion` up to the end of `steps`. */
export function migrate(doc: Doc, fromVersion: number, steps: readonly Migration[] = MIGRATIONS): Doc {
  let out = doc;
  for (let v = fromVersion; v < steps.length; v++) out = steps[v]!(out);
  return out;
}

/** Task fields in a fixed order, so the same state always serializes to the same text. */
const TASK_KEYS = [
  'id',
  'title',
  'urgent',
  'important',
  'done',
  'order',
  'createdAt',
  'updatedAt',
  'when',
  'who',
] as const satisfies readonly (keyof Task)[];

export function serialize(state: StoredState): string {
  const tasks = state.tasks.map((t) => Object.fromEntries(TASK_KEYS.map((k) => [k, t[k]])));
  return JSON.stringify({
    version: state.version,
    rev: state.rev,
    ...(state.lastExportAt === undefined ? {} : { lastExportAt: state.lastExportAt }),
    tasks,
  });
}

/** Never throws. */
export function parse(raw: string): ParseResult {
  try {
    return parseDocument(raw);
  } catch {
    return malformed('The saved data could not be read.');
  }
}

function parseDocument(raw: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return malformed('The saved data is not valid JSON.');
  }
  if (!isObject(doc)) return malformed('The saved data is not a board.');

  const version = doc.version;
  if (version === undefined) return malformed('The saved data has no version.');
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return malformed('The saved data has an unknown version.');
  }
  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      error: {
        kind: 'future-version',
        version,
        message: `Saved by a newer version (format ${version}; this build reads up to ${CURRENT_VERSION}).`,
      },
    };
  }

  const state = validateState(migrate(doc, version));
  if (!state.ok) return state;
  return version < CURRENT_VERSION
    ? { ok: true, value: state.value, migratedFrom: version }
    : { ok: true, value: state.value };
}

function validateState(doc: Doc): { ok: true; value: StoredState } | { ok: false; error: ParseError } {
  if (doc.version !== CURRENT_VERSION) return malformed('The saved data has an unknown version.');
  const rev = doc.rev;
  if (typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 0) {
    return malformed('The saved data has no valid revision number.');
  }
  if (!Array.isArray(doc.tasks)) return malformed('The saved data has no task list.');

  const tasks: Task[] = [];
  const ids = new Set<string>();
  for (const [i, input] of doc.tasks.entries()) {
    const t = validateTask(input);
    if (!t.ok) return malformed(`Task ${i + 1}: ${t.error}`);
    if (ids.has(t.value.id)) return malformed(`Task ${i + 1}: duplicate id ${t.value.id}.`);
    ids.add(t.value.id);
    tasks.push(t.value);
  }

  const state: StoredState = { version: CURRENT_VERSION, rev, tasks };
  if ('lastExportAt' in doc) {
    const at = validateTimestamp(doc.lastExportAt);
    if (!at.ok) return malformed(`Last export time: ${at.error}`);
    state.lastExportAt = at.value;
  }
  return { ok: true, value: state };
}

function malformed(message: string): { ok: false; error: ParseError } {
  return { ok: false, error: { kind: 'malformed', message } };
}

function isObject(v: unknown): v is Doc {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
