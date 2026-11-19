/**
 * Traffic Manager V2, P3: provider health shared across Cloud Run instances (owner improvement #2: "adaptive
 * polling, jitter, write coalescing, and bounded health synchronization").
 *
 * Today each instance learns an outage alone. Here an instance PUBLISHES a provider's state change and READS the
 * others'. Bounded by construction:
 *  · WRITE only on a state change (up ↔ down/suspended), coalesced per provider: at most one write per provider per
 *    20 s per instance, at most 32 per flush. One document per provider, overwritten in place, so the collection
 *    never grows with traffic. No write ever sits on a request path.
 *  · READ one bounded query (changes in the last 15 min, newest 64) every 20 s, backing off ×1.5 to 60 s while
 *    nothing changes, ±20% jitter.
 *  · Only `state`, the failure kind, the recovery time and the model id are shared — NEVER the provider's error
 *    text, a key, or any prompt.
 *
 * MODE (`TRAFFIC_HEALTH_SHARE`): `observe` (default) publishes and reads, and SHOWS what the other instances report,
 * but no ladder acts on it — routing stays exactly as today; `on` also adopts a newer shared state, so a provider one
 * instance found suspended is skipped everywhere; `off` does nothing. Turning it `on` is the owner's call after
 * observing it (the owner asked that no new routing behaviour reach all users unvalidated).
 */
import { randomUUID } from 'node:crypto';
import { getServerDb } from '../../lib/serverDb';
import { BoundedCache } from '../../lib/boundedCache';
import { adoptSharedState, onTrafficTransition, trafficHealthEnabled, type TrafficErrorKind, type TrafficState, type TrafficTransition } from './trafficHealth';

export const PROVIDER_HEALTH_SHARED_COLLECTION = 'provider_health_shared';
export const SHARE_WRITE_MIN_MS = 20_000;
export const SHARE_MAX_WRITES_PER_FLUSH = 32;
export const SHARE_READ_BASE_MS = 20_000;
export const SHARE_READ_MAX_MS = 60_000;
export const SHARE_LOOKBACK_MS = 15 * 60 * 1000;
export const SHARE_READ_LIMIT = 64;

export type ShareMode = 'off' | 'observe' | 'on';
export function shareMode(env: NodeJS.ProcessEnv = process.env): ShareMode {
  const v = String(env.TRAFFIC_HEALTH_SHARE ?? '').trim().toLowerCase();
  return v === 'on' || v === 'off' ? v : 'observe';
}

export interface SharedRecord { provider: string; state: TrafficState; kind: TrafficErrorKind; recoverAt: number; atMs: number; instance: string; model?: string }

/** The storage surface this module needs (tests pass an in-memory one). */
export interface ShareStore {
  write(id: string, record: SharedRecord): Promise<void>;
  readSince(sinceMs: number, limit: number): Promise<SharedRecord[]>;
}

const STATES = new Set(['up', 'down', 'suspended']);
const KINDS = new Set(['ok', 'rate-limit', 'invalid', 'timeout', 'suspended', 'other']);
export function parseShared(raw: unknown): SharedRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.provider !== 'string' || !/^[A-Za-z0-9_:#.-]{1,80}$/.test(r.provider) || !STATES.has(r.state as string) || !KINDS.has(r.kind as string)
    || !Number.isSafeInteger(r.recoverAt) || !Number.isSafeInteger(r.atMs) || typeof r.instance !== 'string') return null;
  return { provider: r.provider, state: r.state as TrafficState, kind: r.kind as TrafficErrorKind, recoverAt: r.recoverAt as number,
    atMs: r.atMs as number, instance: r.instance.slice(0, 40), ...(typeof r.model === 'string' ? { model: r.model.slice(0, 200) } : {}) };
}

export const docIdFor = (provider: string): string => provider.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

function firestoreStore(): ShareStore | null {
  const db = getServerDb();
  if (!db) return null;
  const col = db.collection(PROVIDER_HEALTH_SHARED_COLLECTION);
  return {
    write: async (id, record) => { await col.doc(id).set(record); },
    readSince: async (sinceMs, limit) => (await col.where('atMs', '>=', sinceMs).orderBy('atMs', 'desc').limit(limit).get())
      .docs.map(d => parseShared(d.data())).filter((r): r is SharedRecord => r !== null),
  };
}

const INSTANCE = randomUUID().slice(0, 12);
const pending = new BoundedCache<string, TrafficTransition>({ maxEntries: 256 });
const lastWriteAt = new BoundedCache<string, number>({ maxEntries: 256 });
const remote = new BoundedCache<string, SharedRecord>({ maxEntries: 256 });
let status = { lastPullAtMs: null as number | null, lastPullOk: false, intervalMs: SHARE_READ_BASE_MS, writes: 0, adopted: 0 };

/** Queue a transition (latest wins per provider). */
export function queueTransition(t: TrafficTransition): void {
  if (shareMode() === 'off') return;
  pending.set(t.provider, t);
}

/** Write what is due. Bounded: per-provider spacing, and a cap per flush. Failures keep the item queued. */
export async function flushShared(store: ShareStore | null = firestoreStore(), now = Date.now()): Promise<number> {
  if (!store || shareMode() === 'off') return 0;
  let written = 0;
  for (const [provider, t] of pending.entries(now)) {
    if (written >= SHARE_MAX_WRITES_PER_FLUSH) break;
    const last = lastWriteAt.get(provider) ?? 0;
    if (now - last < SHARE_WRITE_MIN_MS) continue;
    const record: SharedRecord = { provider, state: t.state, kind: t.kind, recoverAt: t.recoverAt, atMs: t.at, instance: INSTANCE, ...(t.model ? { model: t.model } : {}) };
    try { await store.write(docIdFor(provider), record); pending.delete(provider); lastWriteAt.set(provider, now); written++; status.writes++; }
    catch { /* keep it queued; the next flush retries */ }
  }
  return written;
}

/** One bounded read; in `on` mode a newer shared state is adopted. Returns whether anything new arrived. */
export async function pullShared(store: ShareStore | null = firestoreStore(), now = Date.now()): Promise<boolean> {
  if (!store || shareMode() === 'off') return false;
  try {
    const rows = await store.readSince(now - SHARE_LOOKBACK_MS, SHARE_READ_LIMIT);
    let changed = false;
    for (const r of rows) {
      if (r.instance === INSTANCE) continue;
      const prev = remote.get(r.provider);
      if (!prev || prev.atMs < r.atMs) { remote.set(r.provider, r); changed = true; }
      if (shareMode() === 'on' && adoptSharedState(r.provider, r.state, r.state === 'up' ? null : `Reported by another server: ${r.kind}`, r.recoverAt, r.atMs)) status.adopted++;
    }
    status = { ...status, lastPullAtMs: now, lastPullOk: true, intervalMs: changed ? SHARE_READ_BASE_MS : Math.min(SHARE_READ_MAX_MS, Math.round(status.intervalMs * 1.5)) };
    return changed;
  } catch {
    status = { ...status, lastPullOk: false, intervalMs: SHARE_READ_BASE_MS };
    return false;
  }
}

export function sharedHealthStatus(now = Date.now()): { mode: ShareMode; lastPullAtMs: number | null; lastPullOk: boolean; intervalMs: number; writes: number; adopted: number; remote: SharedRecord[] } {
  return { mode: shareMode(), ...status, remote: [...remote.entries(now)].map(([, r]) => r).sort((a, b) => a.provider.localeCompare(b.provider)) };
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Start once per instance. Never blocks boot; timers are unref'd. */
export function startHealthShare(store: ShareStore | null = null): void {
  if (timer || shareMode() === 'off' || !trafficHealthEnabled()) return;
  onTrafficTransition(queueTransition);
  const tick = async () => {
    const s = store ?? firestoreStore();
    await flushShared(s);
    await pullShared(s);
    timer = setTimeout(() => { void tick(); }, Math.round(status.intervalMs * (0.8 + Math.random() * 0.4)));
    (timer as { unref?: () => void }).unref?.();
  };
  timer = setTimeout(() => { void tick(); }, 1_000);
  (timer as { unref?: () => void }).unref?.();
}

/** Test hook. */
export function __resetHealthShareForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null; pending.clear(); lastWriteAt.clear(); remote.clear();
  status = { lastPullAtMs: null, lastPullOk: false, intervalMs: SHARE_READ_BASE_MS, writes: 0, adopted: 0 };
  onTrafficTransition(null);
}
export const __instanceIdForTests = (): string => INSTANCE;
