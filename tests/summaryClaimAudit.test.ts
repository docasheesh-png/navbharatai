/**
 * The claim auditor's two blind spots, from build 7bc15e40's own report.
 *
 * That report's summary told the user two things the same report contradicts:
 *   • "✅ No runtime errors in the browser console" — while the report recorded RUNTIME_UNCHECKED;
 *   • "✅ TypeScript type-check passes cleanly" — while the release gate recorded that the typecheck
 *     did not run.
 * `CLAIM_UNSUPPORTED` exists precisely for this and did not fire, for two different reasons: ONE
 * ADJECTIVE defeated the console pattern, and there was no typecheck check at all.
 *
 * ⚠️ WHAT THIS FILE IS NOT. It used to sit inside two larger files that also pinned a second fix from
 * the same report — a run-action verdict, so a turn asked only to RUN the app was not called an empty
 * build. That fix was DROPPED, not weakened: PR #2917 landed `verifiedNoChangeSummary` on `main`
 * first, covering the same case from real browser evidence rather than from the prompt's wording, and
 * two answers to one question is the drift this repo keeps paying for. The claim-auditor half was
 * genuinely separate, so it survives here rather than being deleted with its neighbour.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditSummaryClaims } from '../src/server/AgentV3/claimAudit';

describe('the claim auditor’s two blind spots', () => {
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

describe('the typecheck fact is WIRED — and dropping it would fail nothing', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
  /** Strip comments: a doc block that MENTIONS a call must not satisfy an assertion about the call. */
  const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('is read from the release gate’s own evidence, never assumed', () => {
    // `typecheckRan` is optional, so removing this argument still compiles and still builds — the
    // auditor simply stops looking, silently. That is why the wiring is pinned and not just the logic.
    expect(code).toMatch(/typecheckRan:\s*gateEvidence\.typecheck\s*!==\s*'not-run'/);
  });
});
