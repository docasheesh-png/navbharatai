// T1-escalation-on (roadmap Tier 1) — SAFE, GRADUAL activation of the cost-ladder escalation orchestrator.
//
// The orchestrator is fully built + tested + wired; it only runs when AGENTV3_ESCALATION=on. Flipping it
// to 100% of live builds in one step is risky (it changes cost + behaviour for every user), and the design
// explicitly says "measure first". This adds a percentage canary so the admin can turn escalation on for a
// FRACTION of builds first (e.g. 10%), measure cost/quality, then ramp to 100% — the responsible rollout.
//
// PURE + deterministic. BACKWARD-COMPATIBLE by construction:
//   • AGENTV3_ESCALATION unset/≠on  → 0%  (escalation fully off — byte-identical to today)
//   • AGENTV3_ESCALATION=on, no PCT  → 100% (every eligible build — identical to the old "on" semantics)
//   • AGENTV3_ESCALATION=on + AGENTV3_ESCALATION_PCT=N → N% of builds, chosen deterministically by workspace.

/**
 * Read a canary percentage from an env value. ONE parser for every rollout flag.
 *
 * ⚠️ THE BUG THIS CLOSES (found 2026-08-21 while auditing the live `AGENTV3_FEATURE_HEAL_PCT=20`).
 * A PCT that was PRESENT but unparseable used to mean **100%**. That is not backward compatibility —
 * there was never a prior behaviour for `PCT=twenty` — it is a guess, and it guessed in the one
 * direction that costs real money on every build. `Number('20%')` is NaN, so **a trailing percent
 * sign, the single most likely thing to type into a field called PCT, silently meant EVERYONE.**
 *
 * The reasoning that fixes it: someone who wanted 100% would leave the value BLANK, which already
 * means 100%. So a value that is present and unreadable is an intended PARTIAL rollout whose number
 * we could not read, and 100% is the one answer it can never have been. We take the free, reversible
 * side — 0% — and say so loudly in the server log rather than spending money on a guess.
 *
 * It also parses the forms an operator actually types: `20%`, ` 20 `, `20.0`. Only what survives all
 * of that is treated as unreadable.
 *
 * `0` is a real, supported value and is how a canary is PAUSED while the flag stays on.
 */
export function parseRolloutPercent(raw: string | undefined | null, label = 'rollout'): number | null {
  if (raw == null) return null;                                  // absent ⇒ caller's "no constraint"
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;                               // blank ⇒ same as absent
  const n = Number(trimmed.replace(/%$/, '').trim());            // tolerate "20%" and " 20 "
  if (!Number.isFinite(n)) {
    // LOUD, because the alternative is a silent behaviour change the admin cannot see. This is the
    // only place that knows the value was meant to be a percentage and was not one.
    console.error(
      `[ROLLOUT] ${label} percentage is not a number (${JSON.stringify(trimmed)}). ` +
      'Treating it as 0% — the feature is PAUSED rather than rolled out to everyone. ' +
      'Set a plain number (e.g. 20), or clear the value entirely to mean 100%.',
    );
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(n)));
}

/** The rollout percentage [0..100] escalation should apply to. See the file header for the semantics. */
export function escalationRolloutPercent(env: NodeJS.ProcessEnv = process.env): number {
  if (env.AGENTV3_ESCALATION !== 'on') return 0;
  const pct = parseRolloutPercent(env.AGENTV3_ESCALATION_PCT, 'AGENTV3_ESCALATION_PCT');
  return pct == null ? 100 : pct; // "on" with no PCT = full rollout (unchanged)
}

/** Deterministic 0..99 bucket for a stable key (FNV-1a). Same key → same bucket, so a project's builds
 *  are consistently in or out of the canary (no mid-session flip-flop, clean measurement). Pure. */
export function rolloutBucket(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0) % 100;
}

/** Whether a build keyed by `key` is inside the `pct`% escalation rollout. Pure. */
export function inEscalationRollout(key: string | undefined, pct: number): boolean {
  if (pct >= 100) return true;
  if (pct <= 0) return false;
  if (!key) return false; // no stable key → stay OUT of a partial rollout (conservative; full rollout still includes it)
  return rolloutBucket(key) < pct;
}

/**
 * Generic percentage-canary gate for ANY on/off feature flag (same semantics as escalation, reused so
 * every canary behaves identically). PURE + backward-compatible by construction:
 *   • on=false                    → false (feature off)
 *   • on=true, pctRaw empty/unset → true  (100% — identical to a plain global "on")
 *   • on=true, pctRaw=N           → N% of builds, chosen deterministically by `key` (a stable id such
 *                                    as the workspaceId), so a project is consistently in or out.
 *   • on=true, pctRaw=0           → false for everyone. This is how a canary is PAUSED while the flag
 *                                    stays on — and it is the ONLY way, because CLEARING the value
 *                                    means 100%, not "off". See `parseRolloutPercent`.
 *   • on=true, pctRaw unreadable  → 0% and a loud server log (it used to mean 100%; see the bug note
 *                                    on `parseRolloutPercent`).
 */
export function inFlagRollout(
  on: boolean,
  pctRaw: string | undefined,
  key: string | undefined,
  label = 'feature rollout',
): boolean {
  if (!on) return false;
  const pct = parseRolloutPercent(pctRaw, label);
  if (pct == null) return true;         // on with no PCT = 100%, identical to a plain global "on"
  return inEscalationRollout(key, pct);
}

/** The measurement cohort this build belongs to. Pure. */
export type EscalationCohort = 'off' | 'in' | 'out';

/**
 * Label a build's escalation cohort for telemetry — the A/B dimension the canary measurement needs:
 *   'off' → the flag is not on (escalation impossible for anyone);
 *   'in'  → flag on AND inside the percentage rollout (the ladder applies);
 *   'out' → flag on but OUTSIDE the partial rollout (the control group).
 * Comparing 'in' vs 'out' success/cost on the same days is what justifies (or vetoes) raising PCT. Pure.
 */
export function escalationCohort(key: string | undefined, env: NodeJS.ProcessEnv = process.env): EscalationCohort {
  if (env.AGENTV3_ESCALATION !== 'on') return 'off';
  return inEscalationRollout(key, escalationRolloutPercent(env)) ? 'in' : 'out';
}
