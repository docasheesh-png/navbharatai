// HOW MUCH TRAFFIC A FRONTEND-ONLY APP SERVED — the meter the plans were sold against.
//
// 🔴 THE GAP THIS CLOSES, AND WHY IT WAS INVISIBLE. `hostingUsage.ts` reads
// `run.googleapis.com/container/network/sent_bytes_count`, which is a CLOUD RUN metric. A
// frontend-only app has no Cloud Run service at all — it is a bundle on Firebase Hosting — so it was
// never counted and never billable. Every `includedFrontendGb` figure in `hostingTiers.ts` (Free 5,
// Starter 25, Growth 100 GB) was decoration.
//
// 🔒 AND THERE IS NO SERVER-SIDE NUMBER TO READ, which is the whole reason this module looks the way
// it does. Google's Firebase Hosting meters are per SITE. Every published app is a CHANNEL on one
// shared site, so no Google metric can attribute a byte to an app. The delivering BROWSER can, and
// does: `parseBytesReport` in `siteAnalytics.ts` collects `PerformanceResourceTiming.transferSize`,
// which is that browser's own count of what it actually transferred.
//
// 🔴 IT IS A FLOOR, NOT A BILL, AND NOTHING HERE CHARGES ANYBODY. Two gaps, both under-counting:
// a caller that runs no JavaScript (a bot, a scraper, `curl`) costs real egress and is invisible;
// and an owner who strips the beacon from their own HTML reports nothing. Under-counting can never
// over-charge, which is the only direction the billing law permits being wrong in — but it also
// means this figure is not yet fit to take money against. Closing the gaps needs a meter in the
// SERVING path (the Cloudflare Worker, or a per-host log-based metric), which is admin work.
//
// PURE. The I/O is the analytics store the sweep already has.

import { overageFrontendInr, tierForPlanId, FREE_FRONTEND_GB, type HostingTier } from '../../lib/hostingTiers';

const GIB = 1024 ** 3;

export interface FrontendUsage {
  /** Bytes the browsers of this owner's visitors reported, summed across every app. */
  bytes: number;
  /** Apps whose figure we could read. */
  appsMeasured: number;
  /** Apps whose figure we could NOT read — never folded into the total as a zero. */
  appsUnmeasured: number;
}

/**
 * Sum what the meter saw for one owner.
 *
 * 🔒 NULL AND ZERO STAY DIFFERENT, the rule `sumTimeSeries` already enforces one module over. An app
 * whose analytics could not be read is COUNTED AS UNMEASURED, not as zero — a zero would look exactly
 * like an app nobody visited, and the difference is the whole point of reporting a gap. PURE.
 */
export function sumFrontendBytes(perApp: ReadonlyArray<number | null>): FrontendUsage {
  let bytes = 0;
  let appsMeasured = 0;
  let appsUnmeasured = 0;
  for (const b of perApp) {
    if (b === null || !Number.isFinite(b) || (b as number) < 0) { appsUnmeasured++; continue; }
    bytes += b as number;
    appsMeasured++;
  }
  return { bytes, appsMeasured, appsUnmeasured };
}

export interface FrontendVerdict {
  gb: number;
  includedGb: number;
  overGb: number;
  /** What this WOULD cost at the published overage rate. Never charged — see the header. */
  wouldBillInr: number;
  /** True when at least one of the owner's apps could not be measured. */
  incomplete: boolean;
  /** The admin line. Never user-facing: it discusses our own metering. */
  note: string;
}

/**
 * What this owner's frontend traffic means against the plan they bought.
 *
 * The allowance is the OWNER'S and covers all their sites together — the same rule the backend meter
 * already follows, and the same rule their agreement states. Billing each app against its own 25 GB
 * would hand somebody with three sites seventy-five. PURE.
 */
export function judgeFrontendUsage(input: {
  usage: FrontendUsage;
  /** The owner's plan id, or null/unknown for a free account. */
  planId: string | null;
  /** GB already counted earlier in this billing period, so the allowance is spent once. */
  periodUsedGb?: number;
}): FrontendVerdict {
  const tier: HostingTier | null = tierForPlanId(input.planId);
  const gb = Math.round((input.usage.bytes / GIB) * 1000) / 1000;
  // 🔒 A FREE ACCOUNT IS NOT A ZERO ALLOWANCE. `FREE_FRONTEND_GB` exists precisely because zero would
  // put a charge on the first visitor to a free app, which is not what free publishing promises.
  const includedGb = tier ? tier.includedFrontendGb : FREE_FRONTEND_GB;
  const totalGb = Math.round((gb + Math.max(0, input.periodUsedGb ?? 0)) * 1000) / 1000;
  const overGb = Math.max(0, Math.round((totalGb - includedGb) * 1000) / 1000);
  // A free account has no agreement and therefore no overage terms — there is nothing it COULD be
  // charged, so the hypothetical figure is ₹0 rather than a number nobody agreed to.
  const wouldBillInr = tier ? overageFrontendInr(totalGb, tier) : 0;
  const incomplete = input.usage.appsUnmeasured > 0;
  const plan = tier ? `${tier.id} plan` : 'no plan (free)';
  const parts = [
    `frontend traffic ${gb} GB across ${input.usage.appsMeasured} app(s)`,
    `${plan} includes ${includedGb} GB`,
    overGb > 0 ? `over by ${overGb} GB (would be ₹${wouldBillInr} — NOT charged)` : 'within the allowance',
  ];
  if (incomplete) parts.push(`⚠️ ${input.usage.appsUnmeasured} app(s) unmeasured — this is a floor`);
  return { gb, includedGb, overGb, wouldBillInr, incomplete, note: parts.join('; ') };
}
