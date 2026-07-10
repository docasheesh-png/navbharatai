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

/** The rollout percentage [0..100] escalation should apply to. See the file header for the semantics. */
export function escalationRolloutPercent(env: NodeJS.ProcessEnv = process.env): number {
  if (env.AGENTV3_ESCALATION !== 'on') return 0;
  const raw = env.AGENTV3_ESCALATION_PCT;
  if (raw == null || String(raw).trim() === '') return 100; // "on" with no PCT = full rollout (unchanged)
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100; // malformed PCT but flag is explicitly on → default to full
  return Math.max(0, Math.min(100, Math.floor(n)));
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
