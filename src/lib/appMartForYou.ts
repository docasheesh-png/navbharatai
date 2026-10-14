// App Mart "For You" — the personalised ranking (admin 2026-10-14: "random (default) me youtube/Instagram
// jaisa algorithm chale, aur user ko jo pasand aaye woh upar aaye! new me, abhi jaisa system rahe").
//
// PURE: no I/O, no clock, no Math.random — everything is passed in, so every rule is unit-tested
// (tests/appMartForYou.test.ts) and the same seed always gives the same order (stable paging per session).
//
// score(app) = engagement (time-decayed opens, dwell, likes, shares, repeat use, smoothed by exposure)
//            + personal affinity (tags + creators the viewer opened/liked)
//            + freshness boost (new apps get exposure before they have signals)
//            + seeded exploration noise
// then a DIVERSITY pass: no more than 2 in a row from the same creator or the same main tag.
//
// "Newest" is NOT here — it stays the existing chronological list, untouched.

export type SortMode = 'foryou' | 'newest';
export const SORT_STORAGE_KEY = 'appmart.sort.v1';
/** UI text is English-only by the repo's language standard (tests/uiLanguageEnglishOnly.test.ts). */
export const SORT_LABELS: Record<SortMode, string> = { foryou: 'For You', newest: 'Newest' };

/** Flag: default ON; env `off` / `0` / `false` is the kill switch. */
export function forYouEnabled(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no');
}

export function parseSortMode(raw: unknown): SortMode {
  return raw === 'newest' ? 'newest' : 'foryou';
}

// ─── Events ──────────────────────────────────────────────────────────────────────────────────────
export type EventKind = 'open' | 'dwell' | 'share' | 'detail';
export interface RawEvent { kind: EventKind; appId: string; sec?: number; repeat?: boolean }
const APP_ID = /^[A-Za-z0-9_-]{4,80}$/;
export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_DWELL_SEC = 30 * 60;

/** Validate a client batch. Unknown shapes are dropped, never fatal. Dwell is capped so one tab left open can't farm score. */
export function cleanEvents(raw: unknown): RawEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RawEvent[] = [];
  for (const r of raw.slice(0, MAX_EVENTS_PER_BATCH)) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (typeof e.appId !== 'string' || !APP_ID.test(e.appId)) continue;
    if (e.kind !== 'open' && e.kind !== 'dwell' && e.kind !== 'share' && e.kind !== 'detail') continue;
    const ev: RawEvent = { kind: e.kind, appId: e.appId };
    if (e.kind === 'dwell') {
      const s = Number(e.sec);
      if (!Number.isFinite(s) || s < 1) continue;
      ev.sec = Math.min(MAX_DWELL_SEC, Math.round(s));
    }
    if (e.kind === 'open' && e.repeat === true) ev.repeat = true;
    out.push(ev);
  }
  return out;
}

// ─── Signals ─────────────────────────────────────────────────────────────────────────────────────
/** One day's counters for one app. */
export interface DaySignals { opens?: number; dwellSec?: number; likes?: number; shares?: number; repeats?: number; details?: number }
/** Engagement already summed with time decay. */
export interface AppSignals { opens: number; dwellSec: number; likes: number; shares: number; repeats: number; details: number }
export const HALF_LIFE_DAYS = 7;
export const SIGNAL_WINDOW_DAYS = 28;

/** Sum day buckets ({ageDays → counters}) with exponential decay (half-life 7 days). */
export function decaySignals(days: Array<{ ageDays: number; s: DaySignals }>): AppSignals {
  const acc: AppSignals = { opens: 0, dwellSec: 0, likes: 0, shares: 0, repeats: 0, details: 0 };
  for (const { ageDays, s } of days) {
    if (ageDays < 0 || ageDays > SIGNAL_WINDOW_DAYS) continue;
    const w = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    acc.opens += (s.opens ?? 0) * w;
    acc.dwellSec += (s.dwellSec ?? 0) * w;
    acc.likes += (s.likes ?? 0) * w;
    acc.shares += (s.shares ?? 0) * w;
    acc.repeats += (s.repeats ?? 0) * w;
    acc.details += (s.details ?? 0) * w;
  }
  return acc;
}

/**
 * Engagement on a log scale (so one viral app doesn't bury everything) plus a QUALITY term: the share
 * of opens that turned into a like/repeat/long stay, Bayesian-smoothed so 1 open + 1 like ≠ 100%.
 */
export function engagementScore(s: AppSignals, lifetimeRuns = 0): number {
  const volume = s.opens + 0.3 * s.details + 0.05 * Math.min(lifetimeRuns, 10_000);
  const weighted = s.opens * 1 + s.details * 0.3 + s.likes * 4 + s.shares * 6 + s.repeats * 3 + (s.dwellSec / 60) * 0.5;
  const quality = (s.likes * 4 + s.shares * 6 + s.repeats * 3 + (s.dwellSec / 60) * 0.5 + 2) / (volume + 10);
  return Math.log1p(weighted) + 2 * Math.min(quality, 3) * (volume > 0 ? 1 : 0.3);
}

export const FRESH_DAYS = 3;
/** New apps get a boost that fades over ~3 days, so every new app gets seen by some people. */
export function freshnessBoost(publishedAt: number, now: number): number {
  const ageDays = Math.max(0, (now - publishedAt) / 86_400_000);
  return 2.5 * Math.exp(-ageDays / FRESH_DAYS);
}

// ─── Personalisation ─────────────────────────────────────────────────────────────────────────────
export interface Affinity { tags: Record<string, number>; creators: Record<string, number> }
const STOP = new Set(('this that with your from what have will just like make made app apps easy best simple your yours ' +
  'which where when into using used aapka aapki kare karo ke ki ka hai hain aur liye bhi wala wali sabhi koi kuch ' +
  'the and for you are can our all new free').split(/\s+/));

/** Cheap topic tags from name + description (no ML): distinct words ≥4 chars, minus stop words, max 6. */
export function tagsFor(app: { name?: string; description?: string; contentClass?: string }): string[] {
  const text = `${app.name ?? ''} ${app.description ?? ''}`.toLowerCase();
  const words = text.match(/[\p{L}\p{N}]{4,24}/gu) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (STOP.has(w) || /^\d+$/.test(w) || out.includes(w)) continue;
    out.push(w);
    if (out.length >= 6) break;
  }
  if (app.contentClass && app.contentClass !== 'general') out.push(`class:${app.contentClass}`);
  return out;
}

/** 0..~3: how much this viewer's history points at this app. Log-damped so one binge can't take over. */
export function affinityScore(tags: readonly string[], creatorId: string | undefined, a: Affinity | null): number {
  if (!a) return 0;
  let t = 0;
  for (const tag of tags) t += Math.log1p(Math.max(0, a.tags[tag] ?? 0));
  const c = creatorId ? Math.log1p(Math.max(0, a.creators[creatorId] ?? 0)) : 0;
  return Math.min(2, t * 0.4) + Math.min(1, c * 0.5);
}

// ─── Seeded randomness ───────────────────────────────────────────────────────────────────────────
/** Deterministic 0..1 from (seed, id) — FNV-1a + mix. Same seed → same feed → stable pages. */
export function seededUnit(seed: string, id: string): number {
  let h = 0x811c9dc5;
  const s = `${seed}|${id}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function cleanSeed(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : 'global';
}

// ─── Rank ────────────────────────────────────────────────────────────────────────────────────────
export interface RankInput { id: string; publishedAt: number; runs?: number; creatorId?: string; name?: string; description?: string; contentClass?: string }
export const EXPLORATION = 1.2;

export function rankForYou<T extends RankInput>(
  apps: readonly T[],
  opts: { signals: ReadonlyMap<string, AppSignals>; affinity: Affinity | null; seed: string; now: number; maxRun?: number },
): T[] {
  const zero: AppSignals = { opens: 0, dwellSec: 0, likes: 0, shares: 0, repeats: 0, details: 0 };
  const scored = apps.map((a) => {
    const tags = tagsFor(a);
    const score = engagementScore(opts.signals.get(a.id) ?? zero, a.runs ?? 0)
      + affinityScore(tags, a.creatorId, opts.affinity)
      + freshnessBoost(a.publishedAt, opts.now)
      + EXPLORATION * seededUnit(opts.seed, a.id);
    return { a, score, creator: a.creatorId ?? `?${a.id}`, topic: tags[0] ?? '' };
  });
  scored.sort((x, y) => y.score - x.score || y.a.publishedAt - x.a.publishedAt || (x.a.id < y.a.id ? -1 : 1));
  return diversify(scored, opts.maxRun ?? 2).map((s) => s.a);
}

/**
 * Greedy re-order: take the best remaining item that would not make a run longer than `maxRun` of the
 * same creator or same topic. If nothing qualifies (e.g. a store with one creator), take the best anyway.
 */
export function diversify<S extends { creator: string; topic: string }>(sorted: readonly S[], maxRun: number): S[] {
  const left = [...sorted];
  const out: S[] = [];
  const runOf = (key: 'creator' | 'topic', v: string) => {
    if (!v) return 0;
    let n = 0;
    for (let i = out.length - 1; i >= 0 && out[i][key] === v; i--) n++;
    return n;
  };
  while (left.length) {
    let pick = left.findIndex((s) => runOf('creator', s.creator) < maxRun && runOf('topic', s.topic) < maxRun);
    if (pick < 0) pick = 0;
    out.push(left.splice(pick, 1)[0]);
  }
  return out;
}

/** Offset paging over a seed-stable order. */
export function pageOf<T>(list: readonly T[], offset: unknown, limit: unknown): { items: T[]; nextOffset: number | null } {
  const o = Math.max(0, Math.floor(Number(offset) || 0));
  const l = Math.min(500, Math.max(1, Math.floor(Number(limit) || 500)));
  const items = list.slice(o, o + l);
  return { items, nextOffset: o + l < list.length ? o + l : null };
}

/** UTC day key for a timestamp, e.g. 20261014. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
}
