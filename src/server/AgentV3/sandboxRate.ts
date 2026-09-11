// WHAT A SANDBOX-HOUR REALLY COSTS — derived from the machine we actually run, not from a number
// somebody once wrote down.
//
// WHY THIS EXISTS (admin's own E2B dashboards, 2026-09-11). The admin asked why E2B costs so much and
// sent three console screenshots. Reconciling them found that the rate the whole platform prices VM
// time with, `E2B_USD_PER_HOUR = 0.083`, is **exactly half** the truth — and has been since it was set.
//
// THE MISTAKE, precisely. CLAUDE.md derived it on 2026-08-11 as `$172.08 ÷ 2,078.29 vCPU-hours`, then
// wrote: *"RAM-hours ÷ vCPU-hours is exactly 2.0, so every sandbox is 1 vCPU + 2 GB"*. That ratio pins
// the SHAPE of a sandbox (2 GB of RAM per vCPU) and says nothing whatever about its SIZE — it is
// equally true of 1 vCPU + 2 GB and of 2 vCPU + 4 GB. The size was assumed, and assumed wrong. So a
// figure that is genuinely $0.0828 per **vCPU**-hour was recorded as $0.083 per **wall-clock** hour,
// and on a two-vCPU template those differ by 2×.
//
// The real size is pinned by two independent sources that agree: `infra/e2b/build.mjs` builds the
// template with `cpuCount: 2, memoryMB: 4096`, and every row of the admin's Sandboxes list reads
// "2 Core / 4.0 GB". (`infra/e2b/e2b.toml` says 4 vCPU — it is LEGACY, unused by build system v2, and
// must not be read as config.)
//
// 🔒 WHAT MAKES THIS A MEASUREMENT AND NOT ANOTHER GUESS. E2B's published per-resource prices,
// multiplied by the usage meters, reproduce BOTH of the admin's billing windows to the cent:
//
//     Jul 14 – Aug 13 : 2,078.29 × $0.0504 + 4,156.57 × $0.0162 = $172.08   (invoice $172.08)
//     Aug 12 – Sep 11 : 1,064.36 × $0.0504 + 2,128.72 × $0.0162 =  $88.13   (invoice  $88.13)
//
// Two windows, zero cents of error, using the same two constants. That is what the earlier derivation
// lacked: a check that could have FAILED. It is also why the constants live here as named prices per
// resource instead of one opaque blended number — a blended number cannot be checked against anything.
//
// WHO WAS HARMED: nobody, and the direction matters. The error UNDER-states our own cost, so paid
// builds recover half the VM cost and NavBharatAI absorbs the rest. No user was ever over-charged, so
// there is nothing to refund. What it did break is the admin's ability to see the bill: the Monitor's
// VM COST tile shows half the real rupees, on the very panel the admin uses to ask "why is E2B
// expensive?".
//
// 🔴 AND THE CODE ALONE CANNOT FIX IT. `E2B_USD_PER_HOUR` is SET in Cloud Run, and an env value always
// beats a code default — this file's own history is the proof. So the honest engineering is: get the
// derivation right here, and make a configured rate that CONTRADICTS the template say so loudly
// wherever it is used, instead of quietly pricing at half. The remaining half of the fix is one value
// in a console only the admin can reach (fourth absolute rule, step 6).
//
// Pure — no I/O, no clock.

/**
 * E2B's published per-resource prices, in USD per hour.
 *
 * Env-overridable on the same reasoning as `providerRates.ts`: a real-world price moves, and tracking
 * it must never require a deploy. Verified against two consecutive invoices above — change them only
 * against a new invoice, never to make a number look better.
 */
export function usdPerVcpuHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RATE_E2B_VCPU_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 0.0504; // $0.000014 / vCPU-second
}

export function usdPerGbHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RATE_E2B_GB_HOUR);
  return Number.isFinite(n) && n > 0 ? n : 0.0162; // $0.0000045 / GB-second
}

/**
 * The builder template's real size.
 *
 * Defaults MIRROR `infra/e2b/build.mjs` (`cpuCount: 2, memoryMB: 4096`), which is the only thing that
 * actually creates the template. They are env-overridable so a resize can be reflected without a
 * deploy — and because the alternative, re-deriving the size from a usage ratio, is exactly the step
 * that produced the 2× error this module exists to end.
 */
export function sandboxVcpu(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.E2B_SANDBOX_VCPU);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

export function sandboxRamGb(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.E2B_SANDBOX_RAM_GB);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/**
 * What one hour of a RUNNING sandbox costs, derived from its size. A paused sandbox bills only storage
 * and is not priced here.
 */
export function impliedUsdPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const usd = sandboxVcpu(env) * usdPerVcpuHour(env) + sandboxRamGb(env) * usdPerGbHour(env);
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * THE rate, and the only one. USD per running sandbox-hour.
 *
 * An explicitly configured `E2B_USD_PER_HOUR` still wins — it is the admin's real invoiced price and
 * may include a plan discount we cannot see. Otherwise the rate is DERIVED from the template, which is
 * a verified number rather than the round `$0.10` placeholder that used to stand here.
 *
 * ⚠️ There used to be TWO of these functions — `sandboxCost.ts` defaulting to 0.10 and
 * `sandboxHandover.ts` to 0.083 — so the same question had two answers depending on which module you
 * asked. Both now delegate here. Do not add a third.
 */
export function sandboxUsdPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.E2B_USD_PER_HOUR);
  return Number.isFinite(n) && n > 0 ? n : impliedUsdPerHour(env);
}

/** Is a REAL rate configured, or are we falling back to the derived one? */
export function rateIsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const n = Number(env.E2B_USD_PER_HOUR);
  return Number.isFinite(n) && n > 0;
}

export interface RateMismatch {
  /** What Cloud Run says an hour costs. */
  configured: number;
  /** What this template's size says an hour costs. */
  implied: number;
  /** configured ÷ implied. Below 1 means we are under-counting our own spend. */
  ratio: number;
  /** A plain sentence for an admin surface. Never names a fix we cannot verify. */
  note: string;
}

/**
 * How far apart the configured rate may sit from the derived one before we say something.
 *
 * Wide on purpose. A real plan discount, a region difference or simple rounding can move the true
 * price by a fair margin, and an admin warning that cries wolf gets ignored — which would cost more
 * than the warning saves. What must never be missed is a rate that contradicts the machine's SHAPE,
 * and those errors are whole multiples (a per-vCPU price read as a per-wall price is 2× here, 4× on a
 * four-vCPU template). 25% catches every one of those and stays quiet for every plausible discount.
 */
export const RATE_TOLERANCE = 0.25;

/**
 * Flag a configured rate that contradicts the template it is meant to price.
 *
 * 🔒 Returns null when nothing is configured — a DERIVED rate cannot disagree with itself, and warning
 * about it would be noise. The point of this function is the case that actually happened: a number set
 * once, correct for a machine we no longer run, silently halving every cost figure in the product with
 * nothing anywhere to notice.
 */
export function rateMismatch(env: NodeJS.ProcessEnv = process.env): RateMismatch | null {
  if (!rateIsConfigured(env)) return null;
  const configured = Number(env.E2B_USD_PER_HOUR);
  const implied = impliedUsdPerHour(env);
  if (!(implied > 0)) return null;
  const ratio = configured / implied;
  if (Math.abs(ratio - 1) <= RATE_TOLERANCE) return null;
  const vcpu = sandboxVcpu(env);
  const ram = sandboxRamGb(env);
  const direction = ratio < 1 ? 'UNDER-states' : 'OVER-states';
  const note =
    `Sandbox rate check: E2B_USD_PER_HOUR is $${configured} per hour, but this template `
    + `(${vcpu} vCPU / ${ram} GB) costs $${implied.toFixed(4)} per running hour. `
    + `Every VM cost figure ${direction} the real spend by about ${Math.abs(ratio - 1) * 100 < 1000 ? (Math.abs(ratio - 1) * 100).toFixed(0) : '999+'}%. `
    + `Fix it in Cloud Run: set E2B_USD_PER_HOUR=${implied.toFixed(4)}.`;
  return { configured, implied, ratio: Math.round(ratio * 1000) / 1000, note };
}

/** The mismatch sentence, or empty when the rate and the machine agree. Safe to concatenate. */
export function rateMismatchNote(env: NodeJS.ProcessEnv = process.env): string {
  return rateMismatch(env)?.note ?? '';
}
