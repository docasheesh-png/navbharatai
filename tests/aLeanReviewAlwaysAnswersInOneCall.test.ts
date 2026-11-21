// A LEAN REVIEW WITH ANY CODE IN FRONT OF IT ANSWERS IN ONE CALL (failedbr #2485, Q-3236).
//
// The report: «REVIEW_LEAN … ran lean: at most 12 steps, 45s budget», the reviewer's first act was `glob src/game/**`, and
// «REVIEW_SUGGESTIONS_NOT_READY — timed out after 45000ms on 137 files». The builder's own files were long, one did not fit
// the inline bound, and ONE omitted source file sent the review to its read tools — a mode its 45 seconds cannot finish.
// 🧬 THE CLASS (its fourth appearance: 8257ca59, 0473628e, bee95692, this): a review handed a way of working that its own
// budget cannot complete. A long file is now shown from its beginning, marked; a file with no room is named as not shown.
import { describe, it, expect } from 'vitest';
import { leanReviewInline, leanReviewAnswersInOneCall, reviewerInstruction, LEAN_REVIEW_INLINE_CHARS, LEAN_REVIEW_FILE_CHARS, LEAN_REVIEW_CUT_MARK } from '../src/server/AgentV3/ReviewerAgent';

// The shape of #2485's own turn: a very long game file, its own controller, a world file, the entry.
const files: Record<string, string> = {
  'src/App.tsx': `export default function App() { return null; }\n`,
  'src/game/CustomGame.tsx': `// game\n${'a'.repeat(48_000)}`,
  'src/game/three/characterController.ts': `// controller\n${'b'.repeat(21_000)}`,
  'src/game/WorldSetup.ts': `// world\n${'c'.repeat(19_000)}`,
};

describe('🔎 the #2485 shape', () => {
  const inline = leanReviewInline(Object.keys(files), (p) => files[p]);
  it('every changed source file is in front of the reviewer — whole, or from its beginning with the cut marked', () => {
    expect(inline.files.map((f) => f.path).sort()).toEqual(Object.keys(files).sort());
    expect(inline.omitted).toEqual([]);
    expect((inline.cut ?? []).sort()).toEqual(['src/game/CustomGame.tsx', 'src/game/WorldSetup.ts', 'src/game/three/characterController.ts']);
    for (const p of inline.cut ?? []) {
      const shown = inline.files.find((f) => f.path === p)!.content;
      expect(shown.endsWith(LEAN_REVIEW_CUT_MARK), p).toBe(true);
      expect(shown.length).toBeLessThanOrEqual(LEAN_REVIEW_FILE_CHARS);
      expect(shown.startsWith(files[p].slice(0, 200)), p).toBe(true);     // the BEGINNING, unaltered
    }
    expect(inline.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(LEAN_REVIEW_INLINE_CHARS);
  });

  it('so it answers in one call, with no tools, and is told what it sees in part', () => {
    expect(leanReviewAnswersInOneCall(inline)).toBe(true);
    const text = reviewerInstruction({ userRequest: 'x', fileTree: Object.keys(files), fileSample: [], mode: 'suggest', inlineFiles: inline });
    expect(text).toMatch(/Shown only from their beginning \(each ends at a CUT HERE mark\)/);
    expect(text).toMatch(/never report as missing something that may be below the cut/);
    expect(text).toMatch(/IN FULL \(1\)/);                                 // only App.tsx is whole
  });
});

describe('🔎 when even an excerpt has no room', () => {
  it('the file is named as not shown, the review still answers in one call, and it is told to say nothing about it', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 12; i++) many[`src/part${String(i).padStart(2, '0')}.ts`] = `// ${i}\n${'z'.repeat(15_000)}`;
    const inline = leanReviewInline(Object.keys(many), (p) => many[p]);
    expect(inline.omitted.length).toBeGreaterThan(0);
    expect(inline.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThanOrEqual(LEAN_REVIEW_INLINE_CHARS);
    expect(leanReviewAnswersInOneCall(inline)).toBe(true);
    const text = reviewerInstruction({ userRequest: 'x', fileTree: Object.keys(many), fileSample: [], mode: 'suggest', inlineFiles: inline });
    expect(text).toMatch(/Changed but not shown \(they did not fit this review\)/);
    expect(text).toMatch(/say nothing about a file you were not shown/);
  });
  it('🔒 nothing inline at all is the one case that keeps the tools; a stylesheet is never cut in half', () => {
    expect(leanReviewAnswersInOneCall({ files: [], omitted: ['src/App.tsx'] })).toBe(false);
    const css = leanReviewInline(['src/App.tsx', 'src/index.css'], (p) => (p.endsWith('.css') ? 'x'.repeat(90_000) : 'export default 1;\n'));
    expect(css.omitted).toEqual(['src/index.css']);
    expect(css.cut).toBeUndefined();
  });
});
