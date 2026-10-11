// P-MON.1 — Server-side product-analytics pipeline.
//
// `/api/analytics/event` previously only console.log'd events — no aggregation, no funnels. This adds a
// real server-side rollup: events increment a daily aggregate doc (per-event counts + the
// activation funnel signup→build→deploy→pay), race-safe via Firestore FieldValue.increment, plus a
// bounded raw-event log — buffered per instance and written once per flush (see `AnalyticsBuffer`). Funnel/cohort queries read the daily rollups. Pure helpers (stage mapping,
// funnel aggregation) are unit-tested; the store is best-effort + VITEST-skip (never throws).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const DAILY_COLLECTION = 'analytics_daily';
const EVENTS_COLLECTION = 'analytics_events';

export type FunnelStage = 'signup' | 'build' | 'deploy' | 'pay';
export const FUNNEL_ORDER: FunnelStage[] = ['signup', 'build', 'deploy', 'pay'];

export interface DailyAnalytics {
  date: string;
  totalEvents: number;
  events: Record<string, number>;
  funnel: Record<FunnelStage, number>;
}

export interface FunnelResult {
  stages: Record<FunnelStage, number>;
  /** Stage-to-stage conversion rate (0..1), e.g. conversion.build = build/signup. */
  conversion: Record<FunnelStage, number>;
}

/** Map a raw event name to an activation-funnel stage (or null if it isn't a funnel event). Pure. */
export function funnelStage(event: string): FunnelStage | null {
  const e = String(event || '').toLowerCase();
  if (/(sign[_-]?up|signup|register|account[_-]?created)/.test(e)) return 'signup';
  if (/(build[_-]?start|build[_-]?created|app[_-]?build|generate[_-]?app|^build$)/.test(e)) return 'build';
  if (/(deploy|publish|go[_-]?live)/.test(e)) return 'deploy';
  if (/(pay|purchase|subscribe|checkout|upgrade[_-]?pro|billing[_-]?success)/.test(e)) return 'pay';
  return null;
}

/** Firestore-field-safe event key (no dots/slashes; bounded). Pure. */
export function sanitizeEventKey(event: string): string {
  return String(event || 'unknown').replace(/[.$/[\]#]/g, '_').slice(0, 80) || 'unknown';
}

/** Pure: aggregate a set of daily docs into the funnel + conversion rates. */
export function funnelFromDaily(dailies: Array<Partial<DailyAnalytics> | null | undefined>): FunnelResult {
  const stages: Record<FunnelStage, number> = { signup: 0, build: 0, deploy: 0, pay: 0 };
  for (const d of dailies) {
    const f = d?.funnel;
    if (!f) continue;
    for (const s of FUNNEL_ORDER) stages[s] += typeof f[s] === 'number' ? f[s] : 0;
  }
  const conversion: Record<FunnelStage, number> = { signup: 1, build: 0, deploy: 0, pay: 0 };
  conversion.signup = 1;
  conversion.build = stages.signup > 0 ? stages.build / stages.signup : 0;
  conversion.deploy = stages.build > 0 ? stages.deploy / stages.build : 0;
  conversion.pay = stages.deploy > 0 ? stages.pay / stages.deploy : 0;
  return { stages, conversion };
}

/** Pure: the UTC YYYY-MM-DD bucket for a timestamp. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/**
 * 🔴 ONE DAILY DOCUMENT, WRITTEN ONCE PER FLUSH — NOT ONCE PER EVENT (performance audit 2026-10-11, D8).
 *
 * Every event used to `set(..., {merge:true})` the SAME `analytics_daily/{date}` document and then `add()` a raw
 * row, two Firestore writes per page view on an unauthenticated route with no limiter. Firestore sustains about
 * one write per second on a single document; past that, writes to it queue and fail with contention, so the
 * busiest day — the one worth measuring — was the day the rollup lost counts. Now each instance folds events
 * into an in-process buffer and writes ONE merged increment per (day) every `FLUSH_INTERVAL_MS`, plus the raw
 * rows in batches of at most `MAX_RAW_PER_FLUSH` (under Firestore's 500-write batch limit). Raw rows past that
 * bound are still COUNTED in the rollup and the overflow is recorded as `rawDropped`, so the numbers never lie
 * about what was kept.
 *
 * Pure apart from the writer it is handed, so tests drive it without Firestore.
 */
export const FLUSH_INTERVAL_MS = 10_000;
/** Raw rows kept per flush per instance. The rollup counts every event regardless. */
export const MAX_RAW_PER_FLUSH = 400;
/** Distinct (day, event) keys held before an early flush — bounds the buffer's memory. */
export const MAX_BUFFERED_KEYS = 2_000;

export interface RawAnalyticsRow { event: string; userId: string; sessionId: string; stage: string; ts: number }

export interface DailyDelta {
  date: string;
  totalEvents: number;
  events: Record<string, number>;
  funnel: Partial<Record<FunnelStage, number>>;
  rawDropped: number;
}

export interface AnalyticsFlush { dailies: DailyDelta[]; raw: RawAnalyticsRow[] }

/** Folds events in memory; `drain()` hands back one delta per day and the raw rows to keep. */
export class AnalyticsBuffer {
  private dailies = new Map<string, DailyDelta>();
  private raw: RawAnalyticsRow[] = [];
  private keys = 0;

  add(row: RawAnalyticsRow, date: string): void {
    let d = this.dailies.get(date);
    if (!d) {
      d = { date, totalEvents: 0, events: {}, funnel: {}, rawDropped: 0 };
      this.dailies.set(date, d);
    }
    d.totalEvents += 1;
    if (d.events[row.event] === undefined) this.keys += 1;
    d.events[row.event] = (d.events[row.event] ?? 0) + 1;
    if (row.stage) {
      const s = row.stage as FunnelStage;
      d.funnel[s] = (d.funnel[s] ?? 0) + 1;
    }
    if (this.raw.length < MAX_RAW_PER_FLUSH) this.raw.push(row);
    else d.rawDropped += 1;
  }

  /** True when the buffer should be flushed early, before the timer, to stay bounded. */
  get full(): boolean {
    return this.keys >= MAX_BUFFERED_KEYS;
  }

  get pending(): number {
    let n = 0;
    for (const d of this.dailies.values()) n += d.totalEvents;
    return n;
  }

  drain(): AnalyticsFlush {
    const out = { dailies: [...this.dailies.values()], raw: this.raw };
    this.dailies = new Map();
    this.raw = [];
    this.keys = 0;
    return out;
  }
}

/** The Firestore update for one day's delta: every count an atomic increment, so instances never overwrite. */
export function dailyUpdateFor(d: DailyDelta, inc: (n: number) => unknown, now: number): Record<string, unknown> {
  const update: Record<string, unknown> = { date: d.date, totalEvents: inc(d.totalEvents), updatedAt: now };
  for (const [k, n] of Object.entries(d.events)) update[`events.${k}`] = inc(n);
  for (const [s, n] of Object.entries(d.funnel)) if (n) update[`funnel.${s}`] = inc(n);
  if (d.rawDropped > 0) update.rawDropped = inc(d.rawDropped);
  return update;
}

/** Turns one request's input into a raw row and its day. Null for an event with no name. Pure. */
export function analyticsRowFor(input: { event?: unknown; userId?: unknown; sessionId?: unknown; ts?: unknown }, now: number): { row: RawAnalyticsRow; date: string } | null {
  const event = typeof input?.event === 'string' ? input.event : '';
  if (!event) return null;
  // A client clock is trusted only within a day of ours: a wild `ts` must not open a rollup document for 1970
  // or 2999 that the funnel would then read as a real day.
  const ts = typeof input.ts === 'number' && Number.isFinite(input.ts) && Math.abs(input.ts - now) < 86_400_000 ? input.ts : now;
  const stage = funnelStage(event);
  return {
    date: dayKey(ts),
    row: {
      event: sanitizeEventKey(event),
      userId: typeof input.userId === 'string' && input.userId ? input.userId.slice(0, 128) : 'anon',
      sessionId: typeof input.sessionId === 'string' ? input.sessionId.slice(0, 128) : '',
      stage: stage || '',
      ts,
    },
  };
}

const buffer = new AnalyticsBuffer();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

/** Write what the buffer holds: one merged write per day, raw rows in one batch. Never throws. */
export async function flushAnalytics(): Promise<void> {
  // One write in flight at a time. What arrives meanwhile stays buffered and is rescheduled when it lands.
  if (flushing) return flushing;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const { dailies, raw } = buffer.drain();
  if (dailies.length === 0) return;
  const db = getDb();
  if (!db) return;
  flushing = (async () => {
    try {
      const inc = (n: number) => admin.firestore.FieldValue.increment(n);
      const now = Date.now();
      const batch = db.batch();
      for (const d of dailies) batch.set(db.collection(DAILY_COLLECTION).doc(d.date), dailyUpdateFor(d, inc, now), { merge: true });
      for (const r of raw) batch.set(db.collection(EVENTS_COLLECTION).doc(), r);
      await batch.commit();
    } catch {
      /* best-effort — analytics never breaks the request */
    } finally {
      flushing = null;
      if (buffer.pending > 0) scheduleFlush();
    }
  })();
  return flushing;
}

/** Record one analytics event. Buffered in-process and written by the next flush. Never throws. */
export async function recordAnalyticsEvent(input: {
  event: string;
  userId?: string;
  sessionId?: string;
  props?: Record<string, unknown>;
  ts?: number;
}): Promise<void> {
  const r = analyticsRowFor(input, Date.now());
  if (!r) return;
  if (!getDb()) return;
  buffer.add(r.row, r.date);
  if (buffer.full) {
    void flushAnalytics();
    return;
  }
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; void flushAnalytics(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/** Load the last `days` daily rollups and compute the activation funnel. Never throws. */
export async function getFunnel(days: number = 30): Promise<FunnelResult> {
  const db = getDb();
  if (!db) return funnelFromDaily([]);
  try {
    const snap = await db.collection(DAILY_COLLECTION).orderBy('date', 'desc').limit(Math.max(1, Math.min(365, days))).get();
    return funnelFromDaily(snap.docs.map((d) => d.data() as Partial<DailyAnalytics>));
  } catch {
    return funnelFromDaily([]);
  }
}
