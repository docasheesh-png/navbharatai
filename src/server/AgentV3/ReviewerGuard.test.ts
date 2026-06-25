import { describe, it, expect, vi } from 'vitest';
import { hasReviewableSource, reviewBuild, formatReview } from './ReviewerAgent';

describe('hasReviewableSource', () => {
  it('is true only when the listing has real source files', () => {
    expect(hasReviewableSource(['src/App.tsx', 'package.json'])).toBe(true);
    expect(hasReviewableSource(['index.html'])).toBe(true);
    expect(hasReviewableSource(['styles.css'])).toBe(true);
    expect(hasReviewableSource([])).toBe(false);            // empty listing (read hiccup)
    expect(hasReviewableSource(['package.json', 'README.md'])).toBe(false); // no source files
  });
});

describe('reviewBuild guard (no false 0/100 on an unreadable workspace)', () => {
  it('skips the review WITHOUT spawning when the file listing is empty, and emits nothing', async () => {
    const spawn = vi.fn(async () => ({ ok: true, summary: 'should not be called' }));
    const review = await reviewBuild({ userRequest: 'make a video player', fileTree: [], fileSample: [], spawn });
    expect(spawn).not.toHaveBeenCalled();          // never runs the reviewer model on nothing
    expect(review.score).toBe(0);                  // neutral/skipped
    expect(review.passed).toBe(true);              // does NOT fail the build
    expect(review.issues).toEqual([]);             // no "missing all source code" critical
    expect(formatReview(review)).toBe('');         // → nothing shown to the user
  });
});
