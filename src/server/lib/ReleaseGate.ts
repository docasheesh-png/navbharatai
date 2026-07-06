// P-DEPLOY.5 — Release Approval / Freeze Gate.
//
// Deploy is fully automatic on merge (by design). This adds an OPTIONAL safety layer: an admin can
// declare a FREEZE window (block all promotions during an incident) and/or require MANUAL APPROVAL of a
// specific commit before it may ship. The deploy pipeline checks the gate before promoting.
//
// This module is the pure, testable decision core; the store + routes wire it to Firestore + the pipeline.
// HONESTY: the gate is OPT-IN and defaults to fully open — with no config it never blocks a normal deploy,
// so it cannot accidentally halt the pipeline.

export interface ReleaseGateConfig {
  /** Hard freeze — block all promotions while active. */
  frozen: boolean;
  /** Optional human reason shown to whoever is blocked. */
  freezeReason?: string;
  /** Optional auto-expiry (epoch ms). When set and passed, the freeze no longer blocks. */
  freezeUntilMs?: number;
  /** Require an explicit approved commit before any deploy. */
  approvalRequired: boolean;
  /** The commit SHA that has been approved to ship (when approvalRequired). */
  approvedSha?: string;
  /** Audit: who last changed the gate + when. */
  updatedBy?: string;
  updatedAtMs?: number;
}

export const OPEN_GATE: ReleaseGateConfig = { frozen: false, approvalRequired: false };

export interface ReleaseGateDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether a candidate commit may be promoted. Pure.
 * Order: an active freeze blocks everything; then approval (if required) must match the candidate SHA.
 */
export function evaluateReleaseGate(
  config: ReleaseGateConfig | null | undefined,
  nowMs: number,
  candidateSha?: string,
): ReleaseGateDecision {
  const c = config ?? OPEN_GATE;

  if (c.frozen) {
    const expired = typeof c.freezeUntilMs === 'number' && Number.isFinite(c.freezeUntilMs) && nowMs >= c.freezeUntilMs;
    if (!expired) {
      const until = typeof c.freezeUntilMs === 'number' ? ` (until ${new Date(c.freezeUntilMs).toISOString()})` : '';
      return { allowed: false, reason: `Release freeze active${until}${c.freezeReason ? `: ${c.freezeReason}` : '.'}` };
    }
  }

  if (c.approvalRequired) {
    const sha = (candidateSha || '').trim();
    const approved = (c.approvedSha || '').trim();
    if (!approved) return { allowed: false, reason: 'Manual approval required, but no commit has been approved yet.' };
    if (!sha) return { allowed: false, reason: 'Manual approval required — no candidate commit was provided to check.' };
    // Match on prefix so a short SHA approves the matching full SHA and vice-versa.
    const matches = sha === approved || sha.startsWith(approved) || approved.startsWith(sha);
    if (!matches) return { allowed: false, reason: `Commit ${sha.slice(0, 12)} is not the approved release (${approved.slice(0, 12)}).` };
  }

  return { allowed: true, reason: 'Release gate open — deploy permitted.' };
}

/** Normalize an untrusted config object from the store/request into a safe ReleaseGateConfig. */
export function normalizeGateConfig(raw: unknown): ReleaseGateConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    frozen: o.frozen === true,
    freezeReason: str(o.freezeReason),
    freezeUntilMs: num(o.freezeUntilMs),
    approvalRequired: o.approvalRequired === true,
    approvedSha: str(o.approvedSha, 80),
    updatedBy: str(o.updatedBy, 120),
    updatedAtMs: num(o.updatedAtMs),
  };
}
