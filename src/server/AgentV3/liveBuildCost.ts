// WHAT THIS BUILD HAS COST SO FAR, SHOWN WHILE IT RUNS (admin 2026-09-28: "han dono ho jaye … world
// class banao", approving "build ke dauraan live ₹ kharcha dikhaya jaye — jaise 'ab tak ₹12'").
//
// THE GAP. A user watching a build saw a percentage and a clock, and learned what it cost only after it
// ended. For a product billed on real usage that is backwards: the moment someone decides whether to
// let a long build run or to stop it is DURING the build, and that is exactly when the number was
// missing. None of the builders this platform is measured against shows it plainly either.
//
// 🔒 ONE PRICE, TWO READINGS. The figure is not an estimate made up for display. It is the SAME
// `decideBuildBilledUsd` the final bill uses, over the SAME live ledger, plus the SAME sandbox measure
// and the SAME build discount — read early. A live number priced by a second formula would one day
// disagree with the bill, and only the user would notice. What it cannot know yet is said, not hidden:
// the rules that run at the end can only LOWER it (a build that fails is free; an app whose preview
// was never proven pays our real cost without the markup), and more work can raise it.
//
// 🔒 IT SHOWS NOTHING TO SOMEONE WHO WILL NOT BE CHARGED. A free-listed account, a deployment where
// billing is off, or a build that the "first build free" credit may cover gets no figure at all: a
// rupee amount ticking up in front of someone who will pay ₹0 would be a false statement about money.
//
// White-Label: the event carries one number in rupees and nothing else — no vendor, no model, no split.
//
// PURE. No I/O, no clock of its own, no environment reads except the kill switch.

import { applyBuildDiscount } from '../lib/buildDiscount';

/** Kill switch. Default ON; `off` sends no live figure (the build is otherwise unchanged). */
export function liveCostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_LIVE_COST ?? '').trim().toLowerCase() !== 'off';
}

export interface LiveCostFacts {
  /** Will this build's bill reach the user's wallet at all? (The settle's own `billingActive`.) */
  charged: boolean;
  /** Could the "first build is free" credit zero this build? Then the figure would be untrue. */
  onboardingFreeBuildPossible: boolean;
  /** `decideBuildBilledUsd(...).effectiveBilledUsd` over the live ledger. */
  billedUsd: number;
  /** Our own real cost (tokens + VM) — the floor a discount may never go below. */
  floorUsd: number;
  /** The build discount percentage, read once for this build. */
  discountPct: number;
  /** The live USD→INR rate the bill uses. */
  usdInr: number;
}

/** The figure in rupees (two decimals), or `null` when nothing honest can be shown. PURE. */
export function liveCostInr(f: LiveCostFacts): number | null {
  if (!f.charged || f.onboardingFreeBuildPossible) return null;
  if (![f.billedUsd, f.floorUsd, f.usdInr].every(Number.isFinite) || f.usdInr <= 0 || f.billedUsd < 0) return null;
  const payUsd = f.discountPct > 0
    ? applyBuildDiscount({ billedUsd: f.billedUsd, floorUsd: Math.max(0, f.floorUsd), pct: f.discountPct }).payUsd
    : f.billedUsd;
  const inr = Math.round(payUsd * f.usdInr * 100) / 100;
  return Number.isFinite(inr) && inr >= 0 ? inr : null;
}

/** At most one update this often — a build that makes forty quick calls must not send forty updates. */
export const LIVE_COST_MIN_GAP_MS = 2_500;

/**
 * Send this figure? Never a ₹0.00 opener (it says nothing), never the same figure twice, and never
 * faster than the gap. A LOWER figure is sent like any other: it happens when a phase turns out to have
 * delivered nothing and leaves the bill, and hiding a fall would be as wrong as hiding a rise. PURE.
 */
export function shouldEmitLiveCost(last: { inr: number; at: number } | null, inr: number | null, nowMs: number): boolean {
  if (inr === null || !Number.isFinite(inr)) return false;
  if (!last) return inr > 0;
  if (Math.abs(inr - last.inr) < 0.01) return false;
  return nowMs - last.at >= LIVE_COST_MIN_GAP_MS;
}
