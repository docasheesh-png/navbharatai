/**
 * AUTOPSY e3b0ce25 (2026-10-04): "✅ Build Review: I'll read the complete files … function read_file(…) {}".
 *
 * The lean review (no tools, every changed file in full) answered with a fake tool call and no verdict,
 * and the user saw it under a ✅. Two causes, both fixed: the instruction also showed those same files
 * cut to 500 characters, so the reviewer believed it had been given truncated code; and an answer was
 * accepted as a review without containing any verdict at all.
 */
import { describe, expect, it } from 'vitest';
import { reviewBuild, reviewerInstruction, formatReview, reviewGaveAVerdict } from '../src/server/AgentV3/ReviewerAgent';

const VERBATIM = "I'll read the complete files to review them. Since the provided content was truncated, I need the full source. Read-only. function read_file({file_path: \"src/types.ts\"}) {\n}";

const base = {
  userRequest: 'Build one block fitting puzzle',
  fileTree: ['src/App.tsx', 'src/types.ts', 'src/components/BlockGame.tsx', 'src/index.css', 'package.json'],
  changedFiles: ['src/App.tsx', 'src/types.ts'],
  fileSample: [
    { path: 'src/App.tsx', content: 'export default function App() { return null; }\n' + 'x'.repeat(900) },
    { path: 'src/types.ts', content: 'export type Cell = number | null;\n' + 'y'.repeat(900) },
  ],
};

describe('a reply without a verdict', () => {
  it('the report\'s own answer is not a review and is never shown as one', async () => {
    const r = await reviewBuild({ ...base, spawn: async () => ({ ok: true, summary: VERBATIM }) } as never);
    expect(r.summary).toBe('Review did not complete.');
    expect(formatReview(r)).toBe('');
  });

  it('every real verdict still counts', () => {
    expect(reviewGaveAVerdict('[PASS] App looks complete. Score: 90', 0)).toBe(true);
    expect(reviewGaveAVerdict('Looks fine. Score: 88/100', 0)).toBe(true);
    expect(reviewGaveAVerdict('No issues were found in the changed files.', 0)).toBe(true);
    expect(reviewGaveAVerdict('anything', 2)).toBe(true);
    expect(reviewGaveAVerdict('The clear button is broken: it never resets the grid.', 0)).toBe(true);
    expect(reviewGaveAVerdict(VERBATIM, 0)).toBe(false);
    expect(reviewGaveAVerdict('', 0)).toBe(false);
  });
});

describe('a file handed in full is not also shown cut short', () => {
  it('the lean review gets no 500-character sample of a file it holds in full', () => {
    const text = reviewerInstruction({
      ...base,
      mode: 'suggest',
      inlineFiles: { files: base.fileSample.map((f) => ({ path: f.path, content: f.content })), omitted: [] },
    } as never);
    expect(text).not.toContain('SAMPLE FILE CONTENTS');
    expect(text).toContain('=== src/App.tsx ===');
  });

  it('a full review (nothing inlined) still gets its samples', () => {
    expect(reviewerInstruction({ ...base } as never)).toContain('SAMPLE FILE CONTENTS');
  });
});
