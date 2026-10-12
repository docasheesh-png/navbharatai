// THE CONTRACT WAS WRITTEN, BUT NOBODY TOLD THE MODEL UNTIL IT WAS TOO LATE (autopsy 31dc61fd).
//
// 🔴 THE FINDING, AND IT IS NOT "THE PROMPT FORGOT TO SAY IT". Report `31dc61fd` shipped an app with
// `ACCESSIBILITY 92/100 — 1 form field with no label` and `DESIGN_CONSISTENCY 80/100 — 38 spacing
// values off the 4px grid`. The obvious fix is to add those rules to the architect prompt. **They
// were already there**, and have been:
//
//     systemPrompt.ts:504  "consistent 4/8/12/16/24px spacing"
//     systemPrompt.ts:518  every <input>/<textarea> needs a real `name` and either a visible
//                          `<label htmlFor=…>` or an `aria-label`
//
// So writing the rule a second time, louder, is the treadmill the fifth absolute rule warns about.
// The prompt is read ONCE, before any code exists, and by the twentieth file it is thousands of
// tokens behind. What was missing was never the rule — it was the rule arriving at the moment the
// model is actually holding the file.
//
// 🔑 THIS IS THE THIRD INSTANCE OF A PATTERN THIS REPO ALREADY TRUSTS, and it is deliberately shaped
// like the other two: `writeTimeImportCheck` ("a generated TEST importing a member its component does
// not export … Detection and a deterministic fixer both already existed but ran at the END, by which
// time the agent's intent was elsewhere") and `writeTimeTypecheck` (autopsy e706e068: 20 files
// written before the first `tsc`, then 21 errors ground for seven minutes — every one of them
// visible the moment its file was written). Same defect, same cure: say it NOW.
//
// 🔒 WHY THIS IS THE SAFE HALF OF "PREVENT, DON'T HEAL". The alternative — auto-repairing the app
// afterwards — means EDITING AN APP THAT HAS ALREADY BEEN PROVEN GREEN, which is exactly what Green
// Freeze exists to forbid and what `verifyAfterFix` and `designHealGuard` exist to survive. This
// costs no model call, runs no shell, touches no file, and cannot fail a build: it appends a
// sentence to a tool result the model is reading anyway, while the app is still being written.
//
// 🔒 IT REUSES THE LINTERS RATHER THAN RE-IMPLEMENTING THEM. `lintBuiltApp` already owns which files
// are lintable (`LINTABLE` / `NOT_APP_DESIGN` / `GENERATED`) and already runs `lintDesign` /
// `lintA11y` over ONE file at a time inside `attributeOffenders` — so a single-file call is a proven
// path, not a new one. A second copy of the selection rule is precisely the drift this repo has paid
// for repeatedly.

import { lintBuiltApp, designLintSummary, type BuildQualityLint } from './buildQualityLint';
import { unlabelledFieldLines } from '../AppMakerLab/intelligence/A11yLinter';
import { spacingSnapEnabled } from './spacingSnap';

/**
 * A test file's JSX is a FIXTURE, not a screen — the one place this check must stay quiet.
 *
 * ⚠️ This is the only selection rule this module owns, and it is deliberate rather than an oversight
 * in `lintBuiltApp` (which lints test files too, correctly: they are part of the app's source). The
 * difference is what the note DOES. Telling a model "this input has no label, fix it now" about a
 * fixture invites it to edit the very markup the test's assertions are written against — a cosmetic
 * nag that can break a passing test. The end-of-build lint only REPORTS; this one steers.
 */
const TEST_FILE = /(^|\/)__(tests?|mocks?)__\/|\.(test|spec)\.[jt]sx?$/i;

/**
 * The violation types worth telling a model about for ONE file, named rather than inferred.
 *
 * ⚠️ THE EXCLUSIONS ARE THE PRECISION, and they are all the same mistake: a WHOLE-APP judgement read
 * as a per-file one. `color-count` and `font-count` count distinct colours and fonts ACROSS the app
 * against a budget ("≤ 12"); a single file legitimately carries a handful, so they would fire on
 * nearly every write and become noise the model learns to skip — which would cost the notes below
 * their credibility too. `hardcoded-colors` is the same argument: a generated app is not on our token
 * system, so its literals are not a defect of the file being written.
 *
 * What remains is the set a model can act on with the file open in front of it: a missing label, a
 * missing alt, an unnamed control, a page with no `lang`, and a positive tabindex. (Off-grid spacing
 * was here too; it moved to `PLATFORM_FIXED_VIOLATIONS` below.)
 */
export const PER_FILE_VIOLATIONS: ReadonlySet<string> = new Set([
  'input-label',
  'img-alt',
  'control-name',
  'html-lang',
  'positive-tabindex',
  // A clickable <div>/<span> (autopsy c70bcbb4): added to the linter after this list was written, so the
  // end-of-build check flagged PlayerBar and NowPlayingScreen while neither ever got a note.
  'click-noninteractive',
]);

/**
 * The violation types that are judgements about the WHOLE app, never about one file (see above). Every type
 * a linter emits is in exactly one of the three sets — a census test fails on a new type in none, which
 * is how `click-noninteractive` was missed for five days.
 */
export const WHOLE_APP_VIOLATIONS: ReadonlySet<string> = new Set([
  'color-count',
  'font-count',
  'hardcoded-colors',
]);

/**
 * The violation types the PLATFORM fixes deterministically, each with the switch of its fixer. While the
 * fixer is on, no model is told about the type — at the write (`qualityNote`) or in `evaluate`
 * (`modelDesignLine`). With the fixer switched off, the type is a per-file note again.
 *
 * 🔴 WHY (autopsy 9c612cdb, 2026-10-12). `spacingSnap.ts` has done `round(v / 4) * 4` by construction
 * since 536c8189, and Q-290 took spacing out of the END-OF-TURN hand-back for that reason. The WRITE-TIME
 * door kept it: that build's model was told "7 spacing values are off the 4px grid — snap to multiples of
 * 4px … fix it now", arithmetic with one right answer that the snap then did for free at the end. Obeying
 * would have cost an edit turn on a reasoning engine and risked the 536c8189 hazard (a regex rewrite that
 * moved on-grid values off the grid). `evaluate` was a third door handing over the same sentence.
 */
export const PLATFORM_FIXED_VIOLATIONS: ReadonlyMap<string, { fixerOn: (env: NodeJS.ProcessEnv) => boolean; told: (count: number) => string }> = new Map([
  ['off-grid-spacing', {
    fixerOn: spacingSnapEnabled,
    told: (count: number) => `${count} off-grid spacing value(s): the platform snaps these to the grid when the build ends — leave them as they are.`,
  }],
]);

/** Is this violation type the platform's to fix right now (its fixer is on)? PURE. */
export function platformFixesNow(type: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const fixer = PLATFORM_FIXED_VIOLATIONS.get(type);
  return fixer !== undefined && fixer.fixerOn(env) === true;
}

/** Does a write-time note carry this violation type right now? PURE. */
export function noteCarries(type: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (PER_FILE_VIOLATIONS.has(type)) return true;
  return PLATFORM_FIXED_VIOLATIONS.has(type) && !platformFixesNow(type, env);
}

/** Kill switch. `off` restores the pre-2026-09-20 behaviour exactly: no note, ever. */
export function writeQualityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_WRITE_QUALITY ?? '').trim().toLowerCase() !== 'off';
}

/** At most this many violation lines in one note — a wall of text is ignored, which helps nobody. */
export const MAX_NOTE_LINES = 3;

/**
 * The violations a write-time note would carry for ONE file, a11y first — `[]` for anything unlintable.
 * Ignores the note's kill switch on purpose: the end-of-build measurement asks whether a file is STILL in
 * the state a note describes, whether or not notes were being sent. PURE; never throws.
 */
function noteViolations(path: string, content: string, env: NodeJS.ProcessEnv): Array<{ type: string; message: string; count: number }> {
  if (typeof path !== 'string' || typeof content !== 'string' || !content.trim()) return [];
  if (TEST_FILE.test(path)) return [];
  let lint: ReturnType<typeof lintBuiltApp>;
  try {
    // One file in, one file judged — and `lintBuiltApp` returning null IS the "not a file we lint"
    // answer, so the selection rule is never restated here.
    lint = lintBuiltApp({ [path]: content });
  } catch {
    return [];
  }
  if (!lint) return [];
  try {
    return [...lint.a11y.violations, ...lint.design.violations]
      .filter((v) => !!v && noteCarries(v.type, env) && v.count > 0);
  } catch {
    return [];
  }
}

/**
 * Of these candidate files, the ones a write-time note would still flag as they are now — the
 * "still flagged" side of `writeQualitySummary`. PURE.
 *
 * 🔴 WHY NOT "every file the end-of-build lint names" (autopsy 9c612cdb). That list carries whole-app rules
 * (a colour budget) and, since the same autopsy, every file that adds even one off-grid value — none of
 * which a write-time note ever carries. Counting them would report "never got a note" for files the note
 * was never meant to reach, which reads as a hole in the write-time check. The question the line answers
 * is whether a NOTE was ignored, so it is asked in the note's own terms.
 */
export function filesANoteStillFlags(
  files: Record<string, string>,
  candidates: Iterable<string>,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  for (const path of new Set(candidates ?? [])) {
    const content = files?.[path];
    if (typeof content === 'string' && noteViolations(path, content, env).length > 0) out.push(path);
  }
  return out;
}

/**
 * The design-consistency line the `evaluate` tool hands the model — the SAME lint as the build report
 * (`lintBuiltApp`: one file selection, one comment rule, our own markup excluded), minus any type the
 * platform is about to fix. Before autopsy 9c612cdb `evaluate` ran its own `lintDesign` over a hand-joined
 * string: another file selection, comments counted, our badge counted — and it told the model to "snap to
 * multiples of 4px", which the snap does itself. PURE.
 */
export function modelDesignLine(lint: BuildQualityLint | null, env: NodeJS.ProcessEnv = process.env): string {
  if (!lint) return 'Design consistency: nothing lintable was found.';
  const handled = lint.design.violations.filter((v) => platformFixesNow(v.type, env));
  if (handled.length === 0) return designLintSummary(lint);
  const shown = { ...lint, design: { ...lint.design, violations: lint.design.violations.filter((v) => !platformFixesNow(v.type, env)) } };
  const told = handled.map((v) => `  ✓ ${PLATFORM_FIXED_VIOLATIONS.get(v.type)?.told(v.count) ?? ''}`);
  return [designLintSummary(shown), ...told].join('\n');
}

/**
 * What the linters say about the ONE file just written, as a sentence for the model — or `''`.
 *
 * PURE: no I/O, no shell, no model call. Total on its inputs — anything unlintable, unparseable or
 * unexpected yields `''`, because a note is an aid and must never become the reason a write reports
 * a problem.
 */
export function qualityNote(
  path: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!writeQualityEnabled(env)) return '';
  const lines: string[] = [];
  try {
    for (const v of noteViolations(path, content, env)) {
      // Where, not only how many (autopsy 981ce4cc): the line numbers of the unlabelled fields.
      const at = v.type === 'input-label' ? unlabelledFieldLines(content) : [];
      lines.push(`  • ${v.message}${at.length ? ` Unlabelled field at line ${at.join(', ')}.` : ''}`);
      if (lines.length >= MAX_NOTE_LINES) break;
    }
  } catch {
    return '';
  }
  if (!lines.length) return '';

  // A11y first, then design — a screen reader failing is a harder defect than spacing, and the model
  // reads top-down. The wording says WHY it is arriving now, so it reads as a checklist item rather
  // than a complaint about work just done.
  return [
    '',
    `Quality check on ${path} (fix it now, while you have the file open):`,
    ...lines,
  ].join('\n');
}
