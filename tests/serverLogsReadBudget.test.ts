/**
 * Firestore bill audit, 2026-11-21: `server_logs` was 71% of the bill — ~5,500 document reads per call, 8,160
 * calls a month, from `/api/warm` (Cloud Scheduler, every 5 min) and the admin Monitor's log panel. Both
 * asked for a handful of newest lines with no filter, and the index-free helper behind `logStore.query`
 * turned a full first page into a document-id scan of up to 5,000 more documents.
 *
 * These tests run the real query against a fake Firestore that COUNTS the documents it hands out, so the
 * class — "a log read costs more than it returns" — fails here whichever way it comes back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  queryServerLogs, collectNewestMatching, logLimit, toLogEntry,
  LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT, LOG_FILTER_SCAN_BUDGET, LOG_RETENTION_DAYS, LOG_TTL_FIELD,
  type LogEntry,
} from '../src/server/lib/logStore';
import { listEqNewestFirst } from '../src/server/lib/firestoreIndexSafe';

type Row = Record<string, unknown> & { __id: string };

/** A tiny Firestore query fake: where / orderBy / startAfter / limit / get, counting every document returned. */
function fakeDb(rows: Row[]) {
  const meter = { reads: 0, queries: 0 };
  type Q = { filters: Array<[string, string, unknown]>; order: Array<[string, 'asc' | 'desc']>; after: Row | null; lim: number | null };
  const keyOf = (f: unknown) => (typeof f === 'string' ? f : '__name__');
  const val = (r: Row, k: string) => (k === '__name__' ? r.__id : r[k]);
  const make = (q: Q): any => ({
    where: (f: unknown, op: string, v: unknown) => make({ ...q, filters: [...q.filters, [keyOf(f), op, v]] }),
    orderBy: (f: unknown, dir: 'asc' | 'desc' = 'asc') => make({ ...q, order: [...q.order, [keyOf(f), dir]] }),
    startAfter: (snap: { __row: Row }) => make({ ...q, after: snap.__row }),
    limit: (n: number) => make({ ...q, lim: n }),
    select: () => make(q),
    async get() {
      meter.queries += 1;
      let out = rows.filter((r) => q.filters.every(([k, op, v]) => {
        const x = val(r, k) as any;
        return op === '==' ? x === v : op === '>=' ? x >= (v as any) : op === '<' ? x < (v as any) : op === '>' ? x > (v as any) : false;
      }));
      if (q.order.length) {
        out = [...out].sort((a, b) => {
          for (const [k, dir] of q.order) {
            const x = val(a, k) as any; const y = val(b, k) as any;
            if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
          }
          return 0;
        });
      }
      if (q.after) { const i = out.indexOf(q.after); out = out.slice(i + 1); }
      if (q.lim !== null) out = out.slice(0, q.lim);
      meter.reads += out.length;
      const docs = out.map((r) => ({ id: r.__id, __row: r, data: () => { const { __id, ...d } = r; return d; } }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });
  const db = { collection: () => make({ filters: [], order: [], after: null, lim: null }) };
  return { db: db as any, meter };
}

/** 20,000 lines, newest last by `ts`; every 1,000th is an `error`, a few belong to workspace w1. */
function manyLogs(n = 20_000): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    __id: `id${String((i * 7919) % n).padStart(6, '0')}`,
    id: `l${i}`, ts: 1_000_000 + i, level: i % 1000 === 0 ? 'error' : 'info', event: 'e',
    ...(i === 5 || i === 19_990 ? { workspaceId: 'w1' } : {}),
  }));
}

describe('a server_logs read costs what it returns', () => {
  it('the warm step (limit 1, no filter) reads exactly one document — it read ~5,500', async () => {
    const { db, meter } = fakeDb(manyLogs());
    const page = await queryServerLogs(db, { limit: 1 });
    expect(page.entries.map((e) => e.ts)).toEqual([1_000_000 + 19_999]);
    expect(meter.reads).toBe(1);
  });

  it('the Monitor panel (limit 40) reads 40, newest first', async () => {
    const { db, meter } = fakeDb(manyLogs());
    const page = await queryServerLogs(db, { limit: 40 });
    expect(page.entries).toHaveLength(40);
    expect(page.entries[0].ts).toBeGreaterThan(page.entries[39].ts);
    expect(meter.reads).toBe(40);
    expect(page.complete).toBe(true);
  });

  it('no limit means the admin page size (50), and nothing returns more than 500', async () => {
    const { db, meter } = fakeDb(manyLogs());
    expect((await queryServerLogs(db, {})).entries).toHaveLength(LOG_DEFAULT_LIMIT);
    expect(meter.reads).toBe(LOG_DEFAULT_LIMIT);
    expect((await queryServerLogs(db, { limit: 10_000 })).entries).toHaveLength(LOG_MAX_LIMIT);
  });

  it('`since` narrows in Firestore, not after a big read', async () => {
    const { db, meter } = fakeDb(manyLogs());
    const page = await queryServerLogs(db, { since: 1_000_000 + 19_995, limit: 50 });
    expect(page.entries).toHaveLength(5);
    expect(meter.reads).toBe(5);
  });

  it('a filtered search stops at its budget and says it did not see everything', async () => {
    const { db, meter } = fakeDb(manyLogs());
    const page = await queryServerLogs(db, { workspaceId: 'w1', limit: 50 });
    expect(page.entries.map((e) => e.ts)).toEqual([1_000_000 + 19_990]); // the old one (i=5) is past the budget
    expect(meter.reads).toBeLessThanOrEqual(LOG_FILTER_SCAN_BUDGET);
    expect(page.scanned).toBe(meter.reads);
    expect(page.complete).toBe(false);
  });

  it('a filtered search that finds its `limit` stops reading at once', async () => {
    const { db, meter } = fakeDb(manyLogs());
    const page = await queryServerLogs(db, { level: 'error', limit: 1 });
    expect(page.entries.map((e) => e.ts)).toEqual([1_000_000 + 19_000]);
    expect(page.complete).toBe(true);
    expect(meter.reads).toBe(1_000); // the newest error is the 1,000th line; four pages of 250, then stop
  });

  it('a filtered search over a small log reaches the end and reports complete', async () => {
    const { db } = fakeDb(manyLogs(300));
    const page = await queryServerLogs(db, { workspaceId: 'w1' });
    expect(page.entries).toHaveLength(1);
    expect(page.complete).toBe(true);
  });

  it('REVERSION PROOF: the old route through listEqNewestFirst reads thousands for one line', async () => {
    const { db, meter } = fakeDb(manyLogs());
    await listEqNewestFirst(db.collection('server_logs'), [], 'ts', 1, 500, (_id, d) => d as unknown as LogEntry);
    expect(meter.reads).toBeGreaterThan(5_000);
  });

  it('logStore no longer uses the index-free scan helper', () => {
    const src = readFileSync('src/server/lib/logStore.ts', 'utf8');
    expect(src).not.toMatch(/import[^;]*listEqNewestFirst/);
  });
});

describe('collectNewestMatching never reads past its budget', () => {
  const pages = (n: number) => async (size: number, after: number | null) => {
    const start = after ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(size, n - start)) }, (_, i) => ({ ts: n - start - i, level: 'info' as const }));
    return { rows, next: rows.length ? start + rows.length : null };
  };
  it('budget 300 with no match ⇒ exactly 300 read, incomplete', async () => {
    const r = await collectNewestMatching(pages(10_000), () => false, 10, 300, 250);
    expect(r.scanned).toBe(300);
    expect(r.complete).toBe(false);
  });
  it('the end before the budget ⇒ complete', async () => {
    const r = await collectNewestMatching(pages(120), () => false, 10, 2_000, 50);
    expect(r).toMatchObject({ scanned: 120, complete: true });
  });
});

describe('retention: the TTL field and the purge agree', () => {
  it('LOG_RETENTION_DAYS is the server_logs retention policy', () => {
    const src = readFileSync('src/server/lib/DataRetentionManager.ts', 'utf8');
    const m = src.match(/collection: 'server_logs', ttlDays: (\d+)/);
    expect(Number(m?.[1])).toBe(LOG_RETENTION_DAYS);
  });
  it('every written line carries the TTL Timestamp, and the API never returns it', () => {
    const src = readFileSync('src/server/lib/logStore.ts', 'utf8');
    expect(src).toMatch(/\[LOG_TTL_FIELD\]: admin\.firestore\.Timestamp\.fromMillis\(ts \+ LOG_RETENTION_DAYS \* 86_400_000\)/);
    expect(toLogEntry({ id: 'a', ts: 1, level: 'info', event: 'e', [LOG_TTL_FIELD]: { seconds: 1 } })).not.toHaveProperty(LOG_TTL_FIELD);
  });
  it('logLimit clamps', () => {
    expect([logLimit(undefined), logLimit(0), logLimit(-5), logLimit(40), logLimit(9_999), logLimit(Number.NaN)])
      .toEqual([50, 1, 1, 40, 500, 50]);
  });
});
