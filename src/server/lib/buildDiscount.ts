// THE BUILD DISCOUNT — a percentage the admin sets, taken off every charged build (2026-09-25).
//
// Admin, verbatim: *"kya ham user ko lubhane ke liye har build par kuch % discount de sakte hai? agar
// admin discount = 0% (default) set kar to abhi jaise chal raha hai, baise hi chale. agar admin discount
// = yy% fix kar de to, har build me likh kar aye … green colour me likh kar aye, discount!!"* — and,
// asked where the number should live, *"b"*: a box in the admin panel, not a Cloud Run key.
//
// 🔒 THREE RULES, and each one is a sentence the admin agreed to before a line was written:
//
//   1. **0% IS TODAY, EXACTLY.** The default is zero, an unreadable stored value is zero, and a stored
//      value that cannot be READ is zero. Every way this can go wrong leaves the user paying the price
//      they would have paid before this module existed — never a price we did not choose.
//   2. **THE DISCOUNT COMES OUT OF OUR MARGIN, NEVER OUT OF OUR COST.** The bill never goes below what
//      the build really cost us (tokens + the VM). A typo of 90 would otherwise sell every build at a
//      loss. So a build already billed at cost — the preview-waiver case, a stopped build on its floor
//      — gets no discount at all, and one close to cost gets only what the margin can carry.
//   3. **THE PERCENTAGE SHOWN IS THE ONE APPLIED.** When the floor bites, the user is shown the
//      percentage they actually received, not the one configured: "20% off" beside a ₹5 saving on a
//      ₹150 bill is a false statement, and India's consumer rules on dark patterns (CCPA, 2023) treat
//      a misstated discount exactly that way.
//
// ⚠️ WHAT IT DOES NOT TOUCH: chat, Professionals, Doctor AI and the tools. The admin said "har build";
// the wallet's per-message charges are a different product with their own free allowance.
//
// ⚠️ WHITE-LABEL: nothing here reaches the user except three numbers — the build's price, the
// discount, and what they pay. Our real cost is the FLOOR, and it stays on the server; it is never
// sent, and never derivable, because the user only ever sees the discount when the floor did NOT bite
// (or the reduced figure when it did, which reveals no more than "the discount was smaller").
//
// PURE above the store. The store reads one Firestore document through a short cache.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

/** The highest percentage the admin panel accepts. A ceiling, not a suggestion: see rule 2. */
export const BUILD_DISCOUNT_MAX_PCT = 50;

/** `platform_settings/build_discount` — one document, written only by an admin route. */
export const PLATFORM_SETTINGS_COLLECTION = 'platform_settings';
export const BUILD_DISCOUNT_DOC = 'build_discount';

/**
 * A stored or typed value → a whole percentage in [0, 50]. PURE.
 *
 * Unreadable ⇒ 0, never the maximum: someone who wanted a discount would have typed a number, so a
 * value that is present and unreadable can never have meant "the biggest one". The same reasoning
 * `parseRolloutPercent` uses. A trailing `%` and surrounding spaces are what an operator actually
 * types, so they are accepted.
 */
export function normalizeDiscountPct(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const text = typeof raw === 'number' ? String(raw) : String(raw).trim().replace(/%$/, '').trim();
  if (!text) return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(BUILD_DISCOUNT_MAX_PCT, Math.round(n));
}

export interface BuildDiscount {
  /** The price before the discount (USD) — exactly the bill every other rule decided. */
  listUsd: number;
  /** What was taken off (USD). 0 when nothing was. */
  discountUsd: number;
  /** What the user pays (USD). Never more than `listUsd`, never less than our cost. */
  payUsd: number;
  /** The percentage the user actually received, whole. May be below the configured one (rule 3). */
  pctApplied: number;
  /** The percentage the admin configured. */
  pctConfigured: number;
  /** True when our cost stopped the discount short of the configured percentage. */
  flooredAtCost: boolean;
}

/**
 * Take the configured discount off a decided bill, never below our real cost. PURE, never throws.
 *
 * `floorUsd` is what the build really cost us (tokens + VM). A bill at or below it is returned
 * unchanged — that bill already carries no margin to give away.
 */
export function applyBuildDiscount(input: { billedUsd: number; floorUsd: number; pct: number }): BuildDiscount {
  const billed = Number.isFinite(input.billedUsd) ? Math.max(0, input.billedUsd) : 0;
  const floor = Number.isFinite(input.floorUsd) ? Math.max(0, input.floorUsd) : 0;
  const pct = normalizeDiscountPct(input.pct);
  const none: BuildDiscount = {
    listUsd: billed, discountUsd: 0, payUsd: billed, pctApplied: 0, pctConfigured: pct, flooredAtCost: false,
  };
  if (pct === 0 || billed <= 0 || floor >= billed) {
    return { ...none, flooredAtCost: pct > 0 && billed > 0 && floor >= billed };
  }
  const wanted = billed * (1 - pct / 100);
  const pay = Math.max(wanted, floor);
  const discount = billed - pay;
  // Whole percent, rounded DOWN: "you saved 13%" must never overstate a 12.6% saving.
  const applied = Math.floor((discount / billed) * 100 + 1e-9);
  if (discount <= 0 || applied <= 0) {
    return { ...none, flooredAtCost: true };
  }
  return {
    listUsd: billed,
    discountUsd: discount,
    payUsd: pay,
    pctApplied: applied,
    pctConfigured: pct,
    flooredAtCost: pay > wanted,
  };
}

/** How long one instance trusts its copy of the setting. A change reaches every instance within it. */
export const BUILD_DISCOUNT_CACHE_MS = 60_000;

export interface BuildDiscountSetting {
  pct: number;
  updatedAt: number | null;
  updatedBy: string | null;
}

/**
 * The setting's storage. Reads are cached for a minute per instance; a read that FAILS returns 0% —
 * the ordinary price — and is not cached, so the next build asks again.
 */
export class BuildDiscountStore {
  private cached: { value: BuildDiscountSetting; at: number } | null = null;

  constructor(private readonly dbFactory: () => admin.firestore.Firestore | null = () => {
    try { return getServerDb() as unknown as admin.firestore.Firestore; } catch { return null; }
  }) {}

  async read(nowMs = Date.now()): Promise<BuildDiscountSetting> {
    if (this.cached && nowMs - this.cached.at < BUILD_DISCOUNT_CACHE_MS) return this.cached.value;
    const db = this.dbFactory();
    if (!db) return { pct: 0, updatedAt: null, updatedBy: null };
    try {
      const snap = await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(BUILD_DISCOUNT_DOC).get();
      const data = (snap.exists ? snap.data() : undefined) as { pct?: unknown; updatedAt?: unknown; updatedBy?: unknown } | undefined;
      const value: BuildDiscountSetting = {
        pct: normalizeDiscountPct(data?.pct),
        updatedAt: typeof data?.updatedAt === 'number' ? data.updatedAt : null,
        updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : null,
      };
      this.cached = { value, at: nowMs };
      return value;
    } catch (e) {
      console.error('[BUILD_DISCOUNT] could not read the setting — charging the ordinary price:', e);
      return { pct: 0, updatedAt: null, updatedBy: null };
    }
  }

  /**
   * `read`, bounded. The settle awaits this before charging, so a Firestore read that hangs must not
   * hold a finished build's result: past `ms` the answer is 0% — the ordinary price, rule 1.
   */
  async readWithin(ms = 2_000, nowMs = Date.now()): Promise<BuildDiscountSetting> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<BuildDiscountSetting>((resolve) => {
      timer = setTimeout(() => resolve({ pct: 0, updatedAt: null, updatedBy: null }), ms);
    });
    try {
      return await Promise.race([this.read(nowMs), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Write a new percentage. Returns what was stored (normalized). Throws when it could not be saved. */
  async write(rawPct: unknown, updatedBy: string, nowMs = Date.now()): Promise<BuildDiscountSetting> {
    const db = this.dbFactory();
    if (!db) throw new Error('The database is not reachable.');
    const value: BuildDiscountSetting = { pct: normalizeDiscountPct(rawPct), updatedAt: nowMs, updatedBy };
    await db.collection(PLATFORM_SETTINGS_COLLECTION).doc(BUILD_DISCOUNT_DOC).set(value, { merge: true });
    this.cached = { value, at: nowMs };
    return value;
  }

  /** Test seam: forget the cached copy. */
  reset(): void { this.cached = null; }
}

export const buildDiscountStore = new BuildDiscountStore();

/**
 * The one line the user reads under a discounted build. Branded, names no cost and no vendor. PURE.
 * Empty when nothing was taken off, so a 0% build reads exactly as it does today.
 */
export function buildDiscountLine(d: { listInr: number; discountInr: number; payInr: number; pct: number }): string {
  if (!(d.discountInr > 0) || !(d.pct > 0)) return '';
  return `Build price ₹${d.listInr.toFixed(2)} · Discount ${d.pct}% (−₹${d.discountInr.toFixed(2)}) · You pay ₹${d.payInr.toFixed(2)}`;
}
