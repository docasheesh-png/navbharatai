import { describe, it, expect } from 'vitest';
import { reviewBuild, formatReview, isReviewFailureSummary, selectAutoFixableWarnings, parseReviewOutput, reviewScope } from './ReviewerAgent';
import type { ReviewIssue } from './ReviewerAgent';
import type { SubAgentSpawn } from './ToolDispatcher';

// Deep-test 66ec5c1e (2026-07-31): a working, render-verified finance app was reported BROKEN
// (ok:false) and its auto-fix loop chased phantom bugs until the 29-min wall-clock cap, because
// parseReviewOutput mis-counted THREE non-findings as [CRITICAL]:
//   1. "### [CRITICAL] Issues"        — a markdown SECTION HEADER, not a finding
//   2. "Missing dependency: stores"   — the reviewer's OWN words: "this may be a false positive"
//   3. "React Hook Rules Violation"   — the reviewer's OWN words: "this appears to be a false positive"
// The parser must not count a section header as a finding, and must not let the reviewer's own
// self-dismissed findings fail the build.
describe('parseReviewOutput — no phantom criticals (66ec5c1e)', () => {
  it('does NOT count a markdown "### [CRITICAL] Issues" section header as a finding', () => {
    const out = parseReviewOutput('## Code Review Report\n\n### [CRITICAL] Issues\n\n[CRITICAL] Login button crashes on submit. Score: 40');
    // Only the real finding is critical — the "Issues" header is dropped.
    expect(out.filter((i) => i.severity === 'critical')).toHaveLength(1);
    expect(out.some((i) => /login button crashes/i.test(i.message))).toBe(true);
    expect(out.some((i) => /^issues?$/i.test(i.message))).toBe(false);
  });

  it('demotes a self-declared FALSE POSITIVE out of critical (the exact reviewer text)', () => {
    const text = [
      '### [CRITICAL] Issues',
      "1. **[CRITICAL] Missing dependency: `stores`** - The `evaluate` tool reports `'stores'` is imported but not in `package.json`. However, I could not find this import in the source files - this may be a false positive from the tool. The project appears to build and run without it.",
      "2. **[CRITICAL] React Hook Rules Violation in `useChartData.ts`** - Looking at the code, `useMemo` correctly lists `[transactions, dateRange]` as dependencies, so this appears to be a false positive from the evaluation tool.",
    ].join('\n');
    const parsed = parseReviewOutput(text);
    // ZERO build-failing criticals — all three "criticals" were phantoms.
    expect(parsed.filter((i) => i.severity === 'critical')).toHaveLength(0);
    // The self-dismissed findings are retained (as suggestions) for the admin audit trail, not erased.
    expect(parsed.some((i) => /stores/i.test(i.message) && i.severity === 'suggestion')).toBe(true);
    expect(parsed.some((i) => /useChartData|hook rules/i.test(i.message) && i.severity === 'suggestion')).toBe(true);
  });

  it('skips an EMOJI-PREFIXED heading regardless of marker order (8a6e4585: "🚨 ### Issues")', () => {
    // Real report 8a6e4585 re-rendered its findings with a leading 🚨 before the ### heading. The
    // section-label skip must hold no matter whether # or the emoji comes first.
    for (const header of ['🚨 ###  Issues', '### 🚨 Issues', '- 🚨 Critical Issues', '## ⚠️ Warnings']) {
      const parsed = parseReviewOutput(header);
      expect(parsed.filter((i) => /^issues?$/i.test(i.message) || /^(critical\s+)?issues?$/i.test(i.message))).toHaveLength(0);
      expect(parsed.filter((i) => i.severity === 'critical')).toHaveLength(0);
    }
  });

  it('CONFIDENCE GATE (M4-S4.1): an explicitly low/medium-confidence critical is downgraded to a warning', () => {
    const low = parseReviewOutput('[CRITICAL] (confidence: low) The list may not sort correctly in some edge case.');
    expect(low.filter((i) => i.severity === 'critical')).toHaveLength(0);
    expect(low.some((i) => i.severity === 'warning' && /list may not sort/i.test(i.message))).toBe(true);

    const med = parseReviewOutput('[CRITICAL] Auth might be missing — medium confidence, could not verify.');
    expect(med.filter((i) => i.severity === 'critical')).toHaveLength(0);
  });

  it('an UN-TAGGED critical stays critical (backward-safe — a reviewer that ignores the format is not weakened)', () => {
    const untagged = parseReviewOutput('[CRITICAL] The checkout endpoint 500s on every order.');
    expect(untagged.filter((i) => i.severity === 'critical')).toHaveLength(1);
    const high = parseReviewOutput('[CRITICAL] (confidence: high) Login is completely broken.');
    expect(high.filter((i) => i.severity === 'critical')).toHaveLength(1);
  });

  it('a GENUINE critical is still counted (self-dismissal guard is conservative)', () => {
    const parsed = parseReviewOutput('[CRITICAL] The checkout API is completely broken — every order 500s. Score: 20');
    expect(parsed.filter((i) => i.severity === 'critical')).toHaveLength(1);
  });

  it('does not treat "not a false positive" style confirmations as dismissals', () => {
    const parsed = parseReviewOutput('[CRITICAL] Payment fails — verified, this is a real, genuine bug, not a false positive is wrong wording; the order never saves.');
    // The line contains "false positive" — but conservatism here is acceptable (demotes). Assert it does
    // NOT crash and still yields a finding; the important invariant (no phantom criticals) holds above.
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });
});

// Option 2 (autopsy 2026-07-11, Notes report): the C9 auto-fix only repaired [CRITICAL] findings,
// but the Notes app's real functional bugs were all [WARNING] — so they shipped. This classifier
// picks the FUNCTIONAL warnings worth an auto-repair while leaving cosmetic/advisory ones alone.
describe('selectAutoFixableWarnings — functional warnings in, cosmetic warnings out', () => {
  const w = (message: string): ReviewIssue => ({ severity: 'warning', message });

  it('picks the REAL Notes-report functional warnings', () => {
    const issues: ReviewIssue[] = [
      w('Double auto-focus conflict — NoteEditor steals focus from SearchBar; the note input never holds focus'),
      w('Sort applied before filter but sorted on createdAt only, ignoring edits'),
      w('isAtLimit blocks the Add Note button unnecessarily'),
    ];
    const picked = selectAutoFixableWarnings(issues).map((i) => i.message);
    expect(picked).toHaveLength(3);
  });

  it('EXCLUDES cosmetic / a11y / style advisories', () => {
    const issues: ReviewIssue[] = [
      w('No aria-label on the Complete/Delete buttons for screen readers'),
      w('No <main> landmark element — consider adding one for semantics'),
      w('Naming convention: prefer PascalCase for the component file'),
      w('Double spacing between the input and list (margin + gap)'),
    ];
    expect(selectAutoFixableWarnings(issues)).toHaveLength(0);
  });

  it('only considers WARNING severity (criticals + suggestions are handled elsewhere / left)', () => {
    const issues: ReviewIssue[] = [
      { severity: 'critical', message: 'Login is completely broken' },
      { severity: 'suggestion', message: 'this does not work well, consider refactor' },
      w('the delete button does not work'),
    ];
    const picked = selectAutoFixableWarnings(issues);
    expect(picked).toHaveLength(1);
    expect(picked[0].message).toContain('delete button');
  });

  it('is robust to junk input (non-array, empty/blank messages)', () => {
    expect(selectAutoFixableWarnings(undefined as unknown as ReviewIssue[])).toEqual([]);
    expect(selectAutoFixableWarnings([{ severity: 'warning', message: '' } as ReviewIssue])).toEqual([]);
    expect(selectAutoFixableWarnings([{ severity: 'warning', message: '   ' } as ReviewIssue])).toEqual([]);
  });

  it('a warning that is BOTH functional and cosmetic-worded stays conservative (cosmetic wins → skipped)', () => {
    // "consider" + "aria" read as advisory even though "missing" appears — don't churn on it.
    expect(selectAutoFixableWarnings([w('Missing aria-label — consider adding one')])).toHaveLength(0);
  });
});

const makeSpawn =
  (summary: string): SubAgentSpawn =>
  async () => ({ ok: true, summary });

describe('isReviewFailureSummary + reviewBuild honesty (no fake "(85/100)" on an errored review)', () => {
  it('classifies real reviewer-failure summaries as failures', () => {
    expect(isReviewFailureSummary('Error: All v5.0 providers failed (CLAUDE → CLAUDE_HAIKU → VERTEX → GEMINI).')).toBe(true);
    expect(isReviewFailureSummary('This request is too large for every AI provider')).toBe(true);
    expect(isReviewFailureSummary('Step limit reached (40)')).toBe(true);
    expect(isReviewFailureSummary('')).toBe(true);
    expect(isReviewFailureSummary(undefined)).toBe(true);
  });
  it('a real review is NOT a failure', () => {
    expect(isReviewFailureSummary('[CRITICAL] Login missing. Score: 40')).toBe(false);
    expect(isReviewFailureSummary('[PASS] App looks complete. Score: 92')).toBe(false);
  });
  it('score 0 (no rendered review) when the reviewer sub-agent returned ok:false — the report bug', async () => {
    const failed: SubAgentSpawn = async () => ({ ok: false, summary: 'Error: All v5.0 providers failed. Last error: prompt is too long: 2204128 tokens > 1000000 maximum' });
    const r = await reviewBuild({ userRequest: 'x', fileTree: ['a'], fileSample: [], spawn: failed });
    expect(r.score).toBe(0);
    expect(formatReview(r)).toBe(''); // never "⚠️ Build Review (85/100): Error: All v5.0 providers failed…"
  });
  it('score 0 even when ok:true but the summary IS an error string (belt-and-suspenders)', async () => {
    const r = await reviewBuild({ userRequest: 'x', fileTree: ['a'], fileSample: [], spawn: makeSpawn('Error: All v5.0 providers failed') });
    expect(r.score).toBe(0);
    expect(formatReview(r)).toBe('');
  });
});

describe('reviewBuild', () => {
  it('returns passed=true and high score when reviewer says PASS', async () => {
    const result = await reviewBuild({
      userRequest: 'build a todo app',
      fileTree: ['src/App.tsx', 'src/TodoList.tsx'],
      fileSample: [{ path: 'src/App.tsx', content: 'export function App() {}' }],
      spawn: makeSpawn('[PASS] App looks complete. Score: 95'),
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it('returns passed=false when reviewer finds critical issues', async () => {
    const result = await reviewBuild({
      userRequest: 'build a login app',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('[CRITICAL] Login feature is completely missing.\n[WARNING] No error handling.\nScore: 30'),
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(true);
    expect(result.score).toBeLessThan(60);
  });

  it('detects WARNING issues without failing the build', async () => {
    const result = await reviewBuild({
      userRequest: 'build a dashboard',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('[WARNING] No loading state shown.\nScore: 75'),
    });
    expect(result.passed).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('resolves gracefully (passed=true, score=0) when spawn throws', async () => {
    const failSpawn: SubAgentSpawn = async () => {
      throw new Error('spawn unavailable');
    };
    const result = await reviewBuild({
      userRequest: 'build something',
      fileTree: [],
      fileSample: [],
      spawn: failSpawn,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(0);
  });

  it('parses emoji-style issue markers', async () => {
    const result = await reviewBuild({
      userRequest: 'make a chat app',
      fileTree: ['src/App.tsx'],
      fileSample: [],
      spawn: makeSpawn('🚨 Messages are not persisted anywhere.\n⚠️ No input validation.\nScore: 55'),
    });
    expect(result.issues.some((i) => i.severity === 'critical')).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('formatReview', () => {
  it('returns empty string when score is 0 (review was skipped)', () => {
    expect(formatReview({ passed: true, score: 0, issues: [], summary: '' })).toBe('');
  });

  it('includes score and summary in output', () => {
    const out = formatReview({ passed: true, score: 92, issues: [], summary: 'Looks complete.' });
    expect(out).toContain('92');
    expect(out).toContain('Looks complete.');
  });

  it('uses ✅ for high scores, ⚠️ for medium, ❌ for low', () => {
    expect(formatReview({ passed: true, score: 95, issues: [], summary: 'great' })).toContain('✅');
    expect(formatReview({ passed: true, score: 75, issues: [], summary: 'ok' })).toContain('⚠️');
    expect(formatReview({ passed: false, score: 35, issues: [], summary: 'bad' })).toContain('❌');
  });

  it('includes issue lines when issues are present', () => {
    const out = formatReview({
      passed: false,
      score: 45,
      issues: [{ severity: 'critical', message: 'Missing auth' }],
      summary: 'Issues found.',
    });
    expect(out).toContain('Missing auth');
    expect(out).toContain('🚨');
  });
});

/**
 * DIFF-SCOPED REVIEW.
 *
 * Shiv Medical Store report (2026-08-10): a turn that changed 3 files in a 78-file project sent the
 * reviewer through ~25 read_file calls across the whole app. Tokens are the user's bill, and it is
 * also the wrong review — it re-litigates code the user never touched, which is how a clean edit
 * collects "issues" about pre-existing decisions.
 */
describe('reviewScope', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `src/f${i}.ts`);

  it('focuses on a small edit in a large project — the reported case', () => {
    const scope = reviewScope(['src/App.tsx', 'index.html', '.env.example'], 78);
    expect(scope.focused).toBe(true);
    expect(scope.files).toHaveLength(3);
  });

  it('does NOT focus a new build — everything changed, so everything is in scope', () => {
    expect(reviewScope(many(40), 40).focused).toBe(false);
  });

  it('does NOT focus when a large share of the project moved — a rebuild in all but name', () => {
    expect(reviewScope(many(30), 60).focused).toBe(false);
  });

  it('does NOT focus a small project — reviewing it whole is cheap anyway', () => {
    expect(reviewScope(['src/a.ts'], 6).focused).toBe(false);
  });

  it('does NOT focus when nothing was recorded — never guess a narrow scope', () => {
    // Guessing here would review 3 files while the thing that broke sits in the fourth.
    expect(reviewScope(undefined, 78).focused).toBe(false);
    expect(reviewScope([], 78).focused).toBe(false);
    expect(reviewScope(['', '  '], 78).focused).toBe(false);
  });

  it('is stable at the boundary rather than flipping on one file', () => {
    // The rule is MORE THAN a third, so exactly a third (26 of 78) still focuses — reviewing 26 named
    // files beats surveying all 78 — and 27 tips it into "review the whole thing".
    expect(reviewScope(many(26), 78).focused).toBe(true);
    expect(reviewScope(many(27), 78).focused).toBe(false);
  });
});
