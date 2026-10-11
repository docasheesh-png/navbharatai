// A SIZE NOBODY MEASURED IS NOT CLAIMED (admin 2026-10-11, Q-248 "(c) only").
//
// A delivered summary said the app's buttons were "44×44" — a number no check had measured. The phone-size
// layout check (mobileLayoutCheck.ts) measures exactly this: it opens the app at 390×844 with touch and
// reports controls too small to tap and pages wider than the screen. THE CLASS: a measurement stated with no
// measurement behind it. A size claim now stands only when that check ran and passed; otherwise the summary
// is corrected out loud. The rule is narrow by design — "responsive" and "mobile-friendly" are not sizes,
// and the self-consistency idea (b) was declined because "20 s per level" and "60 s total" can both be true.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { auditSummaryClaims, type MeasuredFacts } from '../src/server/AgentV3/claimAudit';

const base: MeasuredFacts = { consoleCaptured: true, screenshotTaken: true, previewVerified: true };
const kinds = (summary: string, phoneLayout?: MeasuredFacts['phoneLayout']) =>
  auditSummaryClaims(summary, { ...base, ...(phoneLayout ? { phoneLayout } : {}) }).map((c) => c.kind);

describe('a size claim stands only on a measured pass', () => {
  it('🔒 the report\'s claim, unmeasured, is corrected', () => {
    expect(kinds('✅ Big 44×44 buttons, easy to tap on a phone', 'not-run')).toContain('size-unmeasured');
    expect(kinds('All controls are 48px touch targets.', 'not-run')).toContain('size-unmeasured');
    expect(kinds('The board fits any phone screen.', 'not-run')).toContain('size-unmeasured');
  });

  it('🔒 measured and found wrong, it is contradicted', () => {
    expect(kinds('Buttons are 44x44 for your thumb.', 'failed')).toContain('size-contradicted');
    expect(kinds('It fits on mobile perfectly.', 'failed')).toContain('size-contradicted');
  });

  it('measured and passed, it stands; not judged, nothing is said', () => {
    expect(kinds('Big 44×44 buttons, easy to tap.', 'passed')).toEqual([]);
    expect(kinds('Big 44×44 buttons, easy to tap.')).toEqual([]);
  });

  it('narrow: words that are not sizes are left alone', () => {
    expect(kinds('A responsive, mobile-friendly layout.', 'not-run')).toEqual([]);
    expect(kinds('A 60 s timer that starts at 20 s per level.', 'not-run')).toEqual([]);
    expect(kinds('Grid of 12 x 12 cells for the puzzle.', 'not-run')).toEqual([]);
  });
});

describe('🔒 the build hands the audit what the phone check found', () => {
  it('passes the phone outcome into the claim audit', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const call = route.slice(route.indexOf('const contradictions = auditSummaryClaims(result.summary, {'), route.indexOf('const contradictions = auditSummaryClaims(result.summary, {') + 1500);
    expect(call).toContain('phoneLayout: phoneProof,');
  });
});
