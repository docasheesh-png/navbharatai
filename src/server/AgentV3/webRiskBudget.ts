// THE SPEND CEILING FOR THE OUTBOUND CHECK — so this feature cannot become a bill.
//
// Web Risk's Lookup API (`uris:search`, the one `webRisk.ts` calls) is FREE for the first 100,000
// calls per month and $0.50 per 1,000 after that. In normal use we are nowhere near it — the cache in
// `webRisk.ts` collapses the same `api.stripe.com` across hundreds of apps into a single lookup, so
// spend scales with DISTINCT HOSTS, not with publishes.
//
// 🔴 BUT "nowhere near it in normal use" is not a bound, and this module exists because that
// distinction is the whole difference between a safety feature and an unbounded cost. The daily
// re-scan is capped at 200 apps × 60 origins, so the theoretical ceiling was 12,000 lookups a day —
// ~360,000 a month, ~$130 — if every app pointed at 60 hosts nobody else pointed at. That will not
// happen; it was still a path with no ceiling on it, and a path with no ceiling is one bad month away
// from being a surprise on the admin's invoice.
//
// 🔒 THE FAIL DIRECTION IS DELIBERATELY THE OPPOSITE OF `jobLease.ts`, and the contrast is the reason
// both are right. A lease that cannot be read runs the job anyway, because a scheduled purge that
// never runs is worse than one that runs twice. A budget that cannot be read spends NOTHING, because
// the cost of not looking up is exactly zero and changes no outcome: an unchecked origin is `unknown`,
// and `webRisk.ts` / `outboundRescan.ts` already refuse to act on an `unknown`. So the worst case here
// is the honest "could NOT be checked" line the admin already sees — never a silent charge.
//
// 🔒 AND IT IS NOT SILENT. Exhausting the budget shows up in the same `outboundNote` as any other
// unchecked host, because the verdict really is the same: we did not ask.

import { scanOrigins, type WebRiskScan } from './webRisk';

/** Google's free allowance for the Lookup API. The default ceiling, so the feature costs ₹0 unless raised. */
export const FREE_TIER_LOOKUPS_PER_MONTH = 100_000;

/** One document per calendar month — a month that has ended is never written again. */
export const WEB_RISK_BUDGET_COLLECTION = 'web_risk_budget';

/**
 * The month a lookup is charged to, in UTC. PURE.
 *
 * UTC rather than local because Google's quota resets on ITS calendar, not on ours, and a bucket that
 * disagrees with the biller is a bucket that over- or under-counts at every month boundary.
 */
export function budgetMonthKey(nowMs: number): string {
  const d = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * How many lookups a month may spend. PURE.
 *
 * 🔒 AN UNREADABLE VALUE FALLS BACK TO THE FREE TIER, NOT TO UNLIMITED — the same reasoning as
 * `parseRolloutPercent`: someone who wanted the default would have left the key unset, so a value that
 * is present and unparseable can never have meant "spend without limit". An explicit `0` is a real,
 * supported setting meaning "record the origins but ask Google nothing".
 */
export function lookupBudgetLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = String(env.NAVBHARAT_WEB_RISK_MAX_LOOKUPS ?? '').trim();
  if (!raw) return FREE_TIER_LOOKUPS_PER_MONTH;
  const n = Number(raw.replace(/[_,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[WEBRISK] NAVBHARAT_WEB_RISK_MAX_LOOKUPS="${raw}" is not a number — using the free tier (${FREE_TIER_LOOKUPS_PER_MONTH}).`);
    return FREE_TIER_LOOKUPS_PER_MONTH;
  }
  return Math.floor(n);
}

/** How many of `want` lookups this caller may make, given what the month has already spent. PURE. */
export function grantableLookups(used: number, want: number, limit: number): number {
  const u = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;
  const w = Number.isFinite(want) && want > 0 ? Math.floor(want) : 0;
  const l = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  return Math.max(0, Math.min(w, l - u));
}

/** The Firestore surface this needs — narrowed so tests never touch a database. */
export interface BudgetStore {
  runTransaction<T>(fn: (tx: {
    get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(ref: unknown, value: Record<string, unknown>): void;
  }) => Promise<T>): Promise<T>;
  collection(name: string): { doc(id: string): unknown };
}

/**
 * Take `want` lookups out of this month's budget, returning how many were actually granted.
 *
 * 🔒 RESERVE BEFORE SPENDING, NEVER COUNT AFTERWARDS. A counter incremented after the calls have been
 * made loses everything a crash interrupts, and every lost increment is real money we then spend
 * again. Reserving first means a crash costs us budget we did not use — an error in the direction that
 * cannot produce a bill.
 *
 * 🔒 A TRANSACTION, because two instances publishing at the same moment must not both read the same
 * `used` and both believe the remainder is theirs.
 */
export async function reserveLookups(
  store: BudgetStore | null | undefined,
  opts: { want: number; nowMs?: number; limit?: number },
): Promise<number> {
  const want = Number.isFinite(opts.want) && opts.want > 0 ? Math.floor(opts.want) : 0;
  if (want <= 0) return 0;
  const limit = Number.isFinite(opts.limit) ? Number(opts.limit) : lookupBudgetLimit();
  if (limit <= 0) return 0;
  // See the header: no store means no spending. The result is an honest "unchecked", never a charge.
  if (!store) return 0;
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const key = budgetMonthKey(nowMs);
  try {
    const ref = store.collection(WEB_RISK_BUDGET_COLLECTION).doc(key);
    return await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? Number((snap.data() || {}).used) : 0;
      const grant = grantableLookups(used, want, limit);
      if (grant <= 0) return 0;
      tx.set(ref, { month: key, used: (Number.isFinite(used) && used > 0 ? Math.floor(used) : 0) + grant, updatedAt: nowMs });
      return grant;
    });
  } catch {
    return 0;
  }
}

/**
 * Hand back lookups that were reserved but not used — the cache-hit case, which is the common one.
 *
 * Without this the budget would be spent on origins we never asked Google about, and a platform whose
 * apps all point at the same twenty hosts would exhaust a 100,000-call allowance having made almost no
 * calls. A release that fails is simply lost budget: conservative, and never a charge.
 */
export async function releaseLookups(
  store: BudgetStore | null | undefined,
  opts: { unused: number; nowMs?: number },
): Promise<void> {
  const unused = Number.isFinite(opts.unused) && opts.unused > 0 ? Math.floor(opts.unused) : 0;
  if (unused <= 0 || !store) return;
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const key = budgetMonthKey(nowMs);
  try {
    const ref = store.collection(WEB_RISK_BUDGET_COLLECTION).doc(key);
    await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const used = snap.exists ? Number((snap.data() || {}).used) : 0;
      const next = Math.max(0, (Number.isFinite(used) && used > 0 ? Math.floor(used) : 0) - unused);
      tx.set(ref, { month: key, used: next, updatedAt: nowMs });
    });
  } catch { /* lost budget, never a charge — see the doc comment */ }
}

export interface BudgetedScan extends WebRiskScan {
  /** True when at least one origin went unchecked because the month's budget was spent. */
  budgetExhausted: boolean;
  /** What the month's budget granted this scan. */
  granted: number;
}

/**
 * The ONE way the platform calls Web Risk. Both callers (publish and the daily re-scan) go through
 * here so the reserve/release dance exists once rather than being repeated — and so a third caller
 * added later cannot accidentally spend outside the ceiling.
 */
export async function scanOriginsWithBudget(opts: {
  origins: readonly string[];
  token: string | null;
  store: BudgetStore | null | undefined;
  nowMs?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<BudgetedScan> {
  const origins = opts.origins ?? [];
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const granted = await reserveLookups(opts.store, { want: origins.length, nowMs, limit: opts.limit });
  const scan = await scanOrigins({
    origins,
    token: opts.token,
    nowMs,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    maxLookups: granted,
  });
  await releaseLookups(opts.store, { unused: granted - scan.lookups, nowMs });
  return { ...scan, granted, budgetExhausted: scan.skippedForBudget > 0 };
}
