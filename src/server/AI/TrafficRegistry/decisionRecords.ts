/**
 * Traffic Manager V2, P4: what each chat request's routing decided, and complete counts for the SLO (owner decisions
 * 4 and 6, improvement #4).
 *
 * TWO DIFFERENT THINGS, ON PURPOSE:
 *  · COUNTERS — every eligible request, no sampling. The SLO is computed only from these (owner improvement #4:
 *    "do not calculate reliability using raw sampled decision records"). Each instance keeps per-day, per-surface
 *    counts in memory and writes its OWN document's absolute totals once a minute (`routing_slo_daily`), so a retry
 *    can never double-count and there is no hot shared document. The SLO sums the instances.
 *  · DECISION RECORDS — for diagnosis. 100% of failures and critical events, 10% of successes (deterministic per
 *    request), each carrying its sampling weight. Written in batches (at most 200 every 30 s per instance); kept 30
 *    days (`routing_decisions`, DataRetentionManager).
 *
 * 🔒 NO CONTENT. A record is a fixed set of fields: surface, path, outcome, failure category, provider label, model
 * id, latency, token counts the provider reported, and the attempts (provider label, skip reason, whether it was
 * called). No prompt, answer, user id, key or provider message — `RECORD_FIELDS` is the whole list and a test fails
 * if a field outside it appears.
 *
 * Observation only: nothing here changes a route. `ROUTING_DECISIONS=off` stops both writers.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getServerDb } from '../../lib/serverDb';
import { BoundedCache } from '../../lib/boundedCache';
import { parseEnvFlag } from '../../lib/envFlag';

export const ROUTING_DECISIONS_COLLECTION = 'routing_decisions';
export const ROUTING_SLO_DAILY_COLLECTION = 'routing_slo_daily';
export const SUCCESS_SAMPLE_PCT = 10;
export const FLUSH_MS = 30_000;
export const MAX_RECORDS_PER_FLUSH = 200;
export const MAX_BUFFER = 1_000;
export const SLO_FLUSH_MS = 60_000;

export type DecisionOutcome = 'complete' | 'partial' | 'refused' | 'cancelled' | 'failed';
export type DecisionPath = 'gateway' | 'legacy';
export const RECORD_FIELDS = ['atMs', 'day', 'surface', 'path', 'outcome', 'failure', 'provider', 'model', 'latencyMs',
  'inputTokens', 'outputTokens', 'attempts', 'weight', 'sampled', 'critical', 'id', 'instance'] as const;

export interface DecisionAttempt { provider: string; reason: string; entered: boolean }
export interface DecisionRecord {
  atMs: number; day: string; surface: string; path: DecisionPath; outcome: DecisionOutcome; failure: string | null;
  provider: string; model: string; latencyMs: number | null; inputTokens: number | null; outputTokens: number | null;
  attempts: DecisionAttempt[];
  /** 1 for every failure/critical record; 100/SUCCESS_SAMPLE_PCT for a sampled success, so weighted sums estimate totals. */
  weight: number; sampled: boolean; critical: boolean; id: string; instance: string;
}

export function decisionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean { return parseEnvFlag(env.ROUTING_DECISIONS) !== false; }

/** Eligible = counted in the SLO denominator. A refusal (policy) or a user cancel is neither success nor failure. */
export function isEligible(outcome: DecisionOutcome): boolean { return outcome === 'complete' || outcome === 'partial' || outcome === 'failed'; }

const INSTANCE = randomUUID().slice(0, 12);
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Deterministic 10% of successes: the same id always gets the same answer. */
export function sampledSuccess(id: string): boolean {
  return createHash('sha256').update(id).digest().readUInt32BE(0) % 100 < SUCCESS_SAMPLE_PCT;
}

const clean = (v: unknown, max: number): string => String(v ?? '').replace(/[^\w.:/@#+-]/g, '').slice(0, max) || 'unknown';
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);

export interface DecisionInput {
  surface: string; path: DecisionPath; outcome: DecisionOutcome; failure?: string | null;
  provider?: string; model?: string; latencyMs?: number; usage?: { inputTokens?: number; outputTokens?: number };
  attempts?: ReadonlyArray<{ provider?: unknown; reason?: unknown; entered?: unknown }>;
  critical?: boolean; atMs?: number; id?: string;
}

/** Build the fixed-field record, or null when this success is not in the 10% sample. */
export function buildRecord(input: DecisionInput): DecisionRecord | null {
  const atMs = input.atMs ?? Date.now();
  const id = input.id ?? randomUUID();
  const critical = input.critical === true;
  const success = input.outcome === 'complete';
  const sampled = success && !critical;
  if (sampled && !sampledSuccess(id)) return null;
  return {
    atMs, day: dayOf(atMs), surface: clean(input.surface, 32), path: input.path, outcome: input.outcome,
    failure: input.failure ? clean(input.failure, 40) : null,
    provider: clean(input.provider ?? 'NONE', 60), model: clean(input.model ?? 'none', 120),
    latencyMs: count(Math.round(input.latencyMs ?? -1)), inputTokens: count(input.usage?.inputTokens), outputTokens: count(input.usage?.outputTokens),
    attempts: (input.attempts ?? []).slice(0, 16).map(a => ({ provider: clean(a.provider, 60), reason: clean(a.reason, 40), entered: a.entered === true })),
    weight: sampled ? 100 / SUCCESS_SAMPLE_PCT : 1, sampled, critical, id: createHash('sha256').update(id).digest('hex').slice(0, 16), instance: INSTANCE,
  };
}

// ── counters (complete, per instance, per day, per surface) ────────────────────────────────────────────────────
type Counts = Record<DecisionOutcome, number>;
const zero = (): Counts => ({ complete: 0, partial: 0, refused: 0, cancelled: 0, failed: 0 });
const counters = new BoundedCache<string, { day: string; surface: string; counts: Counts; dirty: boolean }>({ maxEntries: 128 });

/** Count EVERY outcome. O(1), in memory; the minute flush writes this instance's absolute totals. */
export function countOutcome(surface: string, outcome: DecisionOutcome, atMs = Date.now()): void {
  if (!decisionsEnabled()) return;
  const day = dayOf(atMs); const s = clean(surface, 32); const key = `${day}|${s}`;
  let c = counters.get(key);
  if (!c) { c = { day, surface: s, counts: zero(), dirty: false }; counters.set(key, c); }
  c.counts[outcome]++; c.dirty = true;
}

// ── decision buffer ──────────────────────────────────────────────────────────────────────────────────────────────
let buffer: DecisionRecord[] = [];
let dropped = 0;
export function recordDecision(input: DecisionInput): void {
  if (!decisionsEnabled()) return;
  countOutcome(input.surface, input.outcome, input.atMs);
  const r = buildRecord(input);
  if (!r) return;
  if (buffer.length >= MAX_BUFFER) { dropped++; return; } // bounded: never grows with traffic
  buffer.push(r);
}

export interface DecisionStore {
  writeRecords(records: DecisionRecord[]): Promise<void>;
  writeCounter(docId: string, value: { day: string; surface: string; instance: string; counts: Counts; updatedAtMs: number; dayStartMs: number }): Promise<void>;
  readCounters(sinceDay: string): Promise<Array<{ day: string; surface: string; counts: Counts }>>;
  readRecentFailures(limit: number): Promise<DecisionRecord[]>;
}

function firestoreStore(): DecisionStore | null {
  const db = getServerDb();
  if (!db) return null;
  return {
    writeRecords: async (records) => { const b = db.batch(); for (const r of records) b.set(db.collection(ROUTING_DECISIONS_COLLECTION).doc(), r); await b.commit(); },
    writeCounter: async (id, v) => { await db.collection(ROUTING_SLO_DAILY_COLLECTION).doc(id).set(v); },
    readCounters: async (sinceDay) => (await db.collection(ROUTING_SLO_DAILY_COLLECTION).where('day', '>=', sinceDay).limit(5000).get())
      .docs.map(d => d.data() as { day: string; surface: string; counts: Counts }),
    // Single-field order only (no composite index exists in this repo): newest 200, failures picked in memory.
    readRecentFailures: async (limit) => (await db.collection(ROUTING_DECISIONS_COLLECTION).orderBy('atMs', 'desc').limit(200).get())
      .docs.map(d => d.data() as DecisionRecord).filter(r => r.outcome !== 'complete').slice(0, limit),
  };
}

export async function flushDecisions(store: DecisionStore | null = firestoreStore()): Promise<number> {
  if (!store || !buffer.length) return 0;
  const batch = buffer.slice(0, MAX_RECORDS_PER_FLUSH);
  try { await store.writeRecords(batch); buffer = buffer.slice(batch.length); return batch.length; }
  catch { return 0; } // kept for the next flush (bounded by MAX_BUFFER)
}

export async function flushCounters(store: DecisionStore | null = firestoreStore(), now = Date.now()): Promise<number> {
  if (!store) return 0;
  let written = 0;
  for (const [, c] of counters.entries(now)) {
    if (!c.dirty) continue;
    try {
      await store.writeCounter(`${c.day}_${c.surface}_${INSTANCE}`, { day: c.day, surface: c.surface, instance: INSTANCE, counts: { ...c.counts },
        updatedAtMs: now, dayStartMs: Date.parse(`${c.day}T00:00:00Z`) });
      c.dirty = false; written++;
    } catch { /* stays dirty; the next flush writes the same absolute totals */ }
  }
  return written;
}

/** Wilson score interval: the honest uncertainty of a success rate from n requests. */
export function wilson95(successes: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96, p = successes / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export const SLO_TARGETS: Readonly<Record<string, number>> = Object.freeze({ free: 0.995, navbharat: 0.995, professional: 0.995 });

export interface SloRow { surface: string; days: number; eligible: number; successes: number; refused: number; cancelled: number; rate: number | null; ci95: { low: number; high: number } | null; target: number | null }

/** The SLO over the last `days` days, from the complete counters of every instance. */
export async function computeSlo(store: DecisionStore | null = firestoreStore(), days = 7, now = Date.now()): Promise<SloRow[]> {
  if (!store) return [];
  const since = dayOf(now - (days - 1) * 86_400_000);
  const totals = new Map<string, Counts>();
  for (const row of await store.readCounters(since)) {
    const t = totals.get(row.surface) ?? zero();
    for (const k of Object.keys(t) as DecisionOutcome[]) t[k] += Number(row.counts?.[k]) || 0;
    totals.set(row.surface, t);
  }
  return [...totals.entries()].map(([surface, t]) => {
    const eligible = t.complete + t.partial + t.failed;
    return { surface, days, eligible, successes: t.complete, refused: t.refused, cancelled: t.cancelled,
      rate: eligible ? t.complete / eligible : null, ci95: wilson95(t.complete, eligible), target: SLO_TARGETS[surface] ?? null };
  }).sort((a, b) => a.surface.localeCompare(b.surface));
}

/** The latest failure records, newest first (fixed fields only). */
export async function recentFailures(limit = 20, store: DecisionStore | null = firestoreStore()): Promise<DecisionRecord[]> {
  return store ? store.readRecentFailures(Math.max(1, Math.min(50, limit))) : [];
}

export function decisionSinkStatus(): { enabled: boolean; buffered: number; dropped: number } {
  return { enabled: decisionsEnabled(), buffered: buffer.length, dropped };
}

let timers: Array<ReturnType<typeof setInterval>> = [];
export function startDecisionSink(): void {
  if (timers.length || !decisionsEnabled()) return;
  const a = setInterval(() => { void flushDecisions(); }, FLUSH_MS);
  const b = setInterval(() => { void flushCounters(); }, SLO_FLUSH_MS);
  for (const t of [a, b]) (t as { unref?: () => void }).unref?.();
  timers = [a, b];
}

/** Test hook. */
export function __resetDecisionSinkForTests(): void {
  for (const t of timers) clearInterval(t);
  timers = []; buffer = []; dropped = 0; counters.clear();
}
export const __decisionBufferForTests = (): DecisionRecord[] => buffer;
