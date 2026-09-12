/**
 * WHICH CHEAP CODER GOES FIRST — decided by how each one is behaving RIGHT NOW.
 *
 * ═══ THE PROBLEM ═══
 *
 * The GLM/KIMI floor's lead was fixed by two rules, and neither one looks at anything:
 *
 *   • `AGENTV3_FREE_KIMI_LEAD` (default on) makes KIMI lead every FREE build. It was set on
 *     2026-08-02 because that week's autopsy counted 106 GLM failures against 2 for KIMI — a correct
 *     reading of that day, frozen into a default that has been in force ever since.
 *   • Paid builds alternate 50/50 on a counter.
 *
 * Neither notices when the picture changes. If GLM's throttling eased a month ago, nothing brings it
 * back; if KIMI starts 429ing today, free builds keep leading with it until somebody reads a report.
 * The admin's own dashboard shows the consequence: **19.7M tokens through KIMI against 946 through
 * GLM** — not a preference, a monopoly by default.
 *
 * ═══ WHAT THIS USES INSTEAD ═══
 *
 * The runner already keeps exactly the signal this needs and shares it across instances: the 429 /
 * timeout cooldown registry. A provider that is currently BENCHED has proven, in the last minutes,
 * that it is failing; a provider that is not benched has not. That is live evidence, it costs nothing
 * to read, and it recovers on its own — which is the property the frozen default lacks.
 *
 * 🔒 THE RULE, and every clause of it is a refusal to guess:
 *   • It only ever REORDERS. Both providers stay in the chain, so nothing can be lost — the worst case
 *     is that the first call goes to the same provider it would have gone to anyway.
 *   • When BOTH are healthy, or BOTH are benched, the evidence says nothing and today's rule stands
 *     untouched. No preference is invented from an absence of difference.
 *   • It says WHY, so the choice appears in the build report instead of being folded into an order
 *     nobody can explain later.
 *
 * PURE — the clock and the cooldown readings are passed in.
 */

/** How long a bench must still have left to count as "currently failing". */
export const LEAD_BENCH_FLOOR_MS = 1_000;

export interface FloorLeadFacts {
  /** Per provider, the ms timestamp its bench expires. 0 or absent = healthy. */
  coolingUntil: Readonly<Record<string, number>>;
  nowMs: number;
}

export interface FloorLeadDecision {
  /** The provider to put first, or `null` for "keep the caller's existing order". */
  lead: string | null;
  /** One line for the build report. Always set, including when nothing changed. */
  reason: string;
}

function isCooling(name: string, facts: FloorLeadFacts): boolean {
  const until = Number(facts?.coolingUntil?.[name] ?? 0);
  return Number.isFinite(until) && until - facts.nowMs >= LEAD_BENCH_FLOOR_MS;
}

/**
 * Choose the lead from live health.
 *
 * `providers` is the set actually present in this build's chain — a floor with only one of them never
 * has a choice to make, and must not pretend it did.
 */
export function chooseFloorLead(
  providers: readonly string[],
  facts: FloorLeadFacts,
): FloorLeadDecision {
  const names = [...new Set((providers || []).filter((p) => typeof p === 'string' && p))];
  if (names.length < 2) return { lead: null, reason: 'only one cheap provider is configured — nothing to choose' };

  const healthy = names.filter((n) => !isCooling(n, facts));
  if (healthy.length === names.length) {
    return { lead: null, reason: 'both cheap providers are healthy — keeping the usual order' };
  }
  if (healthy.length === 0) {
    // Everything is benched. Reordering would move the first call from one failing provider to
    // another, which is not an improvement — and pretending to have chosen would be worse than saying
    // there was nothing to choose between.
    return { lead: null, reason: 'every cheap provider is rate-limited right now — keeping the usual order' };
  }
  const lead = healthy[0];
  const benched = names.filter((n) => !healthy.includes(n));
  return {
    lead,
    reason: `leading with ${lead}: ${benched.join(', ')} ${benched.length === 1 ? 'is' : 'are'} rate-limited right now`,
  };
}

/**
 * Is `flag` switched off? The kill switch for this whole behaviour.
 *
 * Default ON, because the behaviour it replaces is a month-old constant and this one at least looks.
 * `AGENTV3_FLOOR_LEAD_HEALTH=off` restores the frozen rules exactly.
 */
export function healthLeadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_FLOOR_LEAD_HEALTH ?? 'on').trim().toLowerCase() !== 'off';
}
