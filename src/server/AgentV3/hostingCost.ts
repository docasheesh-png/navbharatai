// WHAT A HOSTED APP ACTUALLY COST, AND WHAT THE USER PAYS FOR IT (ROADMAP §11, slice 2. Admin
// decision D5, 2026-09-07: "hamara jo bhi kharcha ayega, usme 20+% add kar ke user se charge karenge").
//
// 🔒 THE LAW THIS FILE INHERITS, FROM sandboxCost.ts. That module bills the user for real E2B VM time
// ONLY when the admin has explicitly set the real rate — because its own default is "a ROUND,
// conservative placeholder", and charging a real person money on a number nobody verified is exactly
// what the billing law forbids. Hosting has the same shape and therefore the same rule, applied per
// line: a cost line whose rate is not set bills ZERO and is NAMED as unbilled. Partial configuration
// under-bills, which is safe for the user; it can never over-bill.
//
// 🔴 AND THE CONDITION D5 WAS RECORDED WITH — the one that decides whether 20% is a margin or a loss.
// "Our cost" for a hosted app is not one number. It is four:
//   1. COMPUTE   — Cloud Run vCPU-seconds, GiB-seconds and requests
//   2. EGRESS    — bytes out, billed separately, and the line that surprises people: an app serving
//                  images or video can have egress dwarf its compute. Metering compute alone and
//                  adding 20% makes every bandwidth-heavy app a LOSS.
//   3. BUILD     — Cloud Build minutes, spent on every deploy
//   4. STORAGE   — the container image and the app's own bytes
// All four are metered here. A future edit that drops one does not "simplify the pricing", it
// re-introduces the loss D5 was written to prevent.
//
// ON GOOGLE'S FREE TIER, honestly: Cloud Run gives a monthly free allowance per BILLING ACCOUNT, not
// per app, so it cannot be fairly divided between users. It is treated as reducing NavBharatAI's own
// bill rather than any one user's, and the rate used here is the MARGINAL one — what the next unit
// actually costs once the platform's own usage has consumed the allowance. That is the rate a real
// invoice will show, which is the only rate a user may be charged.
//
// PURE — measured units in, money out. No clock, no network.

/** Measured usage for one app over one billing window. Every field is a MEASUREMENT, never an estimate. */
export interface HostingUsage {
  /** Cloud Run vCPU-seconds. */
  cpuSeconds: number;
  /** Cloud Run GiB-seconds of memory. */
  memoryGibSeconds: number;
  /** Requests served. */
  requests: number;
  /** Bytes out, in GiB. THE LINE THAT MUST NOT BE FORGOTTEN — see the header. */
  egressGib: number;
  /** Cloud Build minutes spent building this app. */
  buildMinutes: number;
  /** GiB-months of image + object storage held for this app. */
  storageGibMonths: number;
}

/** The four D5 cost lines, as the admin report names them. */
export type HostingCostLine = 'compute' | 'egress' | 'build' | 'storage';

/** USD per unit. Every one is admin-set; there are deliberately NO defaults. See the header. */
export interface HostingRates {
  /** USD per vCPU-second. */
  cpuSecond: number | null;
  /** USD per GiB-second. */
  memoryGibSecond: number | null;
  /** USD per million requests. */
  millionRequests: number | null;
  /** USD per GiB out. */
  egressGib: number | null;
  /** USD per build minute. */
  buildMinute: number | null;
  /** USD per GiB-month. */
  storageGibMonth: number | null;
}

/**
 * One rate, or null.
 *
 * ⚠️ THE EMPTY STRING IS CHECKED FIRST, and that is not defensive noise: `Number('')` is **0**, not
 * NaN, so an unset rate would otherwise arrive as a perfectly valid price of zero — the line would
 * bill nothing AND report itself as configured, which is the exact "silently under-bills while looking
 * healthy" outcome this module exists to prevent. Same family as the `Number('20%') is NaN` trap
 * CLAUDE.md records for the rollout percentages. PURE.
 */
function rate(raw: string | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The rates, from the admin's own Google bill.
 *
 * 🔒 NO DEFAULTS, ON PURPOSE. Cloud Run's price varies by region, by CPU-allocation mode and over time.
 * A hardcoded number would be a placeholder, and this file's inherited law is that a placeholder is
 * never charged to a real person. An unset rate means that line bills zero until somebody reads the
 * real figure off a real invoice. PURE.
 */
export function hostingRates(env: NodeJS.ProcessEnv = process.env): HostingRates {
  return {
    cpuSecond: rate(env.NAVBHARAT_RATE_CPU_SECOND),
    memoryGibSecond: rate(env.NAVBHARAT_RATE_MEMORY_GIB_SECOND),
    millionRequests: rate(env.NAVBHARAT_RATE_MILLION_REQUESTS),
    egressGib: rate(env.NAVBHARAT_RATE_EGRESS_GIB),
    buildMinute: rate(env.NAVBHARAT_RATE_BUILD_MINUTE),
    storageGibMonth: rate(env.NAVBHARAT_RATE_STORAGE_GIB_MONTH),
  };
}

/** The markup over real cost. D5 set this at 20%; env-tunable because a price is a decision. */
export function hostingMarkupPct(env: NodeJS.ProcessEnv = process.env): number {
  // Empty-string-first, for the same reason as `rate()` above: `Number('')` is 0, so an unset value
  // would silently mean "charge cost with NO markup" while looking deliberately configured.
  const s = String(env.NAVBHARAT_HOSTING_MARKUP_PCT ?? '').trim();
  if (s === '') return 20;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

export interface HostingCost {
  /** Our real measured cost, before markup, in USD. */
  usd: number;
  /** Per-line breakdown — ADMIN-only, never shown to a user (White-Label Law §3). */
  lines: Record<HostingCostLine, number>;
  /**
   * Lines that were NOT billed because their rate is unset. Never silent: an under-bill nobody knows
   * about looks exactly like a healthy margin until the invoice arrives.
   */
  unbilled: HostingCostLine[];
}

const nonNegative = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What this app really cost us over the measured window.
 *
 * Every line is `measured units × an admin-set rate`. A line with no rate contributes ZERO and is
 * listed in `unbilled` — the same choice sandboxCost makes, for the same reason. PURE.
 */
export function hostingCostUsd(usage: Partial<HostingUsage> | null | undefined, env: NodeJS.ProcessEnv = process.env): HostingCost {
  const u = usage ?? {};
  const r = hostingRates(env);
  const unbilled: HostingCostLine[] = [];

  // COMPUTE — three meters, one line. Any of the three rates missing under-bills the line rather than
  // guessing the missing piece, and the line is flagged so the gap is visible.
  const computeParts: Array<[number | null, number]> = [
    [r.cpuSecond, nonNegative(u.cpuSeconds)],
    [r.memoryGibSecond, nonNegative(u.memoryGibSeconds)],
    [r.millionRequests, nonNegative(u.requests) / 1_000_000],
  ];
  let compute = 0;
  let computeIncomplete = false;
  for (const [price, units] of computeParts) {
    if (price === null) { if (units > 0) computeIncomplete = true; continue; }
    compute += price * units;
  }
  if (computeIncomplete) unbilled.push('compute');

  const line = (price: number | null, units: number, name: HostingCostLine): number => {
    const q = nonNegative(units);
    if (price === null) { if (q > 0) unbilled.push(name); return 0; }
    return price * q;
  };
  const egress = line(r.egressGib, nonNegative(u.egressGib), 'egress');
  const build = line(r.buildMinute, nonNegative(u.buildMinutes), 'build');
  const storage = line(r.storageGibMonth, nonNegative(u.storageGibMonths), 'storage');

  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    usd: round(compute + egress + build + storage),
    lines: { compute: round(compute), egress: round(egress), build: round(build), storage: round(storage) },
    unbilled,
  };
}

/** Is charging for hosting switched on at all? Default OFF — the money path stays inert until asked. */
export function hostingBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.NAVBHARAT_BILL_HOSTING ?? '').trim().toLowerCase() === 'on';
}

/**
 * What the USER is charged: real cost + the D5 markup — or zero.
 *
 * 🔒 TWO CONDITIONS, exactly as sandboxCost requires: the admin has switched billing on, AND there is
 * a real measured cost to mark up. A cost of zero (nothing metered, or no rate configured) charges
 * nothing — never a minimum, never a rounded-up token. PURE.
 */
export function hostingBillableUsd(cost: HostingCost | null | undefined, env: NodeJS.ProcessEnv = process.env): number {
  if (!cost || !(cost.usd > 0)) return 0;
  if (!hostingBillingEnabled(env)) return 0;
  const withMarkup = cost.usd * (1 + hostingMarkupPct(env) / 100);
  return Math.round(withMarkup * 1e6) / 1e6;
}

/**
 * One line for the ADMIN report — why this app was or was not billed, and for how much.
 *
 * Names the unbilled lines explicitly. An under-bill nobody knows about is indistinguishable from a
 * healthy margin right up until the Google invoice arrives, which is the failure this sentence exists
 * to prevent. Never shown to a user. PURE.
 */
export function hostingCostNote(cost: HostingCost | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  if (!cost || !(cost.usd > 0)) {
    const gaps = cost?.unbilled.length ? ` No rate set for: ${cost.unbilled.join(', ')}.` : '';
    return `Hosting: nothing measured to bill.${gaps}`;
  }
  const parts = (Object.entries(cost.lines) as Array<[HostingCostLine, number]>)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} $${v.toFixed(6)}`)
    .join(' + ');
  const gaps = cost.unbilled.length ? ` ⚠️ NOT billed (no rate set): ${cost.unbilled.join(', ')}.` : '';
  if (!hostingBillingEnabled(env)) {
    return `Hosting cost $${cost.usd.toFixed(6)} (${parts}) — absorbed by NavBharatAI (NAVBHARAT_BILL_HOSTING is off).${gaps}`;
  }
  const billed = hostingBillableUsd(cost, env);
  return `Hosting cost $${cost.usd.toFixed(6)} (${parts}) → billed $${billed.toFixed(6)} at +${hostingMarkupPct(env)}%.${gaps}`;
}
