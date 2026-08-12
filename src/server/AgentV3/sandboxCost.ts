// What a build's E2B sandbox actually cost — the other half of task "measure the sandbox cost and bound
// it honestly" (the reaper bounds it; this makes it visible).
//
// WHY IT WAS INVISIBLE. Every v5 build runs a real cloud VM billed by WALL-CLOCK, and that is a
// completely different cost shape from the token spend the build report already tracks: a build that
// used almost no tokens but sat on a VM for forty minutes costs real money, and nothing in the report
// would have shown it. The admin could see which model answered and what it billed, but not the
// infrastructure underneath — so "why is the E2B bill this size?" had no answer in the product.
//
// ADMIN-ONLY. This is our infrastructure cost, not the user's bill. The user is charged by the
// real-cost + markup model (providerRates.ts) and never sees a line item for our VMs — the same rule
// that keeps provider names out of user-facing surfaces (White-Label Law §3).
//
// HONEST BY DEFAULT. The rate is a configured estimate, not something we can read back from E2B, so
// `estimated: true` always travels with the number. A figure the admin might act on must not pretend to
// be an invoice.
//
// Pure — no I/O, no clock.

/**
 * USD per sandbox-hour. E2B bills per second of RUNNING sandbox (a PAUSED one costs only storage), and
 * the exact figure depends on the plan and the vCPU/RAM of the template, so it is env-tunable rather
 * than hardcoded to a number that would quietly go stale.
 *
 * The default is deliberately a ROUND, conservative placeholder: better to over-state our own cost than
 * to under-state it and be reassured by a number that was never true.
 */
export function sandboxUsdPerHour(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.E2B_USD_PER_HOUR);
  return Number.isFinite(n) && n >= 0 ? n : 0.10;
}

export interface SandboxCostRecord {
  /** Seconds the sandbox was held for this build. */
  seconds: number;
  /** Our estimated infrastructure cost in USD. */
  usd: number;
  /** Always true — the rate is configured, not read back from the provider. See the header. */
  estimated: true;
}

/**
 * Cost for a measured stretch of sandbox time.
 *
 * A missing, negative or nonsensical duration yields ZERO rather than a guess — the same rule the token
 * side follows: we would rather report nothing than report a number we invented. An absurdly long span
 * (more than a day) is treated as a broken measurement, because no build legitimately runs that long
 * and a wrong big number in a cost report is worse than an honest zero.
 */
export function sandboxCost(seconds: unknown, env: NodeJS.ProcessEnv = process.env): SandboxCostRecord | null {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  if (s > 86_400) return null; // a day of sandbox on one build is a broken clock, not a bill
  const usd = (s / 3600) * sandboxUsdPerHour(env);
  return { seconds: Math.round(s), usd: Math.round(usd * 1e6) / 1e6, estimated: true };
}

/**
 * One line for the admin build report.
 *
 * Reports the SHAPE of the cost, not just the total, because that is the part that is actionable: a
 * build whose VM ran far longer than the build itself is paying for idle time, which is a reaper/idle
 * problem, not a model problem.
 */
export function describeSandboxCost(cost: SandboxCostRecord | null, buildSeconds?: number): string {
  if (!cost) return 'Sandbox time  : not measured';
  const mins = (cost.seconds / 60).toFixed(1);
  const base = `Sandbox time  : ${mins} min  ≈ $${cost.usd.toFixed(4)} (estimated infra cost)`;
  const b = Number(buildSeconds);
  if (!Number.isFinite(b) || b <= 0 || cost.seconds <= b) return base;
  const idle = ((cost.seconds - b) / 60).toFixed(1);
  return `${base} — ${idle} min of it after the build finished`;
}

/**
 * THE SANDBOX COST THAT GOES INTO THE USER'S BILL — and the gate that keeps it honest.
 *
 * ADMIN 2026-08-11: "e2b ka kharcha bill me jodo." They are right that it is a real gap: every v5 build
 * runs a cloud VM billed by wall-clock, and until now NavBharatAI absorbed 100% of it — a build that
 * spent almost nothing on tokens but held a VM for forty minutes was pure loss.
 *
 * BUT IT CANNOT SIMPLY BE SWITCHED ON, and this is the part worth being careful about. The billing law
 * says the bill a user sees is 100% REAL and that we must NEVER invent a cost. `sandboxUsdPerHour`
 * defaults to **$0.10 — a deliberate placeholder**, described in this file's own header as "a ROUND,
 * conservative placeholder". Feeding that default into a real person's bill would be charging money on
 * a number nobody has verified, which is exactly what the law forbids.
 *
 * So this is billable ONLY when BOTH are true:
 *   1. `AGENTV3_BILL_SANDBOX=on` — the admin's explicit decision to charge for it, and
 *   2. `E2B_USD_PER_HOUR` is EXPLICITLY SET — the admin's real, verified rate from their E2B plan.
 *
 * The second condition is the one that matters: without it, turning the feature on would silently bill
 * the placeholder. With it, the seconds are MEASURED (a clock, not an estimate) and the rate is the
 * admin's own real price — which is a measurement times a stated price, not a guess. That is the same
 * shape as voice billing, and it is honest.
 *
 * Until the rate is set this returns 0, the user's bill is unchanged, and the admin report keeps
 * showing the (estimated) infrastructure cost exactly as it does today.
 */
export function sandboxBillableUsd(
  cost: SandboxCostRecord | null,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (!cost || !(cost.usd > 0)) return 0;
  if (String(env.AGENTV3_BILL_SANDBOX || '').trim().toLowerCase() !== 'on') return 0;
  // An UNSET or unusable rate means we do not know what a sandbox-hour really costs. Billing the
  // placeholder would be inventing the number the whole billing law exists to prevent.
  const raw = Number(env.E2B_USD_PER_HOUR);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return cost.usd;
}

/** Why the sandbox cost is or is not on this bill — for the admin report, never the user's. */
export function sandboxBillingNote(cost: SandboxCostRecord | null, env: NodeJS.ProcessEnv = process.env): string {
  if (!cost || !(cost.usd > 0)) return 'Sandbox time: not measured on this build.';
  const on = String(env.AGENTV3_BILL_SANDBOX || '').trim().toLowerCase() === 'on';
  const rate = Number(env.E2B_USD_PER_HOUR);
  const rateSet = Number.isFinite(rate) && rate > 0;
  if (!on) return `Sandbox ${cost.seconds}s ≈ $${cost.usd.toFixed(4)} — absorbed by NavBharatAI (AGENTV3_BILL_SANDBOX is off).`;
  if (!rateSet) {
    return `Sandbox ${cost.seconds}s — NOT billed: E2B_USD_PER_HOUR is unset, so the only available rate is a placeholder. `
      + 'Set the real rate from your E2B plan to start charging for it.';
  }
  return `Sandbox ${cost.seconds}s ≈ $${cost.usd.toFixed(4)} at $${rate}/hr — included in this build's real cost before markup.`;
}
