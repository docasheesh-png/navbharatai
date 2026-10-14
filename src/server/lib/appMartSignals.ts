// App Mart "For You" — where engagement signals are KEPT, cheaply and privately.
//
// 💸 CHEAP: events are aggregated in memory and flushed at most every 30 s as ONE merge-write per day
//    doc (`app_mart_signals/{YYYYMMDD}`, a map of appId → counters with FieldValue.increment) plus one
//    merge-write per active viewer's affinity doc. Reading the global signals is 28 doc reads, cached
//    5 min per instance. No per-event documents, no composite index.
// 🔒 PRIVATE: no raw event log, no IP, no device id. Global counters are anonymous. The per-user doc
//    (`app_mart_affinity/{uid}`) only holds topic/creator weights for that user's own feed, is
//    server-only (firestore.rules deny-all by default), and can be deleted with the account.
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import {
  decaySignals, dayKey, SIGNAL_WINDOW_DAYS, tagsFor,
  type AppSignals, type DaySignals, type Affinity, type RawEvent,
} from '../../lib/appMartForYou';

export const SIGNALS_COLLECTION = 'app_mart_signals';
export const AFFINITY_COLLECTION = 'app_mart_affinity';
const FLUSH_MS = 30_000;
const MAX_AFFINITY_KEYS = 300;
/** Hard caps on what one flush window can hold, so the in-memory buffer can never grow with traffic. */
export const MAX_PENDING_APPS = 5_000;
export const MAX_PENDING_USERS = 1_000;

type Counter = keyof DaySignals;
const pendingApps = new Map<string, DaySignals>();
const pendingAff = new Map<string, Affinity>();
let timer: NodeJS.Timeout | null = null;

export interface AppMeta { id: string; name?: string; description?: string; contentClass?: string; creatorId?: string }

function bump(appId: string, field: Counter, by: number): void {
  if (!pendingApps.has(appId) && pendingApps.size >= MAX_PENDING_APPS) return;
  const cur = pendingApps.get(appId) ?? {};
  cur[field] = (cur[field] ?? 0) + by;
  pendingApps.set(appId, cur);
}

function bumpAffinity(uid: string, meta: AppMeta, w: number): void {
  if (!pendingAff.has(uid) && pendingAff.size >= MAX_PENDING_USERS) return;
  const a = pendingAff.get(uid) ?? { tags: {}, creators: {} };
  for (const t of tagsFor(meta)) a.tags[t] = (a.tags[t] ?? 0) + w;
  if (meta.creatorId) a.creators[meta.creatorId] = (a.creators[meta.creatorId] ?? 0) + w;
  pendingAff.set(uid, a);
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = null; void flushSignals(); }, FLUSH_MS);
  timer.unref?.();
}

/** Record a validated batch. `meta` resolves a LIVE listed app; events for anything else are dropped. */
export function recordEvents(uid: string | null, events: readonly RawEvent[], meta: (id: string) => AppMeta | undefined): number {
  let kept = 0;
  for (const e of events) {
    const m = meta(e.appId);
    if (!m) continue;
    kept++;
    if (e.kind === 'open') { bump(e.appId, 'opens', 1); if (e.repeat) bump(e.appId, 'repeats', 1); }
    else if (e.kind === 'dwell') bump(e.appId, 'dwellSec', e.sec ?? 0);
    else if (e.kind === 'share') bump(e.appId, 'shares', 1);
    else if (e.kind === 'detail') bump(e.appId, 'details', 1);
    if (uid) {
      const w = e.kind === 'open' ? (e.repeat ? 2 : 1) : e.kind === 'share' ? 3 : e.kind === 'dwell' ? Math.min(3, (e.sec ?? 0) / 120) : 0.3;
      if (w > 0) bumpAffinity(uid, m, w);
    }
  }
  if (kept) schedule();
  return kept;
}

/** A NEW like (from the social route) — a strong signal for the app and for the liker's taste. */
export function recordLike(uid: string, meta: AppMeta | undefined): void {
  if (!meta) return;
  bump(meta.id, 'likes', 1);
  bumpAffinity(uid, meta, 4);
  schedule();
}

export async function flushSignals(now = Date.now()): Promise<void> {
  const d = getServerDb();
  const apps = new Map(pendingApps); pendingApps.clear();
  const affs = new Map(pendingAff); pendingAff.clear();
  if (!d || (apps.size === 0 && affs.size === 0)) return;
  const inc = admin.firestore.FieldValue.increment;
  try {
    if (apps.size) {
      const payload: Record<string, Record<string, admin.firestore.FieldValue>> = {};
      for (const [id, s] of apps) {
        payload[id] = {};
        for (const [k, v] of Object.entries(s)) if (v) payload[id][k] = inc(v);
      }
      await d.collection(SIGNALS_COLLECTION).doc(dayKey(now)).set({ apps: payload }, { merge: true });
    }
    const writes: Array<Promise<unknown>> = [];
    for (const [uid, a] of affs) {
      const tags: Record<string, admin.firestore.FieldValue> = {};
      const creators: Record<string, admin.firestore.FieldValue> = {};
      for (const [k, v] of Object.entries(a.tags)) tags[k] = inc(Math.round(v * 10) / 10);
      for (const [k, v] of Object.entries(a.creators)) creators[k] = inc(Math.round(v * 10) / 10);
      writes.push(d.collection(AFFINITY_COLLECTION).doc(uid).set({ tags, creators, updatedAt: now }, { merge: true }));
    }
    await Promise.all(writes);
  } catch (e) {
    // Signals only — a lost flush costs ranking freshness, never a page.
    console.warn('[appmart-signals] flush failed', e instanceof Error ? e.message : e);
  }
}

let signalsCache: { at: number; map: Map<string, AppSignals> } | null = null;
const SIGNALS_TTL = 5 * 60_000;

/** Decayed signals for every app, from the last 28 day docs. Cached 5 min. Empty map on any failure. */
export async function readSignals(now = Date.now()): Promise<Map<string, AppSignals>> {
  if (signalsCache && now - signalsCache.at < SIGNALS_TTL) return signalsCache.map;
  const d = getServerDb();
  const map = new Map<string, AppSignals>();
  if (!d) return map;
  try {
    const refs = Array.from({ length: SIGNAL_WINDOW_DAYS + 1 }, (_, i) => d.collection(SIGNALS_COLLECTION).doc(dayKey(now - i * 86_400_000)));
    const snaps = await d.getAll(...refs);
    const perApp = new Map<string, Array<{ ageDays: number; s: DaySignals }>>();
    snaps.forEach((snap, ageDays) => {
      const apps = (snap.exists ? snap.get('apps') : null) as Record<string, DaySignals> | null;
      if (!apps) return;
      for (const [id, s] of Object.entries(apps)) {
        const list = perApp.get(id) ?? [];
        list.push({ ageDays, s });
        perApp.set(id, list);
      }
    });
    for (const [id, days] of perApp) map.set(id, decaySignals(days));
    signalsCache = { at: now, map };
  } catch (e) {
    console.warn('[appmart-signals] read failed', e instanceof Error ? e.message : e);
  }
  return map;
}

/** The viewer's own taste profile (null when signed out / none yet). Oversized maps are pruned to the top keys. */
export async function readAffinity(uid: string | null): Promise<Affinity | null> {
  if (!uid) return null;
  const d = getServerDb();
  if (!d) return null;
  try {
    const snap = await d.collection(AFFINITY_COLLECTION).doc(uid).get();
    if (!snap.exists) return null;
    const top = (m: unknown) => Object.fromEntries(Object.entries((m ?? {}) as Record<string, number>)
      .filter(([, v]) => typeof v === 'number').sort((x, y) => y[1] - x[1]).slice(0, MAX_AFFINITY_KEYS));
    const raw = snap.data() ?? {};
    const tagCount = Object.keys(raw.tags ?? {}).length;
    const a: Affinity = { tags: top(raw.tags), creators: top(raw.creators) };
    if (tagCount > MAX_AFFINITY_KEYS * 1.5) void snap.ref.set({ tags: a.tags, creators: a.creators, updatedAt: Date.now() }).catch(() => {});
    return a;
  } catch { return null; }
}

export function _resetSignalsForTests(): void {
  pendingApps.clear(); pendingAff.clear(); signalsCache = null;
  if (timer) { clearTimeout(timer); timer = null; }
}
export function _pendingForTests() { return { apps: pendingApps, affinity: pendingAff }; }
