import { describe, it, expect } from 'vitest';
import { salvageReview, hasSalvageableFindings, formatPartialReview } from './partialReview';

/**
 * The reviewer output shape from the admin's own reports — a markdown report whose findings arrive as
 * narration while the review is still running.
 */
const REAL_PARTIAL = `## Code Review Report

### [CRITICAL] (confidence: high) Missing CSS Styling — App will look broken
The classes used in Dashboard.tsx are not defined anywhere in the project.

### [WARNING] Cart total ignores quantity
computeTotal() sums item.price without multiplying by item.qty.`;

describe('a review that ran out of time is salvaged, not discarded (report 2026-09-01)', () => {
  it('THE REPORTED CASE: findings already narrated are recovered instead of binned', () => {
    // 46 files, 194s budget + 30s grace, findings discarded, app shipped with the net down.
    const out = salvageReview(REAL_PARTIAL);
    expect(out).not.toBeNull();
    expect(out!.issues).toHaveLength(2);
    expect(out!.issues[0].severity).toBe('critical');
    expect(out!.partial).toBe(true);
  });

  it('NEVER fails the build — a truncated finding is not evidence enough to condemn', () => {
    // The reviewer is instructed to self-dismiss false positives IN THE SAME finding, so a stream cut
    // mid-finding may hold a critical it was about to withdraw. Deep-test 66ec5c1e is the cost of
    // acting on a phantom one: a working, render-verified app failed and the auto-fix chased it to the
    // wall-clock cap.
    const out = salvageReview(REAL_PARTIAL);
    expect(out!.passed).toBe(true);
  });

  it('NEVER invents a score — an unfinished inspection is not scored', () => {
    // reviewBuild infers 85/40 for a COMPLETE review that omitted the number, which is fair there and
    // would be a fabrication here.
    expect(salvageReview(REAL_PARTIAL)!.score).toBe(0);
    // …but a score the reviewer actually printed is its own words, so it is carried.
    expect(salvageReview(`${REAL_PARTIAL}\n\nScore: 62/100`)!.score).toBe(62);
  });

  it('says in its own summary that it is partial, so no surface can present it as complete', () => {
    expect(salvageReview(REAL_PARTIAL)!.summary.toLowerCase()).toContain('partial');
    expect(salvageReview(REAL_PARTIAL)!.summary.toLowerCase()).toContain('unfinished');
  });

  it('a reviewer that only announced itself yields NOTHING — a header is not a finding', () => {
    // Presenting this as a partial review would be noise dressed as a finding.
    expect(salvageReview('## Code Review Report\n\nAnalyzing the project...')).toBeNull();
    expect(salvageReview('Reading src/App.tsx')).toBeNull();
    expect(hasSalvageableFindings('## Code Review Report')).toBe(false);
  });

  it('empty / junk input is null, never a fabricated verdict', () => {
    for (const bad of ['', '   ', null, undefined, 42, {}]) {
      expect(salvageReview(bad as never)).toBeNull();
    }
  });

  it('a section HEADING tagged [CRITICAL] does not become a finding', () => {
    // "### [CRITICAL] Issues" as a header made a phantom critical fail a working app (66ec5c1e).
    // parseReviewOutput already strips these; this pins that salvage inherits that protection.
    expect(salvageReview('### [CRITICAL] Issues\n### [CRITICAL] Findings')).toBeNull();
  });
});

describe('the user-facing line for a salvaged review', () => {
  it('renders the findings — it must not reuse the score-based formatter that hides them', () => {
    // formatReview() returns '' when score is 0, which is exactly when a salvaged review has findings
    // worth showing; reusing it would silently drop the very findings this rescues.
    const text = formatPartialReview(salvageReview(REAL_PARTIAL)!);
    expect(text).toContain('Missing CSS Styling');
    expect(text).toContain('Partial review');
  });

  it('caps the list and says how many more there are', () => {
    const many = Array.from({ length: 9 }, (_, i) => `[WARNING] issue number ${i}`).join('\n');
    const text = formatPartialReview(salvageReview(many)!, 3);
    expect(text).toContain('…and 6 more.');
  });

  it('names no provider or model (white-label law)', () => {
    const text = formatPartialReview(salvageReview(REAL_PARTIAL)!);
    for (const vendor of ['glm', 'kimi', 'claude', 'anthropic', 'gemini', 'grok', 'sonnet', 'opus', 'moonshot', 'z.ai']) {
      expect(text.toLowerCase()).not.toContain(vendor);
    }
  });
});
