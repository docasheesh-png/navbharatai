import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  selectGreenRepairable, selectAutoFixableWarnings, isFunctionalFinding, namesBrokenBehaviour,
  parseReviewOutput, type ReviewIssue,
} from '../src/server/AgentV3/ReviewerAgent';
import {
  snapToGrid, snapSpacingInSource, spacingSnapPatches, spacingSnapEnabled, spacingSnapNote, isCoherentOtherGrid,
} from '../src/server/AgentV3/spacingSnap';
import { decideStyleResume } from '../src/server/AgentV3/stylePolishResume';
import {
  noJourneyReason, savedStateEvidence, savedWithoutFormReason, appHasNoDataEntry, NO_DATA_ENTRY_REASON,
} from '../src/server/AgentV3/journeyDerivation';
import { extractSpacingPx, offGridSpacing } from '../src/server/AppMakerLab/intelligence/DesignLinter';
import { stripCommentsForMarkup } from '../src/server/AgentV3/stripCodeComments';

/**
 * BUILD 536c8189 — "Build an app like Duolingo but change a little". Weak tier, `ok: true`, 7.2 min,
 * ₹152.52. The app worked. Three separate things in that one report were wrong:
 *
 *  1. 🥵 The end-of-turn hand-back gave the model a list of off-grid spacing values and told it to snap
 *     them. It answered with three ad-hoc `node -e` regex scripts over the 634-line `src/index.css`, one
 *     `edit_file` that failed with "old_string is not unique in src/index.css (80 matches)", ~45 s and
 *     three model calls — and MOVED ON-GRID VALUES OFF THE GRID. `DESIGN_CONSISTENCY` still ended at
 *     98/100 with values off the grid.
 *  2. ❌ The reviewer found a real bug ("`setMatchedKeys` is never called … the guard always evaluates to
 *     false") and NO repair ran: no `REVIEW_FUNCTIONAL_*` code appears anywhere in the report, because
 *     the selector's phrase list does not contain "never called" or "always evaluates to false".
 *  3. ❌ `JOURNEY_NOT_DERIVED` told the user the app "has no data-entry surface at all … nothing to save
 *     and reload" — about an app that keeps XP, gems, a streak and finished lessons in localStorage.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1 · ARITHMETIC IS NOT A MODEL'S JOB
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('spacing is snapped by construction, not by asking a model', () => {
  it('nearest multiple of 4, ties to the smaller, never zero', () => {
    expect(snapToGrid(6)).toBe(4);     // tie → tighter
    expect(snapToGrid(10)).toBe(8);    // tie → tighter
    expect(snapToGrid(14)).toBe(12);
    expect(snapToGrid(7)).toBe(8);
    expect(snapToGrid(9)).toBe(8);
    expect(snapToGrid(2)).toBe(4);     // would be 0 — spacing is never removed
    expect(snapToGrid(1)).toBe(4);
    expect(snapToGrid(8)).toBe(8);     // already on the grid
  });

  // 🔴 THE EXACT REGRESSION: the model's own script, from the report.
  //     .replace(/padding: 4px 8px/g, 'padding: 2px 6px')
  //     .replace(/gap: 4px;/g,        'gap: 6px;')
  it('NEVER moves an on-grid value off the grid — the thing the model did', () => {
    const css = '.chip { padding: 4px 8px; gap: 4px; margin: 12px; }';
    expect(snapSpacingInSource(css)).toBeNull(); // nothing to do, so nothing is touched
    const after = snapSpacingInSource('.chip { padding: 6px 10px; }')!.content;
    for (const v of offGridSpacing(extractSpacingPx(after))) expect(v, after).toBeUndefined();
  });

  it('snaps the real values and leaves everything else byte-identical', () => {
    const css = [
      '.card { padding: 10px 6px; gap: 14px; color: #ff0033; border: 1px solid #222; }',
      '.card h2 { font-size: 13px; margin: 0 0 6px; line-height: 1.45; }',
    ].join('\n');
    const out = snapSpacingInSource(css)!;
    expect(out.content).toContain('padding: 8px 4px');
    expect(out.content).toContain('gap: 12px');
    expect(out.content).toContain('margin: 0 0 4px');
    // Not spacing — never read, never rewritten.
    expect(out.content).toContain('#ff0033');
    expect(out.content).toContain('border: 1px solid');
    expect(out.content).toContain('font-size: 13px');
    expect(out.content).toContain('line-height: 1.45');
    expect(out.changes).toContain('10px → 8px');
    expect(out.changes).toContain('6px → 4px');
  });

  it('the result is on the grid — the property the finding actually asks for', () => {
    const css = '.a{padding:3px}.b{margin:7px 9px}.c{gap:13px}.d{padding:5px}';
    const out = snapSpacingInSource(css)!;
    expect(offGridSpacing(extractSpacingPx(out.content))).toEqual([]);
  });

  it('a commented-out value is neither counted nor rewritten', () => {
    const css = '/* .old { padding: 6px; } */\n.new { padding: 10px; }';
    const out = snapSpacingInSource(css)!;
    expect(out.content).toContain('/* .old { padding: 6px; } */');
    expect(out.content).toContain('padding: 8px');
  });

  // 🔒 AN APP ON ITS OWN RHYTHM IS NOT A DEFECT TO CORRECT — but a MESS is not a rhythm.
  it('stands down on a stylesheet that is coherently off the 4px grid', () => {
    expect(snapSpacingInSource('.a{padding:6px}.b{margin:18px}.c{gap:30px}.d{padding:42px}')).toBeNull();
    expect(snapSpacingInSource('.a{padding:5px}.b{margin:15px}.c{gap:25px}')).toBeNull();
  });

  it('a rhythm needs a real shared divisor and a real sample', () => {
    expect(isCoherentOtherGrid([6, 18, 30, 42])).toBe(true);   // a 6px system
    expect(isCoherentOtherGrid([5, 10, 15])).toBe(true);       // a 5px system
    expect(isCoherentOtherGrid([10, 6, 14, 6])).toBe(false);   // gcd 2 — not a system, just sloppy
    expect(isCoherentOtherGrid([6, 18])).toBe(false);          // two values prove nothing
    expect(isCoherentOtherGrid([])).toBe(false);
    expect(isCoherentOtherGrid([6, 18, 30, 7])).toBe(false);   // one stray breaks the rhythm
    expect(isCoherentOtherGrid([2.5, 7.5, 12.5])).toBe(false); // fractional — never read as a grid
  });

  // The sloppy stylesheet the module exists for, and the one the first draft of that guard stood down on.
  it('a sloppy stylesheet is still snapped', () => {
    const out = snapSpacingInSource('.a{padding:10px 6px}.b{gap:14px}.c{margin:0 0 6px}');
    expect(out).not.toBeNull();
    expect(offGridSpacing(extractSpacingPx(out!.content))).toEqual([]);
  });

  // THE e49afa97 / dfd24058 STYLESHEET, carried over from `tests/offGridSpacingIsHandedBack.test.ts`,
  // which this change retires along with `offGridHandBack` (it had no caller left once spacing stopped
  // being handed to the model). The coverage it was protecting lives here, against the snap instead.
  it('the Q-037 stylesheet is snapped, comments and on-grid values untouched', () => {
    const sheet = [
      ':root { --accent: #4f46e5; }',
      '.card { padding: 10px 14px; margin-bottom: 6px; }',
      '.row { gap: 10px; }',
      '.btn { padding: 6px 18px; }',
      '.list { margin: 16px 0; padding: 8px; }',
      '/* padding: 3px — a comment is not a rule */',
    ].join('\n');
    const out = snapSpacingInSource(sheet)!;
    // The LINT strips comments before it counts, so that is what "on the grid" is measured against —
    // the commented 3px is deliberately left alone and is not a surviving finding.
    expect(offGridSpacing(extractSpacingPx(stripCommentsForMarkup(out.content)))).toEqual([]);
    expect(out.content).toContain('/* padding: 3px');          // the comment is left exactly as written
    expect(out.content).toContain('margin: 16px 0');            // already on the grid
    expect(out.content).toContain('padding: 8px');              // already on the grid
    expect(out.content).toContain('--accent: #4f46e5');         // not spacing
    expect(out.content).toContain('padding: 8px 12px');         // 10px 14px
    expect(out.content).toContain('margin-bottom: 4px');        // 6px
    expect(out.content).toContain('padding: 4px 16px');         // 6px 18px
  });

  it('only files THIS build wrote are touched', () => {
    const files = {
      'src/index.css': '.a{padding:10px}.b{gap:6px}.c{margin:14px}.d{padding:18px}',
      'src/theirs.css': '.x{padding:10px}.y{gap:6px}.z{margin:14px}.w{padding:18px}',
    };
    const patches = spacingSnapPatches(files, ['src/index.css'], {} as NodeJS.ProcessEnv);
    expect(patches.map((p) => p.path)).toEqual(['src/index.css']);
  });

  it('nothing is edited below the finding\'s own threshold', () => {
    // Two off-grid values: the report would not even name them, so neither does the snap.
    const files = { 'src/a.css': '.a{padding:10px}.b{gap:6px}.c{margin:8px}' };
    expect(spacingSnapPatches(files, ['src/a.css'], {} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('a vendored or generated file is never rewritten', () => {
    const css = '.a{padding:10px}.b{gap:6px}.c{margin:14px}.d{padding:18px}';
    for (const path of ['node_modules/x/style.css', 'dist/app.css', 'src/vendor.min.css']) {
      expect(spacingSnapPatches({ [path]: css }, [path], {} as NodeJS.ProcessEnv), path).toEqual([]);
    }
  });

  it('the kill switch is off-by-value only, and the default is ON', () => {
    expect(spacingSnapEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(spacingSnapEnabled({ AGENTV3_SPACING_SNAP: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(spacingSnapEnabled({ AGENTV3_SPACING_SNAP: 'nonsense' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('the admin note names what moved', () => {
    const note = spacingSnapNote([{ path: 'src/index.css', content: '', changes: ['6px → 4px'] }]);
    expect(note).toContain('6px → 4px');
    expect(note).toContain('src/index.css');
  });

  // REVERSION GUARD: the hand-back is what cost the money, and `tsc`/`vitest` cannot see a message
  // branch being re-added. Spacing must never be handed to the model again.
  it('the model is NEVER handed spacing values at the end of its turn', () => {
    const d = decideStyleResume({
      text: 'The app is ready.', missing: [], pages: [], resumesUsed: 0, producedFiles: true,
      env: {} as NodeJS.ProcessEnv,
    });
    expect(d.resume).toBe(false);
    expect(d.standDown).toBe('nothing-missing');
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/stylePolishResume.ts'), 'utf8');
    expect(src).not.toContain('nearest multiple of 4px');
    expect(src).not.toContain('input.offGrid');
    const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).not.toContain('offGrid: style.offGrid');
  });

  // 🔒 BOTH LANES, ONE FUNCTION — the class `ensureHtmlEntryScript` was fixed in one lane of two.
  it('both build lanes run the snap', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const calls = route.match(/spacingSnapPatches\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(route).toContain("code: 'SPACING_SNAPPED'");
  });

  // ONE DEFINITION of what a spacing declaration is — the lint and the snap must read the same thing.
  it('the snap reads the linter\'s own regex, never a copy', () => {
    const snap = readFileSync(join(__dirname, '../src/server/AgentV3/spacingSnap.ts'), 'utf8');
    expect(snap).toContain('SPACING_DECL_RE_SOURCE');
    expect(snap).toContain('SPACING_PX_RE_SOURCE');
    expect(snap).not.toContain('padding|margin|gap|row-gap|column-gap');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2 · A REAL BUG, DESCRIBED IN PLAIN WORDS, MUST STILL BE PICKED
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The reviewer's finding from report 536c8189, verbatim. */
const THE_FINDING =
  '`matchedKeys` and `setMatchedKeys` are declared and reset, but `setMatchedKeys` is never called in '
  + '`handleMatchClick` or elsewhere. The guard `if (matchedKeys.includes(key)) return;` always evaluates '
  + 'to `false`, so a key can be matched multiple times.';

describe('the reviewer\'s own words are enough to earn a repair', () => {
  it('the exact finding from the report is selected', () => {
    expect(isFunctionalFinding(THE_FINDING)).toBe(true);
    const issues: ReviewIssue[] = [{ severity: 'warning', file: 'src/App.tsx', message: THE_FINDING }];
    expect(selectGreenRepairable(issues)).toHaveLength(1);
    expect(selectAutoFixableWarnings(issues)).toHaveLength(1);
  });

  // Every one of these was MISSED by the closed `never (fires|works|holds|updates|renders)` list.
  it.each([
    'setMatchedKeys is never called in handleMatchClick or elsewhere',
    'the submit handler is never invoked',
    'the progress is never saved to storage',
    'the effect never runs, so the list stays empty',
    'this function is never used anywhere in the app',
    'the Next button is never enabled',
    'the streak is never persisted between sessions',
  ])('"%s" is picked', (m) => {
    expect(isFunctionalFinding(m), m).toBe(true);
  });

  it.each([
    'the guard always evaluates to false, so a key can be matched multiple times',
    'the condition is always true, so the branch below is dead',
    'the comparison will always be false',
  ])('a dead condition is picked: "%s"', (m) => {
    expect(isFunctionalFinding(m), m).toBe(true);
  });

  // THE PRECISION LOCK. The cosmetic veto is what makes the open `never \w+` safe, so it must hold.
  it.each([
    'Consider adding an aria-label to the search input',
    'Variable naming could be clearer in utils.ts',
    'the aria-label is never set on the icon button',
    'always use the kit classes instead of inline styles',
    'spacing is inconsistent — prefer multiples of 4px',
    'The comments could be more descriptive',
    'this would be nicer with a semantic <main> landmark',
    'minor: the padding is a little tight',
  ])('advice is still NOT repairable: "%s"', (m) => {
    expect(isFunctionalFinding(m), m).toBe(false);
  });

  it('an empty or non-string finding is never repairable', () => {
    expect(isFunctionalFinding('')).toBe(false);
    expect(isFunctionalFinding(undefined)).toBe(false);
    expect(isFunctionalFinding(42)).toBe(false);
  });
});

describe('the reviewer declares it, so we stop guessing from prose', () => {
  it('[BROKEN] is read, and never reaches the user\'s screen', () => {
    const issues = parseReviewOutput('[WARNING] [BROKEN] tapping Check does nothing at all');
    expect(issues).toHaveLength(1);
    expect(issues[0].broken).toBe(true);
    expect(issues[0].message).not.toContain('[BROKEN]');
    expect(issues[0].message).not.toMatch(/broken/i);
    expect(issues[0].message).toBe('tapping Check does nothing at all');
  });

  it('the tag earns a repair for a finding no classifier would catch', () => {
    const issues: ReviewIssue[] = [{ severity: 'warning', message: 'the second lesson shows the first lesson\'s words', broken: true }];
    expect(isFunctionalFinding(issues[0].message)).toBe(false); // our prose classifier cannot see it
    expect(namesBrokenBehaviour(issues[0])).toBe(true);         // the reviewer said so
    expect(selectGreenRepairable(issues)).toHaveLength(1);
  });

  // 🔒 A MODEL MAY NOT WIDEN WHAT A REPAIR TOUCHES ON A WORKING APP BY TYPING A WORD.
  it('the cosmetic veto still vetoes a tagged finding', () => {
    const issues: ReviewIssue[] = [{ severity: 'critical', message: 'the aria-label is missing on the icon button', broken: true }];
    expect(namesBrokenBehaviour(issues[0])).toBe(false);
    expect(selectGreenRepairable(issues)).toEqual([]);
  });

  it('an untagged reviewer keeps exactly today\'s behaviour', () => {
    const issues = parseReviewOutput('[WARNING] the sort ignores edits');
    expect(issues[0].broken).toBeUndefined();
    expect(selectGreenRepairable(issues)).toHaveLength(1);
  });

  it('the reviewer is actually asked for the tag, and told what it costs', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/ReviewerAgent.ts'), 'utf8');
    expect(src).toContain('[BROKEN]');
    // …and the suggest-mode prompt no longer tells it that nothing will be repaired, which stopped
    // being true when AGENTV3_GREEN_FUNCTIONAL_REPAIR shipped on 2026-09-23.
    expect(src).not.toContain('no repair will run from it');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3 · "NOTHING TO SAVE" MUST NOT BE SAID ABOUT AN APP THAT SAVES
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The shape of the app in report 536c8189: word tiles (buttons), progress in localStorage. */
const DUOLINGO = {
  // `hasRenderSurface` needs positive evidence of a UI before any "nothing to prove here" sentence —
  // see its own docblock. A real Vite app has this file; a fixture without it is not the app.
  'src/main.tsx': "createRoot(document.getElementById('root')!).render(<App />);",
  'src/App.tsx': [
    "import { useProgress } from './hooks/useProgress';",
    'export default function App() {',
    '  const { xp, addXp } = useProgress();',
    '  return (<main><h1>Lesson 1</h1><button onClick={() => addXp(10)}>manzana</button><p>{xp} XP</p></main>);',
    '}',
  ].join('\n'),
  'src/hooks/useProgress.ts': [
    "const KEY = 'duo-progress';",
    'export function useProgress() {',
    '  const [state, setState] = useState(() => JSON.parse(localStorage.getItem(KEY) ?? \'{}\'));',
    '  const addXp = (n: number) => setState((s) => { const next = { ...s, xp: (s.xp ?? 0) + n };',
    '    localStorage.setItem(KEY, JSON.stringify(next)); return next; });',
    '  return { ...state, addXp };',
    '}',
  ].join('\n'),
};

describe('an app whose controls are buttons can still save and reload', () => {
  it('it really has no form — that part of the old answer was true', () => {
    expect(appHasNoDataEntry(DUOLINGO)).toBe(true);
  });

  it('…and it really does save, which is what the sentence denied', () => {
    const where = savedStateEvidence(DUOLINGO);
    expect(where).not.toBeNull();
    expect(where!.path).toBe('src/hooks/useProgress.ts');
    expect(where!.what).toBe('browser storage');
  });

  it('the sentence the user reads no longer says the app saves nothing', () => {
    const reason = noJourneyReason(DUOLINGO);
    expect(reason).not.toBe(NO_DATA_ENTRY_REASON);
    expect(reason).not.toContain('nothing to save');
    expect(reason).toContain('does save state');
    expect(reason).toContain('src/hooks/useProgress.ts');
  });

  // 🔒 A GAME THAT GENUINELY SAVES NOTHING KEEPS THE OLD, TRUE SENTENCE.
  it('a canvas game with no storage still reads as having nothing to save', () => {
    const game = {
      'src/main.tsx': "createRoot(document.getElementById('root')!).render(<App />);",
      'src/App.tsx': 'export default function App(){ return <canvas onKeyDown={move} />; }',
    };
    expect(noJourneyReason(game)).toBe(NO_DATA_ENTRY_REASON);
  });

  // 🔒 THE THEME IS NOT THE APP'S DATA — every app from our starter writes one.
  it('a landing page that only remembers the theme is not "an app that saves"', () => {
    const landing = {
      'src/main.tsx': "createRoot(document.getElementById('root')!).render(<App />);",
      'src/App.tsx': "export default function App(){ return <main><h1>Hello</h1></main>; }",
      'src/lib/theme.ts': "localStorage.setItem('theme', mode);",
    };
    expect(savedStateEvidence(landing)).toBeNull();
    expect(noJourneyReason(landing)).toBe(NO_DATA_ENTRY_REASON);
  });

  it('a font-scale or consent flag is not the app\'s data either', () => {
    for (const line of [
      "localStorage.setItem('nb-font-scale', String(scale));",
      "localStorage.setItem('cookie-consent', 'yes');",
      "localStorage.setItem('nbai-locale', lang);",
    ]) {
      expect(savedStateEvidence({ 'src/a.ts': line }), line).toBeNull();
    }
  });

  it('a database write counts as saving too', () => {
    const app = { 'src/App.tsx': "await supabase.from('scores').insert({ xp });" };
    expect(savedStateEvidence(app)?.what).toBe('a database write');
  });

  it('the honest sentence names where, and does not read as a defect', () => {
    const s = savedWithoutFormReason({ path: 'src/hooks/useProgress.ts', what: 'browser storage' });
    expect(s).toContain('src/hooks/useProgress.ts');
    expect(s).toContain('no form to fill in');
    expect(s).not.toMatch(/\bfail|broken|missing\b/i);
  });

  // BOTH BRANCHES — this module's own docblock says two of them reach that sentence, and only one was
  // fixed the first time a claim like this was wrong.
  it('both branches of noJourneyReason ask the same second question', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/journeyDerivation.ts'), 'utf8');
    const asks = src.match(/savedStateEvidence\(files \?\? \{\}\)/g) ?? [];
    expect(asks.length).toBeGreaterThanOrEqual(2);
  });

  it('the release gate repeats the derivation\'s sentence instead of its own paraphrase', () => {
    const gate = readFileSync(join(__dirname, '../src/server/AgentV3/releaseGate.ts'), 'utf8');
    expect(gate).not.toContain('this app has no data-entry flow, so there was no user journey');
    expect(gate).toContain('journeyNoneWhy');
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('gateEvidence.journeyNoneWhy = noJourneyReason(journeyFiles)');
  });
});
