import { describe, it, expect } from 'vitest';
import { CURRENT_VERSION, MIGRATIONS, migrate, parse, serialize, type ParseResult } from './codec';
import {
  createTask,
  rename,
  reorder,
  setFlags,
  setWhen,
  setWho,
  toggleDone,
  type StoredState,
  type Task,
} from './task';
import { clearDone, dropQuadrant, removeOne, restore, type RemovalRecord } from './undo';
import type { Result } from './validate';

const T0 = '2026-10-19T12:00:00.000Z';

const task = (over: Partial<Task> = {}): Task => ({
  id: 'a',
  title: 'Write report',
  urgent: true,
  important: true,
  done: false,
  order: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const state = (over: Partial<StoredState> = {}): StoredState => ({
  version: 1,
  rev: 3,
  tasks: [task()],
  ...over,
});

function expectMalformed(r: ParseResult) {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe('malformed');
    expect(r.error.message.length).toBeGreaterThan(0);
  }
}

describe('serialize / parse', () => {
  it('round-trips a full state identically, reporting no migration', () => {
    const s = state({
      lastExportAt: T0,
      tasks: [task(), task({ id: 'b', order: 1, when: '2026-10-20', who: 'Sam', done: true })],
    });
    const r = parse(serialize(s));
    expect(r).toStrictEqual({ ok: true, value: s });
  });

  it('round-trips an empty board', () => {
    const s: StoredState = { version: 1, rev: 0, tasks: [] };
    expect(parse(serialize(s))).toStrictEqual({ ok: true, value: s });
  });

  it('writes the version, rev and tasks as JSON', () => {
    expect(JSON.parse(serialize(state()))).toMatchObject({ version: 1, rev: 3, tasks: [{ id: 'a' }] });
  });

  it('drops unknown top-level and task fields', () => {
    const raw = JSON.stringify({ ...state(), extra: 1, tasks: [{ ...task(), colour: 'red' }] });
    expect(parse(raw)).toStrictEqual({ ok: true, value: state() });
  });
});

describe('parse: malformed input', () => {
  it.each(['', 'not json', '{', '{"version":1,', 'undefined', 'NaN'])('rejects unparseable JSON %j', (raw) => {
    expectMalformed(parse(raw));
  });

  it.each(['null', '1', '"text"', 'true', '[]', '[{"version":1}]'])('rejects a non-object document %s', (raw) => {
    expectMalformed(parse(raw));
  });

  it('rejects tasks that are not an array', () => {
    expectMalformed(parse(JSON.stringify({ ...state(), tasks: {} })));
    expectMalformed(parse(JSON.stringify({ version: 1, rev: 0 })));
  });

  it.each([-1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 2])('rejects rev %j', (rev) => {
    expectMalformed(parse(JSON.stringify({ ...state(), rev })));
  });

  it('rejects a missing rev', () => {
    const { rev: _rev, ...rest } = state();
    void _rev;
    expectMalformed(parse(JSON.stringify(rest)));
  });

  it.each([5, 'yesterday', '2026-10-19', null])('rejects lastExportAt %j', (lastExportAt) => {
    expectMalformed(parse(JSON.stringify({ ...state(), lastExportAt })));
  });

  it('rejects a task that fails validation, naming the task', () => {
    const r = parse(JSON.stringify(state({ tasks: [task(), task({ id: 'b', title: '   ' })] })));
    expectMalformed(r);
    if (!r.ok) expect(r.error.message).toMatch(/task 2/i);
  });

  it.each<[string, unknown]>([
    ['a non-object task', 'x'],
    ['a 201-char title', task({ title: 'a'.repeat(201) })],
    ['an 81-char who', task({ who: 'a'.repeat(81) })],
    ['a non-date when', task({ when: '2026-02-30' })],
    ['a date-only createdAt', task({ createdAt: '2026-10-19' })],
    ['a string done flag', { ...task(), done: 'false' }],
    ['a negative order', task({ order: -1 })],
  ])('rejects %s', (_label, t) => {
    expectMalformed(parse(JSON.stringify({ ...state(), tasks: [t] })));
  });

  it('rejects duplicate ids', () => {
    const r = parse(JSON.stringify(state({ tasks: [task(), task({ order: 1 })] })));
    expectMalformed(r);
    if (!r.ok) expect(r.error.message).toMatch(/duplicate/i);
  });
});

describe('parse: versions', () => {
  it('accepts version 1 as current', () => {
    expect(CURRENT_VERSION).toBe(1);
    expect(parse(serialize(state())).ok).toBe(true);
  });

  it('treats a missing version as malformed: nothing this app wrote lacks one', () => {
    const { version: _v, ...rest } = state();
    void _v;
    expectMalformed(parse(JSON.stringify(rest)));
  });

  it.each(['1', '2', true, null, 1.5, -1])('treats version %j as malformed', (version) => {
    expectMalformed(parse(JSON.stringify({ ...state(), version })));
  });

  it.each([2, 99])('reports version %j as future-version without validating the rest', (version) => {
    const r = parse(JSON.stringify({ version, whatever: 'shape', tasks: 'not an array' }));
    expect(r).toMatchObject({ ok: false, error: { kind: 'future-version', version } });
  });

  it('migrates version 0, reporting where it migrated from', () => {
    const r = parse(V0_FIXTURE);
    expect(r).toStrictEqual({ ok: true, value: V0_AS_V1, migratedFrom: 0 });
  });

  it('a migrated state serializes as current and then parses without migrating', () => {
    const r = parse(V0_FIXTURE);
    if (!r.ok) throw new Error('fixture failed to parse');
    expect(parse(serialize(r.value))).toStrictEqual({ ok: true, value: V0_AS_V1 });
  });

  it('rejects a version 0 document that is still invalid after migrating', () => {
    const bad = JSON.parse(V0_FIXTURE) as { tasks: Record<string, unknown>[] };
    bad.tasks[0]!.title = '';
    expectMalformed(parse(JSON.stringify(bad)));
    expectMalformed(parse(JSON.stringify({ version: 0, tasks: 'nope' })));
    expectMalformed(parse(JSON.stringify({ version: 0, tasks: [null, 5] })));
  });
});

describe('migration runner', () => {
  it('has one step per version below the current one', () => {
    expect(MIGRATIONS).toHaveLength(CURRENT_VERSION);
  });

  it('runs the steps in order from the stored version', () => {
    const calls: number[] = [];
    const steps = [0, 1, 2].map((n) => (doc: Record<string, unknown>) => {
      calls.push(n);
      return { ...doc, version: n + 1, trail: [...(doc.trail as number[]), n] };
    });
    expect(migrate({ version: 1, trail: [] }, 1, steps)).toEqual({ version: 3, trail: [1, 2] });
    expect(calls).toEqual([1, 2]);
  });

  it('runs nothing for a current document', () => {
    const doc = { version: 1 };
    expect(migrate(doc, 1, [])).toBe(doc);
  });

  it('v0 → v1 adds rev 0 and per-quadrant order by array position', () => {
    const out = MIGRATIONS[0]!(JSON.parse(V0_FIXTURE) as Record<string, unknown>);
    expect(out.version).toBe(1);
    expect(out.rev).toBe(0);
    expect((out.tasks as Task[]).map((t) => [t.id, t.order])).toEqual([
      ['a', 0],
      ['b', 0],
      ['c', 1],
      ['d', 0],
    ]);
  });
});

describe('parse never throws', () => {
  it('on random strings and random JSON values', () => {
    const rnd = rng(7);
    const alphabet = '{}[]":,0123456789.-eE truefalsnul\\"version"tasks"';
    for (let i = 0; i < 2000; i++) {
      const len = Math.floor(rnd() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(() => parse(s)).not.toThrow();
      expect(() => parse(JSON.stringify(randomJson(rnd, 3)))).not.toThrow();
    }
  });

  it('on single-field corruptions of a valid document; whatever it accepts is a fixed point', () => {
    const rnd = rng(11);
    const base = state({ lastExportAt: T0, tasks: [task({ when: '2026-10-20', who: 'Sam' })] });
    const fields = [...Object.keys(base), ...Object.keys(base.tasks[0]!).map((k) => `task.${k}`)];
    for (const f of fields) {
      for (let i = 0; i < 30; i++) {
        const bad = randomJson(rnd, 2);
        const doc = structuredClone(base) as unknown as Record<string, unknown> & { tasks: Record<string, unknown>[] };
        if (f.startsWith('task.')) doc.tasks[0]![f.slice(5)] = bad;
        else doc[f] = bad;
        let r: ParseResult | undefined;
        expect(() => (r = parse(JSON.stringify(doc))), `${f} = ${JSON.stringify(bad)}`).not.toThrow();
        if (r?.ok) expect(parse(serialize(r.value))).toStrictEqual({ ok: true, value: r.value });
      }
    }
  });
});

describe('AC13: anything reachable through core ops round-trips', () => {
  it('serialize → parse is the identity over random op sequences', () => {
    const seen = { maxTasks: 0, when: 0, who: 0, done: 0, moved: 0, restored: 0 };
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = rng(seed);
      let tasks: Task[] = [];
      let nextId = 0;
      let lastRemoval: RemovalRecord | undefined;
      const steps = 1 + Math.floor(rnd() * 40);
      for (let i = 0; i < steps; i++) {
        const now = randomTimestamp(rnd);
        const pickId = () => (tasks.length && rnd() < 0.9 ? tasks[Math.floor(rnd() * tasks.length)]!.id : 'missing');
        let r: Result<Task[]>;
        switch (Math.floor(rnd() * 9)) {
          case 0:
            r = createTask(
              tasks,
              {
                title: randomText(rnd, 210),
                urgent: rnd() < 0.5,
                important: rnd() < 0.5,
                ...(rnd() < 0.3 ? { when: randomDate(rnd) } : {}),
                ...(rnd() < 0.3 ? { who: randomText(rnd, 90) } : {}),
              },
              { id: rnd() < 0.05 && tasks.length ? tasks[0]!.id : `id-${seed}-${nextId++}`, now },
            );
            break;
          case 1:
            r = rename(tasks, pickId(), randomText(rnd, 210), now);
            break;
          case 2:
            r = setFlags(tasks, pickId(), { urgent: rnd() < 0.5, important: rnd() < 0.5 }, now);
            break;
          case 3:
            r = setWhen(tasks, pickId(), rnd() < 0.3 ? undefined : randomDate(rnd), now);
            break;
          case 4:
            r = setWho(tasks, pickId(), randomText(rnd, 90), now);
            break;
          case 5:
            r = toggleDone(tasks, pickId(), now);
            break;
          case 6:
            r = reorder(tasks, pickId(), rnd() < 0.5 ? 'up' : 'down', now);
            break;
          case 7: {
            // A removal of each kind; the next undo restores the latest one, as the toast does.
            const kind = rnd();
            const one = removeOne(tasks, pickId());
            const removal =
              kind < 0.6 ? (one.ok ? one.value : undefined) : kind < 0.8 ? clearDone(tasks) : dropQuadrant(tasks, 'delete');
            if (removal) lastRemoval = removal.record;
            r = removal ? { ok: true, value: removal.tasks } : { ok: false, error: 'nothing removed' };
            break;
          }
          default: {
            const back = lastRemoval ? restore(tasks, lastRemoval) : tasks;
            if (back !== tasks) seen.restored++;
            r = { ok: true, value: back };
          }
        }
        if (r.ok) tasks = r.value;
      }
      const s: StoredState = {
        version: 1,
        rev: Math.floor(rnd() * 1000),
        ...(rnd() < 0.5 ? { lastExportAt: randomTimestamp(rnd) } : {}),
        tasks,
      };
      const raw = serialize(s);
      const back = parse(raw);
      expect(back, `seed ${seed}`).toStrictEqual({ ok: true, value: s });
      if (back.ok) expect(serialize(back.value)).toBe(raw);
      seen.maxTasks = Math.max(seen.maxTasks, tasks.length);
      seen.when += tasks.filter((t) => t.when).length;
      seen.who += tasks.filter((t) => t.who).length;
      seen.done += tasks.filter((t) => t.done).length;
      seen.moved += tasks.filter((t) => t.order > 0).length;
    }
    // The generator must actually reach interesting states, or the property proves little.
    expect(seen.maxTasks).toBeGreaterThan(8);
    for (const n of [seen.when, seen.who, seen.done, seen.moved, seen.restored]) expect(n).toBeGreaterThan(50);
  });
});

// ---- fixtures ----

/** A version 0 document: the v1 shape without `rev` on the state or `order` on tasks. */
const V0_FIXTURE = JSON.stringify({
  version: 0,
  lastExportAt: '2026-09-01T08:00:00.000Z',
  tasks: [
    { id: 'a', title: 'Pay rent', urgent: true, important: true, done: false, createdAt: T0, updatedAt: T0 },
    { id: 'b', title: 'Plan trip', urgent: false, important: true, done: false, when: '2026-11-01', createdAt: T0, updatedAt: T0 },
    { id: 'c', title: 'Read book', urgent: false, important: true, done: true, createdAt: T0, updatedAt: T0 },
    { id: 'd', title: 'Book venue', urgent: true, important: false, done: false, who: 'Sam', createdAt: T0, updatedAt: T0 },
  ],
});

const V0_AS_V1: StoredState = {
  version: 1,
  rev: 0,
  lastExportAt: '2026-09-01T08:00:00.000Z',
  tasks: [
    task({ id: 'a', title: 'Pay rent', order: 0 }),
    task({ id: 'b', title: 'Plan trip', urgent: false, when: '2026-11-01', order: 0 }),
    task({ id: 'c', title: 'Read book', urgent: false, done: true, order: 1 }),
    task({ id: 'd', title: 'Book venue', important: false, who: 'Sam', order: 0 }),
  ],
};

// ---- seeded generators (mulberry32) ----

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = ['a', 'Z', ' ', '\t', '\n', '"', '\\', '/', '<b>', 'é', '日本', '🙂', ' ', '\u0000', '__proto__', '{}', '\ud800'];

function randomText(rnd: () => number, max: number): string {
  if (rnd() < 0.05) return '';
  if (rnd() < 0.05) return 'x'.repeat(max);
  let s = '';
  const len = 1 + Math.floor(rnd() * 12);
  for (let i = 0; i < len; i++) s += PIECES[Math.floor(rnd() * PIECES.length)];
  return s;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function randomDate(rnd: () => number): string {
  if (rnd() < 0.05) return '2026-02-30'; // invalid: the op must reject it
  const y = rnd() < 0.1 ? Math.floor(rnd() * 100) : 1970 + Math.floor(rnd() * 130);
  return `${pad(y, 4)}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`;
}

function randomTimestamp(rnd: () => number): string {
  const ms = Math.floor(rnd() * 4102444800000); // 1970..2100
  const iso = new Date(ms).toISOString();
  const pick = rnd();
  if (pick < 0.6) return iso;
  if (pick < 0.8) return iso.replace(/\.\d{3}Z$/, 'Z');
  return iso.replace(/Z$/, `${rnd() < 0.5 ? '+' : '-'}${pad(Math.floor(rnd() * 24))}:${pad(Math.floor(rnd() * 60))}`);
}

function randomJson(rnd: () => number, depth: number): unknown {
  const k = Math.floor(rnd() * (depth > 0 ? 9 : 7));
  switch (k) {
    case 0:
      return null;
    case 1:
      return rnd() < 0.5;
    case 2:
      return Math.floor(rnd() * 10) - 3;
    case 3:
      return rnd() * 100;
    case 4:
      return randomText(rnd, 10);
    case 5:
      return '';
    case 6:
      return 'version';
    case 7:
      return Array.from({ length: Math.floor(rnd() * 3) }, () => randomJson(rnd, depth - 1));
    default:
      return Object.fromEntries(
        ['version', 'rev', 'tasks', 'id'].filter(() => rnd() < 0.5).map((key) => [key, randomJson(rnd, depth - 1)]),
      );
  }
}
