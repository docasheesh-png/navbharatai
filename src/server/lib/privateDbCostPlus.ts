// PRIVATE_DB_COST_PLUS — the private database (₹1,499, its own Supabase project) billed at OUR actual
// Supabase cost × a multiplier, instead of a fixed price with a storage cap. Default OFF.
//
// ASSUMPTION (stated in the terms and the PR): the ₹1,499 a period stays the BASE and the MONTHLY
// MINIMUM. It is paid up front as today. When the period ends (at auto-renewal), the cost-plus figure for
// the period that just ended is worked out; only the part ABOVE ₹1,499 is charged, once, as a separate
// ledger line. Most projects (Micro compute, ≤8 GB disk) cost ≈$10 × 1.5 ≈ ₹1,275 < ₹1,499, so they
// pay exactly what they pay today.
//
// WHERE THE COST COMES FROM: Supabase's Management API has NO per-project bill/usage endpoint (usage is
// only on the org's dashboard page). So we read what the API DOES expose — the project's compute size
// and provisioned disk (GET /v1/projects/{ref}/config/disk) — and price it with the documented unit
// prices below. Egress is not exposed per project, so it is counted as 0 (in the user's favour) until a
// source exists. Every unit price is marked NEEDS VERIFICATION against our real invoice.

export function privateDbCostPlusEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PRIVATE_DB_COST_PLUS ?? '').trim().toLowerCase() === 'on';
}

/** PRIVATE_DB_COST_MULTIPLIER, default 1.5. Never below 1 (we never bill under cost) or above 5. */
export function privateDbCostMultiplier(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.PRIVATE_DB_COST_MULTIPLIER);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : 1.5;
}

export const PRIVATE_DB_BASE_INR = 1499;
/** Above this cost-plus total for one period we warn before charging (user + admin log). */
export const PRIVATE_DB_COST_WARN_INR = 2500;

/** Documented Supabase unit prices, USD. NEEDS VERIFICATION against our invoice before switching on. */
export const SUPABASE_UNIT_PRICES = {
  /** Compute per hour, by instance size (supabase.com/docs/guides/platform/compute-and-disk). */
  computeUsdPerHour: { nano: 0.0, micro: 0.01344, small: 0.0206, medium: 0.0822, large: 0.1517, xl: 0.2877 } as Record<string, number>,
  /** gp3 disk over the 8 GB included, per GB-hour ($0.125/GB/month; docs: manage-your-usage/disk-size). */
  diskUsdPerGbHour: 0.000171,
  diskIncludedGb: 8,
  /** Egress over the org quota, per GB ($0.09) — no per-project source, so not billed yet. */
  egressUsdPerGb: 0.09,
  needsVerification: true,
} as const;

export interface PrivateDbUsage {
  computeSize: string;
  hours: number;
  diskGb: number;
  egressGb: number;
}

export interface CostPlusBreakdown {
  computeUsd: number; diskUsd: number; egressUsd: number; costUsd: number;
  multiplier: number; usdInr: number; costPlusInr: number; baseInr: number; extraInr: number;
  lines: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** PURE. Cost-plus for one period. extraInr is what is owed ABOVE the ₹1,499 already paid. */
export function costPlusBreakdown(u: PrivateDbUsage, multiplier: number, usdInr: number): CostPlusBreakdown {
  const p = SUPABASE_UNIT_PRICES;
  const hours = Math.max(0, Number(u.hours) || 0);
  const rate = p.computeUsdPerHour[String(u.computeSize || 'micro').toLowerCase()] ?? p.computeUsdPerHour.micro;
  const computeUsd = r2(rate * hours);
  const diskUsd = r2(Math.max(0, (Number(u.diskGb) || 0) - p.diskIncludedGb) * p.diskUsdPerGbHour * hours);
  const egressUsd = r2(Math.max(0, Number(u.egressGb) || 0) * p.egressUsdPerGb);
  const costUsd = r2(computeUsd + diskUsd + egressUsd);
  const costPlusInr = r2(costUsd * multiplier * usdInr);
  const extraInr = r2(Math.max(0, costPlusInr - PRIVATE_DB_BASE_INR));
  return {
    computeUsd, diskUsd, egressUsd, costUsd, multiplier, usdInr, costPlusInr, baseInr: PRIVATE_DB_BASE_INR, extraInr,
    lines: [
      `Compute (${u.computeSize || 'micro'}, ${Math.round(hours)} h): $${computeUsd}`,
      `Disk (${u.diskGb} GB, first ${p.diskIncludedGb} GB included): $${diskUsd}`,
      `Egress: $${egressUsd}`,
      `Supabase cost $${costUsd} × ${multiplier} × ₹${usdInr}/$ = ₹${costPlusInr}`,
      extraInr > 0 ? `Above the ₹${PRIVATE_DB_BASE_INR} already paid: ₹${extraInr}` : `Within the ₹${PRIVATE_DB_BASE_INR} minimum — nothing extra`,
    ],
  };
}

/** Read compute size + provisioned disk for one project. Null when Supabase does not answer. */
export async function readPrivateDbUsage(
  token: string, projectRef: string, hours: number, fetchImpl: typeof fetch = fetch,
): Promise<PrivateDbUsage | null> {
  const ref = String(projectRef ?? '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(ref)) return null;
  const h = { Authorization: `Bearer ${token}` };
  try {
    const [proj, disk] = await Promise.all([
      fetchImpl(`https://api.supabase.com/v1/projects/${ref}`, { headers: h }),
      fetchImpl(`https://api.supabase.com/v1/projects/${ref}/config/disk`, { headers: h }),
    ]);
    if (!proj.ok || !disk.ok) return null;
    const pj: any = await proj.json().catch(() => ({}));
    const dk: any = await disk.json().catch(() => ({}));
    const diskGb = Number(dk?.attributes?.size_gb ?? dk?.size_gb);
    return {
      computeSize: String(pj?.infra_compute_size || pj?.compute_size || 'micro'),
      hours, diskGb: Number.isFinite(diskGb) ? diskGb : 8, egressGb: 0,
    };
  } catch {
    return null;
  }
}
