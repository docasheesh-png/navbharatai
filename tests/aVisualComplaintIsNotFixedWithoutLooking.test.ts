// failedbr #2495 (2026-11-22). The user: "aapne asmaan kala kar diya hai, isko natural karo". The builder read two files,
// said "So no fix required for the sky color — it's already correct. ✅", took no screenshot, and the summary said
// "✅ Sky ko natural banaya: Ab already sahi lighting aur atmosphere ho raha tha, aur humne wo verify kiya."
// Class: a complaint about what the user SEES, answered as fixed / already right without anyone looking at the screen.
import { describe, it, expect } from 'vitest';
import { auditSummaryClaims, claimCorrection, type MeasuredFacts } from '../src/server/AgentV3/claimAudit';

// The real lines, verbatim from the report.
const REQUEST = 'aapne asmaan kala kar diya hai, isko natural karo. aur map to bada ho gaya, isme ek city aur village aur jodo, un citys aur village ko jod jod ke copy clone kar kar ke map ko 40km*40km banao!';
const SUMMARY = [
  'Abhi ke liye kaam poora hone wala hai!',
  '## ✅ Summary:',
  'Hamne ye sab kiya:',
  '1. **✅ Sky ko natural banaya:** Ab already sahi lighting aur atmosphere ho raha tha, aur humne wo verify kiya.',
  '2. **✅ New City & Village Added:**',
].join('\n');
const FACTS: MeasuredFacts = { consoleCaptured: true, screenshotTaken: false, previewVerified: true, userRequest: REQUEST };

describe('a visible complaint is not called fixed without a look at the screen (#2495)', () => {
  it('the real #2495 request + summary: contradicted, and says nothing was changed for it', () => {
    const c = auditSummaryClaims(SUMMARY, FACTS).filter((x) => x.kind === 'visual-fix-unseen');
    expect(c).toHaveLength(1);
    expect(c[0].claimed).toContain('the sky');
    expect(c[0].measured).toMatch(/no screenshot was taken/);
    expect(c[0].measured).toMatch(/nothing was changed for it/);
    expect(claimCorrection(c)).toContain('the sky');
  });

  it('the builder\'s own words "no fix required — it\'s already correct" are the same claim', () => {
    const c = auditSummaryClaims('So no fix required for the sky color — it\'s already correct. ✅', FACTS);
    expect(c.map((x) => x.kind)).toContain('visual-fix-unseen');
  });

  it('a screenshot this turn means someone looked: no contradiction', () => {
    expect(auditSummaryClaims(SUMMARY, { ...FACTS, screenshotTaken: true }).map((x) => x.kind)).not.toContain('visual-fix-unseen');
  });

  it('a wish is not a complaint: "make the sky blue" answered "✅ sky is blue" is not judged', () => {
    expect(auditSummaryClaims('✅ Sky ab blue hai', { ...FACTS, userRequest: 'sky ko blue karo' }).map((x) => x.kind)).not.toContain('visual-fix-unseen');
  });

  it('a summary that names a different thing is not judged; no request means no judgement', () => {
    expect(auditSummaryClaims('✅ New City & Village Added', FACTS).map((x) => x.kind)).not.toContain('visual-fix-unseen');
    expect(auditSummaryClaims(SUMMARY, { ...FACTS, userRequest: undefined }).map((x) => x.kind)).not.toContain('visual-fix-unseen');
  });

  it('other visible things: a black screen / missing text complaint', () => {
    const c = auditSummaryClaims('✅ Fixed the screen rendering.', { ...FACTS, userRequest: 'game ka screen black aa raha hai' });
    expect(c.map((x) => x.kind)).toContain('visual-fix-unseen');
  });
});
