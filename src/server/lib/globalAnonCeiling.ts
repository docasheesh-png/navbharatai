// THE PLATFORM-WIDE ANONYMOUS CEILING, FOR LIMITERS THAT DO NOT WRITE PER REQUEST (audit 2026-10-11, F5).
//
// `rateLimiter({ durable: false, anonGlobalPerHour })` declared a ceiling on anonymous traffic across every
// instance — `app-ai` (20,000/h), `app-ai-image` (5,000/h), `store-data-write`, `site-hit`, `devapi` — and then
// returned before the code that enforces it, because `durable: false` exists to avoid a Firestore write on every
// request (it was the top cause of daily write-quota exhaustion). So the two limiters that SPEND money (an app's
// AI answers and pictures) had no platform-wide cap at all, only a per-address one a botnet walks past.
//
// This counts locally and folds the count into one shared Firestore document per limiter per hour at most once
// every FLUSH_MS per instance: an `increment(n)` and a read of the total. The ceiling is therefore enforced
// within a few seconds' worth of traffic per instance, at ~6 writes a minute per instance instead of one per
// request. FAIL-OPEN like every limiter here: a store that cannot answer leaves the per-address limits in force.

import * as admin from 'firebase-admin';
import { doc, getDoc, setDoc, getServerDb } from './serverDb';
import { windowExpiry } from './DurableRateLimit';

/** The storage this needs: add `n` to a window's shared count and return the total. */
export interface GlobalCounterStore {
  addAndRead(name: string, windowIndex: number, n: number, windowMs: number, now: number): Promise<number>;
}

export const FLUSH_MS = 10_000;
const HOUR_MS = 60 * 60 * 1000;

/** One limiter's view of a platform-wide count. Pure apart from the store it is given. */
export class BatchedGlobalCounter {
  private windowIndex = -1;
  private known = 0;
  private unflushed = 0;
  /** Counted locally and sent, but not yet folded into `known` — still part of the total until it is. */
  private inFlight = 0;
  private lastFlushAt = -Infinity;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly name: string,
    private readonly ceiling: number,
    private readonly store: GlobalCounterStore,
    private readonly windowMs: number = HOUR_MS,
    private readonly flushMs: number = FLUSH_MS,
  ) {}

  /** Count one anonymous request; false once the platform-wide total (as last seen) has reached the ceiling. */
  allow(now: number): boolean {
    const idx = Math.floor(now / Math.max(1, this.windowMs));
    if (idx !== this.windowIndex) {
      this.windowIndex = idx;
      this.known = 0;
      this.unflushed = 0;
      this.inFlight = 0;
    }
    if (this.known + this.inFlight + this.unflushed >= this.ceiling) {
      this.maybeFlush(now); // keep learning the total, so the window's end is noticed
      return false;
    }
    this.unflushed++;
    this.maybeFlush(now);
    return true;
  }

  /** Settles the flush in flight (tests). */
  async settled(): Promise<void> {
    await this.flushing;
  }

  private maybeFlush(now: number): void {
    if (this.flushing || now - this.lastFlushAt < this.flushMs) return;
    this.lastFlushAt = now;
    const n = this.unflushed;
    const idx = this.windowIndex;
    this.unflushed = 0;
    this.inFlight = n;
    this.flushing = this.store.addAndRead(this.name, idx, n, this.windowMs, now)
      .then((total) => { if (idx === this.windowIndex && Number.isFinite(total)) { this.known = total; this.inFlight = 0; } })
      .catch(() => { if (idx === this.windowIndex) { this.unflushed += this.inFlight; this.inFlight = 0; } }) // fail-open: keep counting locally
      .finally(() => { this.flushing = null; });
  }
}

/** The Firestore store: one document per limiter per window, in the durable limiter's collection. */
export const firestoreGlobalCounterStore: GlobalCounterStore = {
  async addAndRead(name, windowIndex, n, windowMs, now) {
    const db = getServerDb();
    if (!db) throw new Error('no store');
    const ref = doc(db, 'rate_limits_v1', `global_anon__${name.replace(/[^A-Za-z0-9_-]/g, '_')}__${windowIndex}`);
    if (n > 0) {
      await setDoc(ref, {
        name, key: 'GLOBAL_ANON', windowMs, updatedAt: now,
        count: admin.firestore.FieldValue.increment(n),
        expireAt: admin.firestore.Timestamp.fromDate(windowExpiry(now, windowMs)),
      }, { merge: true });
    }
    const snap = await getDoc(ref);
    return Number(snap.data()?.count || 0);
  },
};

/** One counter per limiter NAME (a closed set: the limiters declared in the route files). */
const counters = new Map<string, BatchedGlobalCounter>();

export function globalAnonCounter(name: string, ceiling: number): BatchedGlobalCounter {
  let c = counters.get(name);
  if (!c) {
    c = new BatchedGlobalCounter(name, ceiling, firestoreGlobalCounterStore);
    counters.set(name, c);
  }
  return c;
}
