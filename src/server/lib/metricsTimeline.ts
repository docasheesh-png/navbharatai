/**
 * MONITOR — the live time-series behind the admin Monitor home page.
 *
 * WHY THIS EXISTS. Every number the admin panel had was either a CUMULATIVE total since the current
 * Cloud Run instance booted (`metrics.ts`) or ONE document per calendar day (`metricsStore.ts`).
 * Neither can draw a graph: the first has no history at all and resets on every deploy, the second
 * has one point per day. So the panel could show "42 builds" but never "when", never "is it worse
 * than an hour ago", and never the shape of a spike.
 *
 * This module stores the same real counters into short TIME BUCKETS (5 minutes by default), which is
 * what turns them into a chart.
 *
 * TWO PROPERTIES THAT ARE NOT OPTIONAL:
 *
 * 1. CROSS-INSTANCE CORRECT. Cloud Run runs several instances, each with its own memory, so an
 *    in-memory series would show whichever instance happened to answer the request — a graph that
 *    changes depending on who asks is worse than no graph. Every write is a Firestore
 *    `FieldValue.increment`, so N instances writing the same bucket ADD UP by construction.
 *
 * 2. HONEST ABOUT ABSENCE. A missing bucket means "nothing happened in those five minutes" ONLY when
 *    storage is actually reachable. If Firestore is unavailable the series is reported
 *    `available: false` and the UI must say so — a flat green zero line drawn over a broken feed is
 *    a fake success message, which the second absolute rule forbids.
 *
 * COST. Writes are batched in memory and flushed at most once per `MONITOR_FLUSH_SECONDS` (default
 * 60) per instance, so this is ~1,440 tiny writes per instance per day, not one write per AI call.
 * Buckets older than `MONITOR_RETENTION_DAYS` (default 7) are deleted opportunistically.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { setMetricsSink } from './metrics';

export const TIMELINE_COLLECTION = 'metrics_timeline';

/** The raw counters accumulated inside one time bucket. All are additive, which is what makes the
 *  cross-instance `increment` write correct. Cost is stored in integer MICRO-dollars so that summing
 *  it never accumulates floating-point error the way repeated float increments would. */
export interface TimelineCounters {
  builds: number;
  buildsOk: number;
  buildsFailed: number;
  /** Total build wall-clock in this bucket, so avg = buildMs / builds. */
  buildMs: number;
  /** Builds whose preview was allowed (the "app really rendered" signal). */
  previewOk: number;
  aiRequests: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

/** One point on the chart. `observed:false` marks a bucket that had NO document — a real zero when
 *  storage is available, and the reason the caller must check `available` before believing it. */
export interface TimelinePoint extends TimelineCounters {
  t: number;
  observed: boolean;
}

export interface TimelineSeries {
  /** False when the timeline store could not be read at all — the UI must NOT draw zeros. */
  available: boolean;
  /** True when at least one bucket in the window was really written. */
  hasData: boolean;
  bucketMs: number;
  from: number;
  to: number;
  points: TimelinePoint[];
  summary: TimelineSummary;
  /** Per-provider totals over the window (ADMIN-only surface — never shown to an end user). */
  providers: Record<string, ProviderCounters>;
}

export interface ProviderCounters {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

export interface TimelineSummary extends TimelineCounters {
  /** null (not 0) when no build ran in the window — "no data" and "everything failed" are different. */
  successRate: number | null;
  previewRate: number | null;
  avgBuildMs: number | null;
  costUsd: number;
}

const MINUTE = 60_000;

/** Bucket width in ms. Env-tunable; clamped to a sane 1–60 minutes. */
export function bucketWidthMs(): number {
  const raw = Number(process.env.MONITOR_BUCKET_MINUTES);
  const mins = Number.isFinite(raw) && raw > 0 ? Math.min(60, Math.max(1, Math.floor(raw))) : 5;
  return mins * MINUTE;
}

function flushIntervalMs(): number {
  const raw = Number(process.env.MONITOR_FLUSH_SECONDS);
  const secs = Number.isFinite(raw) && raw > 0 ? Math.min(600, Math.max(5, Math.floor(raw))) : 60;
  return secs * 1000;
}

function retentionMs(): number {
  const raw = Number(process.env.MONITOR_RETENTION_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(90, Math.max(1, Math.floor(raw))) : 7;
  return days * 24 * 60 * MINUTE;
}

/** Start of the bucket a timestamp falls in. Pure. */
export function bucketStartMs(ms: number, bucket: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(bucket) || bucket <= 0) return 0;
  return Math.floor(ms / bucket) * bucket;
}

export function emptyCounters(): TimelineCounters {
  return {
    builds: 0, buildsOk: 0, buildsFailed: 0, buildMs: 0, previewOk: 0,
    aiRequests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0,
  };
}

const COUNTER_KEYS: (keyof TimelineCounters)[] = [
  'builds', 'buildsOk', 'buildsFailed', 'buildMs', 'previewOk',
  'aiRequests', 'inputTokens', 'outputTokens', 'costMicroUsd',
];

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Turn the buckets that EXIST into a continuous series over [from, to), inserting explicit zero
 * points for the gaps. Pure — this is the whole reason the chart has no holes in it, and it is
 * unit-tested without touching Firestore.
 */
export function fillSeries(
  docs: Array<{ bucketStart?: number } & Partial<TimelineCounters>>,
  fromMs: number,
  toMs: number,
  bucket: number,
): TimelinePoint[] {
  // An INVERTED window is the invalid case. A window where from === to is legitimate — it asks for the
  // single bucket containing that instant — and must yield one point, not nothing.
  if (!(bucket > 0) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const byBucket = new Map<number, Partial<TimelineCounters>>();
  for (const d of docs || []) {
    const t = bucketStartMs(num(d?.bucketStart), bucket);
    if (t > 0) byBucket.set(t, d);
  }
  const points: TimelinePoint[] = [];
  const start = bucketStartMs(fromMs, bucket);
  const end = bucketStartMs(toMs, bucket);
  // Guard against an absurd window producing millions of points.
  const maxPoints = 2000;
  for (let t = start, i = 0; t <= end && i < maxPoints; t += bucket, i++) {
    const found = byBucket.get(t);
    const counters = emptyCounters();
    if (found) for (const k of COUNTER_KEYS) counters[k] = num(found[k]);
    points.push({ t, observed: !!found, ...counters });
  }
  return points;
}

/** Total a series up. `null` rates when the denominator is zero — never a misleading 0%. Pure. */
export function summarize(points: TimelinePoint[]): TimelineSummary {
  const total = emptyCounters();
  for (const p of points || []) for (const k of COUNTER_KEYS) total[k] += num(p[k]);
  return {
    ...total,
    successRate: total.builds > 0 ? total.buildsOk / total.builds : null,
    previewRate: total.builds > 0 ? total.previewOk / total.builds : null,
    avgBuildMs: total.builds > 0 ? Math.round(total.buildMs / total.builds) : null,
    costUsd: total.costMicroUsd / 1_000_000,
  };
}

/** Firestore field paths cannot contain `.`/`/` etc, and a provider id is free text. Pure. */
export function safeProviderKey(name: string): string {
  const cleaned = String(name || 'unknown').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return cleaned.slice(0, 40) || 'unknown';
}

interface PendingBucket {
  counters: TimelineCounters;
  providers: Record<string, ProviderCounters>;
}

class MetricsTimeline {
  private db: admin.firestore.Firestore | null = null;
  private pending = new Map<number, PendingBucket>();
  private lastFlushAt = 0;
  private lastCleanupAt = 0;
  private flushing: Promise<void> | null = null;

  private getDb(): admin.firestore.Firestore | null {
    // Tests never reach Firestore — the pure functions above carry the logic worth testing.
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  private bucketFor(now: number): PendingBucket {
    const t = bucketStartMs(now, bucketWidthMs());
    let b = this.pending.get(t);
    if (!b) {
      b = { counters: emptyCounters(), providers: {} };
      this.pending.set(t, b);
    }
    return b;
  }

  /** Record one build outcome. Never throws — metrics must never break a build. */
  recordBuild(o: { ok: boolean; previewAllowed?: boolean; ms?: number }, now = Date.now()): void {
    try {
      const b = this.bucketFor(now);
      b.counters.builds += 1;
      if (o.ok) b.counters.buildsOk += 1; else b.counters.buildsFailed += 1;
      if (o.previewAllowed) b.counters.previewOk += 1;
      b.counters.buildMs += Math.max(0, Math.round(o.ms ?? 0));
      this.maybeFlush();
    } catch { /* never break a build on telemetry */ }
  }

  /** Record one model call's real token use + cost. Never throws. */
  recordModelCall(provider: string, inputTokens: number, outputTokens: number, costUsd: number, now = Date.now()): void {
    try {
      const b = this.bucketFor(now);
      const inTok = Math.max(0, Math.round(inputTokens || 0));
      const outTok = Math.max(0, Math.round(outputTokens || 0));
      const micros = Math.max(0, Math.round((costUsd || 0) * 1_000_000));
      b.counters.aiRequests += 1;
      b.counters.inputTokens += inTok;
      b.counters.outputTokens += outTok;
      b.counters.costMicroUsd += micros;
      const key = safeProviderKey(provider);
      const p = b.providers[key] || (b.providers[key] = { requests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 });
      p.requests += 1;
      p.inputTokens += inTok;
      p.outputTokens += outTok;
      p.costMicroUsd += micros;
      this.maybeFlush();
    } catch { /* never break a build on telemetry */ }
  }

  private maybeFlush(): void {
    const now = Date.now();
    if (now - this.lastFlushAt < flushIntervalMs()) return;
    // Fire-and-forget: a build must never wait on the monitor's write.
    void this.flush();
  }

  /** Write the pending deltas. Safe to call concurrently — a second call joins the first. */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    const db = this.getDb();
    if (!db || this.pending.size === 0) {
      // Still move the clock so a Firestore-less environment does not retry on every single call.
      this.lastFlushAt = Date.now();
      return;
    }
    // Take the pending map out FIRST: anything recorded during the await lands in a fresh map and is
    // written by the next flush, instead of being silently dropped by a clear() after the write.
    const batchPending = this.pending;
    this.pending = new Map();
    this.lastFlushAt = Date.now();
    try {
      const inc = admin.firestore.FieldValue.increment;
      await Promise.all([...batchPending.entries()].map(([t, b]) => {
        const update: Record<string, unknown> = {
          bucketStart: t,
          updatedAt: Date.now(),
        };
        for (const k of COUNTER_KEYS) if (b.counters[k] > 0) update[k] = inc(b.counters[k]);
        const providers: Record<string, unknown> = {};
        for (const [name, p] of Object.entries(b.providers)) {
          providers[name] = {
            requests: inc(p.requests),
            inputTokens: inc(p.inputTokens),
            outputTokens: inc(p.outputTokens),
            costMicroUsd: inc(p.costMicroUsd),
          };
        }
        if (Object.keys(providers).length > 0) update.providers = providers;
        return db.collection(TIMELINE_COLLECTION).doc(String(t)).set(update, { merge: true });
      }));
    } catch {
      // The write failed — put the deltas back so the next flush retries them rather than losing the
      // window. Merged, because new activity may already have landed in the fresh map.
      for (const [t, b] of batchPending) {
        const existing = this.pending.get(t);
        if (!existing) { this.pending.set(t, b); continue; }
        for (const k of COUNTER_KEYS) existing.counters[k] += b.counters[k];
        for (const [name, p] of Object.entries(b.providers)) {
          const cur = existing.providers[name] || (existing.providers[name] = { requests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 });
          cur.requests += p.requests;
          cur.inputTokens += p.inputTokens;
          cur.outputTokens += p.outputTokens;
          cur.costMicroUsd += p.costMicroUsd;
        }
      }
    }
    void this.cleanupIfDue();
  }

  /** Delete buckets past the retention window. Bounded and at most hourly per instance. */
  private async cleanupIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < 60 * MINUTE) return;
    this.lastCleanupAt = now;
    const db = this.getDb();
    if (!db) return;
    try {
      const cutoff = now - retentionMs();
      const stale = await db.collection(TIMELINE_COLLECTION)
        .where('bucketStart', '<', cutoff)
        .limit(200)
        .get();
      if (stale.empty) return;
      const batch = db.batch();
      stale.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch { /* housekeeping only — never surfaced, never fatal */ }
  }

  /**
   * Read the last `hours` of buckets as a gap-filled series. Flushes first so the newest window
   * includes what this instance has in memory.
   */
  async series(hours = 6): Promise<TimelineSeries> {
    const bucket = bucketWidthMs();
    const span = Math.min(24 * 7, Math.max(1, hours));
    const to = Date.now();
    const from = to - span * 60 * MINUTE;
    const emptyResult = (available: boolean): TimelineSeries => {
      const points = available ? fillSeries([], from, to, bucket) : [];
      return { available, hasData: false, bucketMs: bucket, from, to, points, summary: summarize(points), providers: {} };
    };

    await this.flush().catch(() => {});
    const db = this.getDb();
    if (!db) return emptyResult(false);
    try {
      const snap = await db.collection(TIMELINE_COLLECTION)
        .where('bucketStart', '>=', bucketStartMs(from, bucket))
        .orderBy('bucketStart', 'asc')
        .limit(2000)
        .get();
      const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
      const points = fillSeries(docs as any, from, to, bucket);
      const providers: Record<string, ProviderCounters> = {};
      for (const d of docs) {
        const raw = (d.providers || {}) as Record<string, Partial<ProviderCounters>>;
        for (const [name, p] of Object.entries(raw)) {
          const cur = providers[name] || (providers[name] = { requests: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 });
          cur.requests += num(p?.requests);
          cur.inputTokens += num(p?.inputTokens);
          cur.outputTokens += num(p?.outputTokens);
          cur.costMicroUsd += num(p?.costMicroUsd);
        }
      }
      return {
        available: true,
        hasData: docs.length > 0,
        bucketMs: bucket,
        from,
        to,
        points,
        summary: summarize(points),
        providers,
      };
    } catch {
      // Storage is there but unreadable — say so rather than drawing a zero line.
      return emptyResult(false);
    }
  }
}

export const metricsTimeline = new MetricsTimeline();

/**
 * Point the shared metrics registry at this timeline. Called ONCE at server boot, which is what
 * makes every existing `getMetrics().recordBuild/recordModelCall` call site feed the Monitor with no
 * change at those call sites.
 */
export function attachMetricsTimeline(): void {
  setMetricsSink({
    onBuild: (o) => metricsTimeline.recordBuild({ ok: o.ok, previewAllowed: o.previewAllowed, ms: o.ms }),
    onModelCall: (provider, inputTokens, outputTokens, costUsd) =>
      metricsTimeline.recordModelCall(provider, inputTokens, outputTokens, costUsd),
  });
}
