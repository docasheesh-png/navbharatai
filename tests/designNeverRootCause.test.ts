import { describe, it, expect } from 'vitest';
import { isNeverRootCause } from '../src/server/AgentV3/BuildDiagnostics';

/**
 * ⚠️ A BUILD THAT SUCCEEDED WAS HEADLINED WITH A COLOUR PALETTE (admin build report 2026-08-25):
 *
 *     ok: true
 *     rootCause: "Design consistency 50/100 (D) across 12 file(s) —
 *                 35 distinct colours — consolidate into a small palette…"
 *
 * The game ran and the preview published. The one line a reader takes away said their build's problem
 * was taste.
 *
 * 🔁 AND THIS IS THE THIRD TIME THE SAME DEFECT HAS WALKED AROUND THE SAME FIX. The list's own comments
 * record the previous two:
 *
 *     PREVIEW_NOT_RENDERED     fixed → came back as RELEASE_GATE
 *     DEPHEALTH_ADVISORY       fixed → came back as DEPENDENCY_VULNERABILITIES
 *     DESIGN_PAGE_INCONSISTENT fixed → came back as DESIGN_CONSISTENCY
 *
 * Every time the SET was right and a NEW CODE walked around it. Adding one more string would have been
 * the fourth instance waiting to happen, so the rule now matches the FAMILY: a quality grade cannot be
 * a cause whatever it is called.
 */
describe('a quality grade is never a build\'s root cause', () => {
  it('the exact codes from the report', () => {
    expect(isNeverRootCause('DESIGN_CONSISTENCY')).toBe(true);
    expect(isNeverRootCause('ACCESSIBILITY')).toBe(true);
  });

  it('the ones already fixed stay fixed', () => {
    for (const c of [
      'DESIGN_PAGE_INCONSISTENT', 'RELEASE_GATE', 'CLAIM_UNSUPPORTED', 'TIME_TO_FIRST_CALL',
      'DEPENDENCY_VULNERABILITIES', 'DEPHEALTH_ADVISORY', 'REQUIREMENT_GAPS', 'POST_ANSWER_TIMING',
    ]) expect(isNeverRootCause(c), c).toBe(true);
  });

  it('🔁 and a FOURTH design code, not yet written, is already covered', () => {
    // The whole point. Someone will add one; it must not need this file edited again.
    for (const c of ['DESIGN_HEALED', 'DESIGN_PARTIALLY_HEALED', 'DESIGN_SOMETHING_NEW', 'ACCESSIBILITY_SCORE']) {
      expect(isNeverRootCause(c), c).toBe(true);
    }
  });
});

describe('but a real failure is still allowed to be the cause', () => {
  it('the families are NARROW on purpose', () => {
    // `PREVIEW_` is deliberately NOT a family: a preview that did not render genuinely can be why a
    // build failed, and muting that would trade a wrong headline for a missing one.
    for (const c of [
      'PREVIEW_NOT_RENDERED', 'PREVIEW_ERROR', 'SANDBOX_CMD_FAILED', 'TOOL_ERROR',
      'READINESS_BLOCKER', 'OUTCOME_BUILD_FAILED', 'SANDBOX_UNAVAILABLE', 'UI_WITHOUT_BUILD',
    ]) expect(isNeverRootCause(c), c).toBe(false);
  });

  it('a code that merely CONTAINS a family name is not matched — prefixes only', () => {
    expect(isNeverRootCause('APP_DESIGN_FAILED')).toBe(false);
    expect(isNeverRootCause('BUILD_ACCESSIBILITY_CRASH')).toBe(false);
  });

  it('never throws on junk', () => {
    expect(isNeverRootCause('')).toBe(false);
    expect(() => isNeverRootCause(undefined as unknown as string)).not.toThrow();
  });
});
