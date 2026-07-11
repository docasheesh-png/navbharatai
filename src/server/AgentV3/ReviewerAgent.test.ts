import { describe, it, expect } from 'vitest';
import { reviewBuild, formatReview, isReviewFailureSummary, selectAutoFixableWarnings } from './ReviewerAgent';
import type { ReviewIssue } from './ReviewerAgent';
import type { SubAgentSpawn } from './ToolDispatcher';

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
    expect(isReviewFailureSummary('Error: All v3.0 providers failed (CLAUDE → CLAUDE_HAIKU → VERTEX → GEMINI).')).toBe(true);
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
    const failed: SubAgentSpawn = async () => ({ ok: false, summary: 'Error: All v3.0 providers failed. Last error: prompt is too long: 2204128 tokens > 1000000 maximum' });
    const r = await reviewBuild({ userRequest: 'x', fileTree: ['a'], fileSample: [], spawn: failed });
    expect(r.score).toBe(0);
    expect(formatReview(r)).toBe(''); // never "⚠️ Build Review (85/100): Error: All v3.0 providers failed…"
  });
  it('score 0 even when ok:true but the summary IS an error string (belt-and-suspenders)', async () => {
    const r = await reviewBuild({ userRequest: 'x', fileTree: ['a'], fileSample: [], spawn: makeSpawn('Error: All v3.0 providers failed') });
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
