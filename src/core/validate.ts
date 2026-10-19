/** The ONLY place validation lives. Task operations and the codec both use these. */
import type { Task } from './task';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const TITLE_MAX = 200;
export const WHO_MAX = 80;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });

export function validateTitle(input: unknown): Result<string> {
  if (typeof input !== 'string') return fail('Title must be text.');
  const title = input.trim();
  if (title.length < 1) return fail('Title is required.');
  if (title.length > TITLE_MAX) return fail(`Title must be at most ${TITLE_MAX} characters.`);
  return ok(title);
}

/** Empty or missing means "no who": the field is removed, not an error. */
export function validateWho(input: unknown): Result<string | undefined> {
  if (input === undefined) return ok(undefined);
  if (typeof input !== 'string') return fail('Who must be text.');
  const who = input.trim();
  if (who.length === 0) return ok(undefined);
  if (who.length > WHO_MAX) return fail(`Who must be at most ${WHO_MAX} characters.`);
  return ok(who);
}

/** A local calendar date, 'YYYY-MM-DD', that really exists. */
export function validateWhen(input: unknown): Result<string> {
  if (typeof input !== 'string') return fail('Date must be text.');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!m) return fail('Date must look like YYYY-MM-DD.');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // setUTCFullYear, not Date.UTC: Date.UTC maps years 0-99 to 1900-1999.
  const probe = new Date(0);
  probe.setUTCFullYear(y, mo - 1, d);
  const real =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
  return real ? ok(input) : fail('Date is not a real calendar date.');
}

export function validateOrder(input: unknown): Result<number> {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < 0) {
    return fail('Order must be a non-negative integer.');
  }
  return ok(input);
}

export function validateId(input: unknown): Result<string> {
  if (typeof input !== 'string' || input.length === 0) return fail('Id must be a non-empty string.');
  return ok(input);
}

export function validateTimestamp(input: unknown): Result<string> {
  if (typeof input !== 'string' || input.length === 0) return fail('Timestamp must be text.');
  if (Number.isNaN(Date.parse(input))) return fail('Timestamp is not a valid date-time.');
  return ok(input);
}

export function validateBoolean(input: unknown, name: string): Result<boolean> {
  return typeof input === 'boolean' ? ok(input) : fail(`${name} must be true or false.`);
}

/** Validates and normalises an untrusted value into a Task. Unknown fields are dropped. */
export function validateTask(input: unknown): Result<Task> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return fail('Task must be an object.');
  }
  const o = input as Record<string, unknown>;

  const id = validateId(o.id);
  if (!id.ok) return id;
  const title = validateTitle(o.title);
  if (!title.ok) return title;
  const urgent = validateBoolean(o.urgent, 'urgent');
  if (!urgent.ok) return urgent;
  const important = validateBoolean(o.important, 'important');
  if (!important.ok) return important;
  const done = validateBoolean(o.done, 'done');
  if (!done.ok) return done;
  const order = validateOrder(o.order);
  if (!order.ok) return order;
  const createdAt = validateTimestamp(o.createdAt);
  if (!createdAt.ok) return createdAt;
  const updatedAt = validateTimestamp(o.updatedAt);
  if (!updatedAt.ok) return updatedAt;
  const who = validateWho(o.who);
  if (!who.ok) return who;

  const task: Task = {
    id: id.value,
    title: title.value,
    urgent: urgent.value,
    important: important.value,
    done: done.value,
    order: order.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  };
  if (o.when !== undefined) {
    const when = validateWhen(o.when);
    if (!when.ok) return when;
    task.when = when.value;
  }
  if (who.value !== undefined) task.who = who.value;
  return ok(task);
}
