import { describe, expect, it } from 'vitest';
import { parseReviewOutput, selectGreenRepairable } from './ReviewerAgent';

describe('a review section is not a critical finding', () => {
  // Retained reports 7ec82d80 / d52982a4 / 8d46a974 counted these titles as defects.
  it.each([
    '### [CRITICAL] Issues Found',
    '[CRITICAL] ### Security Issues',
    '### [CRITICAL] Privacy/Compliance Issues',
    '🚨 ### Runtime Correctness Findings',
    '### [WARNING] Performance Findings Identified',
  ])('does not file the title %s', (heading) => {
    const issues = parseReviewOutput(`${heading}\n[CRITICAL] The checkout throws on every payment.`);
    expect(issues).toEqual([{ severity: 'critical', message: 'The checkout throws on every payment.' }]);
  });

  it.each([
    '### [CRITICAL] Security: Database credentials are exposed in the browser.',
    '### [CRITICAL] The checkout loses orders after payment.',
    '### [CRITICAL] Login crashes when fetching security issues',
  ])('keeps an actual finding written as a heading: %s', (line) => {
    expect(parseReviewOutput(line)).toHaveLength(1);
    expect(parseReviewOutput(line)[0].severity).toBe('critical');
  });
});

describe('only an affirmed dismissal can demote a finding', () => {
  it.each([
    'This is not a false positive; the order never saves.',
    "This isn't a false positive; the order never saves.",
    'This was never a false-positive; the order never saves.',
    'This is not merely a false positive; the order never saves.',
  ])('keeps the confirmed critical: %s', (message) => {
    const issues = parseReviewOutput(`[CRITICAL] [BROKEN] ${message}`);
    expect(issues[0].severity).toBe('critical');
    expect(selectGreenRepairable(issues)).toHaveLength(1);
  });

  it('does not demote an untagged confirmed bug either', () => {
    const issues = parseReviewOutput('Bug: the save button fails; this is not a false positive.');
    expect(issues).toEqual([{ severity: 'warning', message: 'the save button fails; this is not a false positive.', broken: true }]);
    expect(selectGreenRepairable(issues)).toHaveLength(1);
  });

  it('still demotes a finding the reviewer actually dismissed', () => {
    const issues = parseReviewOutput('[CRITICAL] Missing import — this may be a false positive from the tool.');
    expect(issues[0].severity).toBe('suggestion');
    expect(selectGreenRepairable(issues)).toEqual([]);
  });
});
