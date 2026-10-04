/**
 * AUTOPSY d798ddd3 (2026-10-04) — "Calculator app", Weak tier, ok, ₹43.75.
 *
 * The app rendered and the lean review found two real bugs: "." after an operator produces NaN, and a
 * digit typed after "Error" corrupts the display. It wrote them as `**1. Bug: …**` with no severity tag,
 * so `parseReviewOutput` read NO issues: the review was headed ✅, the one verified green repair had
 * nothing to select, and both bugs shipped. The same build planned 9 files for an app whose real work was
 * two (the planner had marked six of them "(provided)" itself), spent its only fast-lane model call on a
 * "shared contract" for one component, and its release gate said "1 thing(s) worth a look" without
 * naming it.
 *
 * Every fixture below is taken from that report.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseReviewOutput, readLabelledFinding, selectGreenRepairable, reviewHasUnreadFindings, formatReview,
  trimReviewSummary, reviewerInstruction,
} from '../src/server/AgentV3/ReviewerAgent';
import { dropUnchangedScaffold, contractHasNothingToShare, parseFileManifest, runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';
import { salvageReview } from '../src/server/AgentV3/partialReview';
import { fastLanePhaseSummary } from '../src/server/AgentV3/fastLanePhases';
import { releaseGate, type RuntimeEvidence } from '../src/server/AgentV3/releaseGate';
import { BuildDiagnostics, findingLabel } from '../src/server/AgentV3/BuildDiagnostics';

const read = (p: string) => readFileSync(p, 'utf8');

// The review, as the report carries it (the second finding's heading from the same reply).
const REVIEW = [
  'I found genuine correctness issues in the visible `App.tsx` code. The app renders, but these edge cases break the display value.',
  '',
  '**1. Bug: entering `.` after an operator produces `NaN`**',
  '',
  'In `inputDigit`, when `waitingForOperand` is `true` and the user presses `.`, the display is set to `.`:',
  '',
  '```tsx',
  'if (prev.waitingForOperand) {',
  '  return { ...prev, display: digit, waitingForOperand: false };',
  '}',
  '```',
  '',
  "`formatNumber('.')` splits into `integer = ''` and `decimal = ''`, then `parseFloat('')` is `NaN`, so the display renders as something like `NaN.`.",
  '',
  'Fix: start with `0.` when the first digit is a decimal point.',
  '',
  '**2. Bug: entering a digit after `Error` corrupts the display**',
  '',
  '`inputDigit` never checks for the error state, so the next digit is appended to "Error".',
].join('\n');

// The fast lane's plan, verbatim from the report's llmCalls.
const PLAN = [
  'src/main.tsx :: React entry point and root render',
  'src/App.tsx :: Calculator main component and logic',
  'src/ErrorBoundary.tsx :: Error boundary component (provided)',
  'src/index.css :: Global styles and calculator layout',
  'index.html :: HTML entry point (provided)',
  'package.json :: Dependencies and scripts (provided)',
  'vite.config.ts :: Vite configuration (provided)',
  'tsconfig.json :: TypeScript configuration (provided)',
  'tsconfig.build.json :: Build-specific TypeScript configuration (provided)',
  'tsconfig.node.json :: Vite config TypeScript configuration (provided)',
  '.gitignore :: Git ignore rules (provided)',
].join('\n');
const SCAFFOLD = ['package.json', 'vite.config.ts', 'src/main.tsx', 'src/index.css', 'src/App.tsx', 'src/ErrorBoundary.tsx',
  'src/vite-env.d.ts', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'index.html', '.gitignore'];

describe('1 · a finding written without our tag is still read', () => {
  it('the report\'s two bugs are read as broken warnings, and both are handed to the green repair', () => {
    const issues = parseReviewOutput(REVIEW);
    expect(issues.map((i) => i.message)).toEqual([
      'entering `.` after an operator produces `NaN`',
      'entering a digit after `Error` corrupts the display',
    ]);
    expect(issues.every((i) => i.severity === 'warning' && i.broken === true)).toBe(true);
    expect(selectGreenRepairable(issues)).toHaveLength(2);
  });

  it('the common shapes of a labelled finding are read; "Issue"/"Problem" are left to the classifier', () => {
    expect(readLabelledFinding('### Bug 2: the total never updates after a delete')).toEqual({ message: 'the total never updates after a delete', broken: true });
    expect(readLabelledFinding('1. **Bug:** the total never updates after a delete')?.broken).toBe(true);
    expect(readLabelledFinding('- Defect — saving twice duplicates the row')?.broken).toBe(true);
    expect(readLabelledFinding('**Issue: the list is not sorted by date**')).toEqual({ message: 'the list is not sorted by date', broken: false });
  });

  it('precision: prose that mentions a bug, a verdict of none, and a bare label are never findings', () => {
    expect(readLabelledFinding('This bug was fixed earlier in the build.')).toBeNull();
    expect(readLabelledFinding('Issue: none')).toBeNull();
    expect(readLabelledFinding('Bugs found: 0')).toBeNull();
    expect(parseReviewOutput('No issues found.\n[PASS] App looks complete. Score: 92')).toEqual([]);
    expect(parseReviewOutput('**Issue: no issues were found in the code**')).toEqual([]);
    expect(parseReviewOutput('**Bug: this looks odd but is a false positive, it works**')[0]?.severity).toBe('suggestion');
  });

  it('a tagged review parses exactly as before', () => {
    const issues = parseReviewOutput('[WARNING] [BROKEN] the sort ignores edits\n[SUGGESTION] consider adding a footer');
    expect(issues).toEqual([
      { severity: 'warning', message: 'the sort ignores edits', broken: true },
      { severity: 'suggestion', message: 'consider adding a footer' },
    ]);
  });

  it('the cosmetic veto still holds for a labelled finding', () => {
    expect(selectGreenRepairable(parseReviewOutput('**Bug: the padding on the keypad is uneven**'))).toEqual([]);
  });

  it('sibling: a review cut off mid-stream keeps its untagged findings too', () => {
    const salvaged = salvageReview(REVIEW.slice(0, 120 + REVIEW.indexOf('**1. Bug')));
    expect(salvaged?.issues.map((i) => i.message)).toEqual(['entering `.` after an operator produces `NaN`']);
  });

  it('the reviewer is told an untagged finding is not read', () => {
    const text = reviewerInstruction({ userRequest: 'Calculator app', fileTree: ['src/App.tsx'], fileSample: [], mode: 'suggest' } as never);
    expect(text).toContain('a finding written without one ("**1. Bug: …**") is not read');
  });
});

describe('2 · a review that names bugs we could not read is never shown as ✅', () => {
  const prose = 'I found genuine correctness issues. Pressing a digit after an error corrupts the display.';
  it('detects it; a [PASS], a clean verdict and a parsed review are not it', () => {
    expect(reviewHasUnreadFindings({ issues: [], summary: prose })).toBe(true);
    expect(reviewHasUnreadFindings({ issues: [], summary: '[PASS] App looks complete. Score: 90' })).toBe(false);
    expect(reviewHasUnreadFindings({ issues: [], summary: 'No bugs found. The app is well structured.' })).toBe(false);
    expect(reviewHasUnreadFindings({ issues: parseReviewOutput(REVIEW), summary: REVIEW })).toBe(false);
  });

  it('the header icon is ⚠️, not ✅', () => {
    expect(formatReview({ passed: true, score: 85, scoreStated: false, issues: [], summary: prose })).toMatch(/^⚠️ Build Review/);
    expect(formatReview({ passed: true, score: 85, scoreStated: false, issues: [], summary: 'Looks complete and clean.' })).toMatch(/^✅/);
  });

  it('the route records REVIEW_FINDINGS_UNREAD, and it is our instrument, not the app', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toMatch(/if \(reviewHasUnreadFindings\(review\)\) \{\s*buildDiag\.record\(\{[^}]*code: 'REVIEW_FINDINGS_UNREAD'/);
    expect(read('src/server/AgentV3/BuildDiagnostics.ts')).toContain("'REVIEW_FINDINGS_UNREAD',");
    expect(read('src/server/AgentV3/buildFindingSuggestions.ts')).toContain("'REVIEW_FINDINGS_UNREAD',");
  });
});

describe('3 · the review the user reads is never cut mid-word', () => {
  it('cuts at a paragraph or sentence, closes an open fence, and leaves a short review alone', () => {
    const cut = trimReviewSummary(REVIEW);
    expect(cut.length).toBeLessThanOrEqual(604);
    expect(cut).not.toContain('when the first digit is a d');
    expect(cut.endsWith(' …')).toBe(true);
    expect((cut.match(/```/g) ?? []).length % 2).toBe(0);
    expect(trimReviewSummary('[PASS] App looks complete. Score: 90')).toBe('[PASS] App looks complete. Score: 90');
    expect(trimReviewSummary('x'.repeat(700)).length).toBeLessThanOrEqual(604);
  });
});

describe('4 · a scaffold file the planner says it will not change is not planned', () => {
  it('the report\'s plan: 9 files become the three it works on', () => {
    const planned = parseFileManifest(PLAN).filter((m) => m.path !== 'src/ErrorBoundary.tsx');
    const { kept, dropped } = dropUnchangedScaffold(planned, SCAFFOLD);
    expect(kept.map((m) => m.path)).toEqual(['src/main.tsx', 'src/App.tsx', 'src/index.css']);
    expect(dropped).toEqual(['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json']);
  });

  it('a "(provided)" path that is NOT in the scaffold is kept, and a scaffold file with a real edit is kept', () => {
    const plan = parseFileManifest('src/utils/format.ts :: Number formatting helpers (provided)\nindex.html :: Add the app title and theme colour');
    expect(dropUnchangedScaffold(plan, SCAFFOLD).kept.map((m) => m.path)).toEqual(['src/utils/format.ts', 'index.html']);
  });

  it('the lane applies it and says so', () => {
    const src = read('src/server/AgentV3/SimpleBuilder.ts');
    expect(src).toContain('dropUnchangedScaffold(keptProvided, deps.scaffoldPaths)');
  });
});

describe('5 · one component has nothing to share, so no contract call is spent on it', () => {
  it('decides from the plan', () => {
    const files = (p: string[]) => p.map((path) => ({ path, purpose: '' }));
    expect(contractHasNothingToShare(files(['src/main.tsx', 'src/App.tsx', 'src/index.css']))).toBe(true);
    expect(contractHasNothingToShare(files(['src/App.tsx', 'src/vite-env.d.ts']))).toBe(true);
    expect(contractHasNothingToShare(files(['src/App.tsx', 'src/components/Display.tsx']))).toBe(false);
    expect(contractHasNothingToShare(files(['src/types.ts', 'src/App.tsx']))).toBe(false);
  });

  it('the report\'s lane never asks for a contract, and the phase line says why', async () => {
    let contractAsked = false;
    const r = await runSimpleBuild({
      prompt: 'Calculator app', framework: 'vite-react', scaffoldPaths: SCAFFOLD, overallTimeoutMs: 60_000,
      generate: async (system, user) => {
        if (user.includes('Plan the file list')) return PLAN;
        if (system.includes('SHARED CONTRACT')) { contractAsked = true; return 'export type Operator = "+";'; }
        const p = (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || 'x';
        return `<<<FILE ${p}>>>\n${p.endsWith('.css') ? 'body{margin:0}' : 'export default function App(){return null}'}\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
    });
    expect(contractAsked).toBe(false);
    expect(r.phases?.contractOutcome).toBe('not-needed');
    expect(fastLanePhaseSummary(r.phases)).toContain('contract not needed — one component, nothing to share');
  });
});

describe('6 · the release gate names what it counted', () => {
  const base: RuntimeEvidence = { buildOk: true, preview: 'passed', pages: 'not-run', journeys: 'none-derivable', typecheck: 'passed', tests: 'not-run', explore: 'passed', explorePresses: 12 };
  const DESIGN = 'Design consistency 96/100 (A) across 7 file(s). Design consistency — grade A (96/100), 1 issue(s):\n  ⚠ 5 spacing values are off the 4px grid';

  it('a finding\'s first clause becomes its label', () => {
    expect(findingLabel(DESIGN)).toBe('design consistency 96/100');
    expect(findingLabel('')).toBe('');
  });

  it('the headline names the warning; without labels it reads as before', () => {
    const named = releaseGate(base, { blockers: 0, highSeverity: 0, warnings: 1, warningLabels: [findingLabel(DESIGN)] });
    expect(named.headline).toContain('1 thing(s) worth a look (design consistency 96/100)');
    const more = releaseGate(base, { blockers: 0, highSeverity: 0, warnings: 3, warningLabels: ['a', 'b'] });
    expect(more.headline).toContain('3 thing(s) worth a look (a; b, +1 more)');
    expect(releaseGate(base, { blockers: 0, highSeverity: 0, warnings: 1 }).headline).toContain('1 thing(s) worth a look before shipping');
  });

  it('the labels come from the same filter as the count', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'build', severity: 'warning', code: 'DESIGN_CONSISTENCY', message: DESIGN, autoResolved: false });
    d.record({ phase: 'build', severity: 'warning', code: 'X', message: 'already fixed', autoResolved: true });
    expect(d.shippingIssueCount('warning')).toBe(1);
    expect(d.shippingIssueLabels('warning')).toEqual(['design consistency 96/100']);
    expect(read('src/server/routes/agentv3.ts')).toContain("warningLabels: buildDiag.shippingIssueLabels('warning'),");
  });
});
