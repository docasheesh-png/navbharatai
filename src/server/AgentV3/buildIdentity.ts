// AgentV3 — BUILD IDENTITY (P0, admin 2026-07-12: "the exported Build Report belonged to a PREVIOUS,
// different app — Jungle Runner report exported for an Expense Tracker build").
//
// ROOT CAUSE this closes: the diagnostics report had NO unique build id. It was keyed only by workspaceId
// and, as a fallback, by userId ("the user's LAST settled build of ANY app"). The export endpoint resolved
// a report through that fallback chain WITHOUT ever checking that the report actually belonged to the build
// the user was looking at — so a different app's report could be (and was) handed back.
//
// This module is the PURE brain of the fix: a stable prompt hash + a strict "does this report belong to the
// ACTIVE build?" check. The route stamps every build with a unique buildId + promptHash, the client echoes
// the active build's identity on export, and the endpoint ABORTS rather than return a report that fails this
// check. No I/O; fully unit-tested.

/** The identity fields carried by a diagnostics report (a subset of BuildDiagnosticsReport). */
export interface BuildIdentityFields {
  buildId?: string;
  promptHash?: string;
  workspaceId?: string;
  startedAt?: number;
  endedAt?: number;
}

/** What the client asserts is the ACTIVE build it wants the report for (echoed from the build's result). */
export interface ActiveBuildExpectation {
  /** The active build's unique id (the strongest key). */
  buildId?: string;
  /** The active build's prompt hash (guards a same-workspace different-prompt build). */
  promptHash?: string;
  /** The active workspace id. */
  workspaceId?: string;
}

export interface BuildMatchResult {
  ok: boolean;
  /** Machine reason when !ok — surfaced in the abort response + audit. */
  reason?:
    | 'no-report'
    | 'report-has-no-build-id'
    | 'build-id-mismatch'
    | 'prompt-hash-mismatch'
    | 'workspace-mismatch';
}

/**
 * A deterministic, dependency-free hash of a build prompt (FNV-1a, 32-bit → 8 hex chars). Same prompt →
 * same hash on every instance/deploy; a different prompt → (almost always) a different hash. Used to
 * detect "this report is for a DIFFERENT request than the one being exported". Pure.
 */
export function computePromptHash(prompt: string | null | undefined): string {
  const s = (prompt ?? '').trim();
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Strict check: does `report` belong to the ACTIVE build the caller asked for? Only the fields the caller
 * ASSERTS are enforced (an empty expectation matches anything — the legacy, no-identity client path stays
 * unchanged). The build id is the hard key: if the caller names an active buildId, the report MUST carry
 * that exact id — a report with NO buildId (a legacy/other build) is treated as a mismatch, never silently
 * accepted. Prompt-hash and workspace are secondary consistency guards. Pure + fully unit-tested.
 */
export function reportMatchesActiveBuild(
  report: BuildIdentityFields | null | undefined,
  expect: ActiveBuildExpectation,
): BuildMatchResult {
  if (!report) return { ok: false, reason: 'no-report' };

  if (expect.buildId) {
    if (!report.buildId) return { ok: false, reason: 'report-has-no-build-id' };
    if (report.buildId !== expect.buildId) return { ok: false, reason: 'build-id-mismatch' };
  }
  if (expect.promptHash && report.promptHash && report.promptHash !== expect.promptHash) {
    return { ok: false, reason: 'prompt-hash-mismatch' };
  }
  if (expect.workspaceId && report.workspaceId && report.workspaceId !== expect.workspaceId) {
    return { ok: false, reason: 'workspace-mismatch' };
  }
  return { ok: true };
}

/** True when the caller asserted ANY active-build identity — i.e. the strict path is in force. */
export function hasActiveBuildExpectation(expect: ActiveBuildExpectation): boolean {
  return !!(expect.buildId || expect.promptHash);
}
