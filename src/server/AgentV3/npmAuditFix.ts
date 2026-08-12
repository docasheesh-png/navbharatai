// AgentV3 — apply npm's own SemVer-compatible security fixes, instead of only reporting them.
//
// ADMIN 2026-08-12, on the dukaan stock app shipping 8 vulnerabilities (4 high): "in dono ko aap fix
// kar sakte ho?" The reporting half shipped in #2304 — the build now says what npm found. This is the
// remediation half.
//
// WHAT IS SAFE TO RUN, AND WHY IT IS EXACTLY ONE COMMAND
//
// npm prints two suggestions on every vulnerable tree:
//
//     npm audit fix           ← updates only WITHIN the SemVer ranges package.json already declares
//     npm audit fix --force   ← applies BREAKING major upgrades
//
// Only the first is defensible here. It changes nothing the next ordinary `npm install` would not
// change on its own, so it cannot introduce an incompatibility the project had not already accepted.
// `--force` can replace a dependency with a major version whose API the generated code was never
// written against — running that on a user's behalf, unattended, is a way to break a working app while
// claiming to secure it. It is not offered, not configurable, and not one flag away.
//
// WHY IT IS NOT WORTH RUNNING FOR EVERY FINDING
//
// A lockfile rewrite costs real seconds on every build and carries a small, real regression risk (a
// patch release can still regress). Spending that on a `low` advisory in a transitive test-only
// dependency is a bad trade. It runs for HIGH and CRITICAL only — the ones a person would actually act
// on — so the risk is taken exactly where the payoff is.

import type { NpmAuditSummary } from './npmAuditSummary';

/** The one command. Never `--force` — see the module note. */
export const AUDIT_FIX_COMMAND = 'npm audit fix';

/** How long the fix may run before the build stops waiting on it. */
export const AUDIT_FIX_TIMEOUT_MS = 120_000;

/**
 * Is the automatic fix switched on?
 *
 * DEFAULT OFF, and deliberately so. Every other behaviour-changing gate in this engine
 * (AGENTV3_LINT_GATE, AGENTV3_AUTOFIX, AGENTV3_DESIGN_GATE) shipped default-off and was turned on by
 * the admin after real builds proved it clean. This one MUTATES THE LOCKFILE of every app it touches,
 * which is a larger step than any of those, so it earns the same discipline rather than less of it.
 * `AGENTV3_AUDIT_FIX=on` turns it on.
 */
export function auditFixEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_AUDIT_FIX ?? '').trim().toLowerCase() === 'on';
}

/**
 * Should the fix run for this audit result? PURE.
 *
 * Null (no audit summary in the log) means we never found out, and acting on ignorance is how a
 * lockfile gets rewritten for no reason at all.
 */
export function shouldRunAuditFix(
  summary: NpmAuditSummary | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!auditFixEnabled(env)) return false;
  if (!summary) return false;
  return (summary.critical ?? 0) + (summary.high ?? 0) > 0;
}

/**
 * The honest line for the build report, comparing the tree BEFORE and AFTER the fix.
 *
 * Returns null when there is nothing to say. Every other outcome states plainly what happened,
 * including the awkward ones: a fix that changed nothing, and a fix that could not run at all. A
 * remediation step that quietly reports success is worse than one that never ran, because the count it
 * leaves behind is the one the admin will trust.
 */
export function auditFixOutcome(
  before: NpmAuditSummary | null | undefined,
  after: NpmAuditSummary | null | undefined,
  ran: boolean,
): string | null {
  if (!before || before.total <= 0) return null;
  const seriousBefore = (before.critical ?? 0) + (before.high ?? 0);
  if (!ran) {
    return `${seriousBefore} high/critical vulnerability${seriousBefore === 1 ? '' : 'ies'} found and the automatic fix did NOT run — the app shipped with them. (Set AGENTV3_AUDIT_FIX=on to apply npm's compatible fixes during the build.)`;
  }
  // The fix ran but we could not re-read the tree. NEVER report that as fixed: an unverified claim
  // about security is the one kind this engine must not make.
  if (!after) {
    return `Ran ${AUDIT_FIX_COMMAND} for ${seriousBefore} high/critical vulnerability${seriousBefore === 1 ? '' : 'ies'}, but the result could not be re-read — whether they are gone is UNKNOWN.`;
  }
  const seriousAfter = (after.critical ?? 0) + (after.high ?? 0);
  const cleared = Math.max(0, before.total - after.total);
  if (after.total <= 0) return `Fixed all ${before.total} known vulnerabilities with ${AUDIT_FIX_COMMAND} (no breaking upgrades).`;
  if (cleared <= 0) {
    return `${AUDIT_FIX_COMMAND} could not fix any of the ${before.total} known vulnerabilities — every remaining one needs a BREAKING major upgrade, which is a decision for a person, not a build.`;
  }
  return `Fixed ${cleared} of ${before.total} known vulnerabilities with ${AUDIT_FIX_COMMAND}; ${after.total} remain (${seriousAfter} high/critical) and need a breaking major upgrade to clear.`;
}

/** Severity for the outcome line: still-serious ⇒ warning, otherwise informational. PURE. */
export function auditFixSeverity(after: NpmAuditSummary | null | undefined, ran: boolean): 'warning' | 'info' {
  if (!ran) return 'warning';           // they shipped — that is the caveat, not a footnote
  if (!after) return 'warning';         // unverified is not clean
  return (after.critical ?? 0) + (after.high ?? 0) > 0 ? 'warning' : 'info';
}
