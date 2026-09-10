/**
 * SITE ANALYTICS STORE — the I/O half of `siteAnalytics.ts` (ROADMAP §13, 1.1).
 *
 * Hits are accumulated in memory and flushed to Firestore at most once per
 * `SITE_ANALYTICS_FLUSH_SECONDS` (default 20) per instance, as `FieldValue.increment` merges into
 * sharded per-app-per-day documents. That is `metricsTimeline`'s pattern, chosen for the same two
 * reasons: N Cloud Run instances writing the same document ADD UP by construction, and a busy site
 * costs one write per shard per flush rather than one write per visitor.
 *
 * 🔒 UNIQUES STAY EXACT ACROSS INSTANCES. The visitor's shard is a function of their hash, so every
 * instance that sees that visitor writes `uniq.<hash>: true` to the SAME document — a merge, so two
 * instances writing the same key is one visitor, not two.
 *
 * 🔒 BOUNDED. A shard document holds at most MAX_KEYS_PER_SHARD distinct paths and referrers; new
 * ones beyond that fold into `_other`, so a crawler hitting a million random URLs cannot grow a
 * document past Firestore's 1 MiB. The in-memory buffer is bounded the same way per app-day.
 *
 * 🔒 NEVER THROWS, NEVER BLOCKS A HIT. A failed flush puts the counts back and retries next tick;
 * a failed read returns `available: false`, never zeros. VITEST-skipped like every store here.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import {
  type ShardDoc, type SiteAnalyticsSummary,
  MAX_KEYS_PER_SHARD, OTHER_KEY, dayKey, dayWindow, fieldKey, hitDocId,
  shardCountFor, shardForVisitor, summarize, visitorHash,
} from './siteAnalytics';

export const SITE_ANALYTICS_COLLECTION = 'site_analytics';

export function flushIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SITE_ANALYTICS_FLUSH_SECONDS);
  return (Number.isFinite(raw) && raw >= 5 ? Math.min(300, raw) : 20) * 1000;
}

/**
 * The HMAC secret for the daily visitor hash. `SITE_ANALYTICS_SALT` if set, else the platform's
 * `SECRET_ENCRYPTION_KEY`, else a per-process random value — the last case still hashes (nothing
 * raw is ever stored) but uniques then dedup per instance only, and that degradation is logged
 * once rather than hidden.
 */
let _processSalt: string | null = null;
let _warnedNoSalt = false;
export function hashSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.SITE_ANALYTICS_SALT || env.SECRET_ENCRYPTION_KEY || '').trim();
  if (configured) return configured;
  if (!_processSalt) {
    _processSalt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (!_warnedNoSalt && !env.VITEST) {
      _warnedNoSalt = true;
      console.warn('[siteAnalytics] no SITE_ANALYTICS_SALT / SECRET_ENCRYPTION_KEY — unique visitors dedup per instance only');
    }
  }
  return _processSalt;
}

interface Pending {
  appId: string;
  day: string;
  views: number;
  paths: Map<string, number>;
  refs: Map<string, number>;
  uniq: Set<string>;
}

export interface HitInput {
  appId: string;
  path: string;
  ref: string;
  ip: string;
  userAgent: string;
  nowMs: number;
}

class SiteAnalyticsStore {
  private db: admin.firestore.Firestore | null = null;
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  private getDb(): admin.firestore.Firestore | null {
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

  /** Buffer one hit. Synchronous and cheap — the request has already been answered 204. */
  record(hit: HitInput, env: NodeJS.ProcessEnv = process.env): void {
    const day = dayKey(hit.nowMs);
    const hash = visitorHash(hit.ip, hit.userAgent, day, hashSecret(env));
    const shard = shardForVisitor(hash, shardCountFor(env));
    const id = hitDocId(hit.appId, day, shard);
    let p = this.pending.get(id);
    if (!p) {
      p = { appId: hit.appId, day, views: 0, paths: new Map(), refs: new Map(), uniq: new Set() };
      this.pending.set(id, p);
    }
    p.views += 1;
    bump(p.paths, fieldKey(hit.path));
    if (hit.ref) bump(p.refs, fieldKey(hit.ref));
    p.uniq.add(hash);
    this.arm(env);
  }

  private arm(env: NodeJS.ProcessEnv): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, flushIntervalMs(env));
    // Never keep a process alive for a counter.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Write everything buffered. Safe to call at any time; concurrent calls coalesce. */
  async flush(): Promise<void> {
    if (this.flushing || this.pending.size === 0) return;
    const db = this.getDb();
    if (!db) { this.pending.clear(); return; }
    this.flushing = true;
    const batch = this.pending;
    this.pending = new Map();
    try {
      const inc = admin.firestore.FieldValue.increment;
      await Promise.all([...batch.entries()].map(([id, p]) => {
        const update: Record<string, unknown> = {
          appId: p.appId, day: p.day, views: inc(p.views),
          updatedAt: Date.now(),
        };
        for (const [k, v] of p.paths) update[`paths.${k}`] = inc(v);
        for (const [k, v] of p.refs) update[`refs.${k}`] = inc(v);
        for (const h of p.uniq) update[`uniq.${h}`] = true;
        return db.collection(SITE_ANALYTICS_COLLECTION).doc(id).set(update, { merge: true });
      }));
    } catch (err) {
      // Put the deltas back so nothing is lost; the next hit re-arms the timer.
      for (const [id, p] of batch) {
        const cur = this.pending.get(id);
        if (!cur) { this.pending.set(id, p); continue; }
        cur.views += p.views;
        for (const [k, v] of p.paths) bump(cur.paths, k, v);
        for (const [k, v] of p.refs) bump(cur.refs, k, v);
        for (const h of p.uniq) cur.uniq.add(h);
      }
      console.warn('[siteAnalytics] flush failed, will retry:', (err as Error)?.message ?? err);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The summary for one app over the last `days` days. Reads `days × shards` documents by id —
   * bounded, and the ids are known in advance so no query index is needed.
   */
  async summary(appId: string, days: number, nowMs = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<SiteAnalyticsSummary> {
    const db = this.getDb();
    if (!db) return { available: false, reason: 'store-unavailable' };
    // Flush first so "today" includes the last few seconds — the number the user is looking at.
    await this.flush().catch(() => undefined);
    const shards = shardCountFor(env);
    const refs = dayWindow(nowMs, days).flatMap((d) =>
      Array.from({ length: shards }, (_, s) => db.collection(SITE_ANALYTICS_COLLECTION).doc(hitDocId(appId, d, s))));
    try {
      const snaps = await db.getAll(...refs);
      const docs = snaps.map((s) => (s.exists ? (s.data() as Partial<ShardDoc>) : null));
      return summarize(docs, { todayMs: nowMs, days });
    } catch (err) {
      console.warn('[siteAnalytics] summary read failed:', (err as Error)?.message ?? err);
      return { available: false, reason: 'store-unavailable' };
    }
  }

  /** Test seam / shutdown: drop the buffer without writing. */
  _reset(): void { this.pending.clear(); if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  /** Test seam: what is buffered right now. */
  _pendingSize(): number { return this.pending.size; }
}

/** Increment a bounded map; past the key cap, fold into `_other` so a document can never overflow. */
function bump(m: Map<string, number>, key: string, by = 1): void {
  const k = m.has(key) || m.size < MAX_KEYS_PER_SHARD ? key : OTHER_KEY;
  m.set(k, (m.get(k) ?? 0) + by);
}

export const siteAnalyticsStore = new SiteAnalyticsStore();
