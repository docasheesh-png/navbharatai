/**
 * The contradiction that was already in the code — build 7bc15e40.
 *
 * Two functions looked at the same build and disagreed:
 *   • `shouldRetryEmptyBuild` declined to retry, in its own words: "An edit on a project that
 *     already exists may legitimately change nothing." It KNEW.
 *   • `emptyBuildFailureSummary` was never told — its whole input was
 *     (expectsArtifacts, fileCount, sandboxUnavailable) — so it could only answer "were files
 *     written?", which is not the question "did the turn do what was asked?".
 *
 * These pin both halves, and the claim auditor's two blind spots from the same report.
 */
import { describe, it, expect } from 'vitest';
import { emptyBuildFailureSummary, shouldRetryEmptyBuild } from '../src/server/routes/agentv3';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

describe('emptyBuildFailureSummary — zero files is not automatically a failure', () => {
  it('THE REPORTED BUILD: a legitimate run turn is NOT called a failed empty build', () => {
    expect(emptyBuildFailureSummary(true, 0, false, true)).toBeNull();
  });

  it('🔒 without that verdict, zero files is still a failure — today’s behaviour is the default', () => {
    expect(emptyBuildFailureSummary(true, 0, false)).toMatch(/produced no files/);
    expect(emptyBuildFailureSummary(true, 0, false, false)).toMatch(/produced no files/);
  });

  it('🔒 A DEAD SANDBOX STILL FAILS, whatever was asked — it never ran anything', () => {
    // Checked before the new excuse on purpose: "run it" against a sandbox that could not start has
    // not run anything, so the App #11 guard must win.
    expect(emptyBuildFailureSummary(true, 0, true, true)).toMatch(/sandbox was unavailable/);
    expect(emptyBuildFailureSummary(true, 5, true, true)).toMatch(/sandbox was unavailable/);
  });

  it('a turn that wrote files is unaffected either way', () => {
    expect(emptyBuildFailureSummary(true, 3, false, false)).toBeNull();
    expect(emptyBuildFailureSummary(true, 3, false, true)).toBeNull();
  });

  it('a turn that never expected artifacts is unaffected', () => {
    expect(emptyBuildFailureSummary(false, 0, false, false)).toBeNull();
  });
});

describe('the two functions now agree about the same build', () => {
  const reported = {
    expectsArtifacts: true,
    filesWritten: 0,
    isEditMode: true,
    existingProjectFiles: 33,
    aborted: false,
    withinCostCap: true,
    userAskedToBuildAnApp: false,
  };

  it('the retry guard said "legitimately changed nothing" — and the verdict now says the same', () => {
    expect(shouldRetryEmptyBuild(reported)).toBe(false);          // no retry: it knew
    expect(emptyBuildFailureSummary(true, 0, false, true)).toBeNull(); // and now: no failure
  });

  it('🔒 a "build me an app" turn that wrote nothing still retries AND still fails', () => {
    expect(shouldRetryEmptyBuild({ ...reported, userAskedToBuildAnApp: true })).toBe(true);
    expect(emptyBuildFailureSummary(true, 0, false, false)).toMatch(/produced no files/);
  });
});

describe('the claim auditor’s two blind spots in that same report', () => {
  const nothingMeasured = {
    consoleCaptured: false, screenshotTaken: true, previewVerified: true,
    typecheckRan: false, sourceIsWholeApp: false,
  };

  it('ONE ADJECTIVE used to defeat the console check', () => {
    // The report's exact sentence. "no errors in the console" matched; "no RUNTIME errors in the
    // console" did not — one inserted word, and the claim sailed past.
    expect(auditSummaryClaims('No runtime errors in the browser console', nothingMeasured)
      .map((c) => c.kind)).toContain('console-clean');
  });

  it('and it is the CLASS, not that one phrase', () => {
    for (const t of ['zero JavaScript errors in the console', 'no uncaught errors in the console', 'no console errors'])
      expect(auditSummaryClaims(t, nothingMeasured).map((c) => c.kind), t).toContain('console-clean');
  });

  it('there was NO typecheck check at all — the gate said it never ran, the summary said it passed', () => {
    for (const t of ['TypeScript type-check passes cleanly', 'tsc passes', 'compiles cleanly', 'no type errors'])
      expect(auditSummaryClaims(t, nothingMeasured).map((c) => c.kind), t).toContain('typecheck-clean');
  });

  it('🔒 A MEASURED summary is accused of NOTHING — the checks judge the claim, not the wording', () => {
    const measured = { ...nothingMeasured, consoleCaptured: true, typecheckRan: true };
    expect(auditSummaryClaims('No runtime errors in the browser console. TypeScript type-check passes cleanly.', measured)).toEqual([]);
  });

  it('🔒 NOT-A-CLAIM stays not a claim — a mention of errors is not a promise about them', () => {
    for (const t of [
      'There were 3 errors in the console, which I fixed.',
      'If you see console errors, tell me.',
      'The typecheck is still failing on two files.',
      'Run a typecheck before publishing.',
      'I did not run the typecheck.',
    ]) expect(auditSummaryClaims(t, nothingMeasured), t).toEqual([]);
  });

  it('🔒 an UNKNOWN typecheck status never accuses — silence is not evidence', () => {
    const unknown = { ...nothingMeasured, typecheckRan: undefined };
    expect(auditSummaryClaims('TypeScript type-check passes cleanly', unknown)
      .map((c) => c.kind)).not.toContain('typecheck-clean');
  });
});
