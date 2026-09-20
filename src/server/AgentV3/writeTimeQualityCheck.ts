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

import { lintBuiltApp } from './buildQualityLint';

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
 * missing alt, an unnamed control, a page with no `lang`, a positive tabindex, and spacing that is
 * off the grid the prompt already asked for.
 */
export const PER_FILE_VIOLATIONS: ReadonlySet<string> = new Set([
  'input-label',
  'img-alt',
  'control-name',
  'html-lang',
  'positive-tabindex',
  'off-grid-spacing',
]);

/** Kill switch. `off` restores the pre-2026-09-20 behaviour exactly: no note, ever. */
export function writeQualityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_WRITE_QUALITY ?? '').trim().toLowerCase() !== 'off';
}

/** At most this many violation lines in one note — a wall of text is ignored, which helps nobody. */
export const MAX_NOTE_LINES = 3;

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
  if (typeof path !== 'string' || typeof content !== 'string' || !content.trim()) return '';
  if (TEST_FILE.test(path)) return '';
  let lint: ReturnType<typeof lintBuiltApp>;
  try {
    // One file in, one file judged — and `lintBuiltApp` returning null IS the "not a file we lint"
    // answer, so the selection rule is never restated here.
    lint = lintBuiltApp({ [path]: content });
  } catch {
    return '';
  }
  if (!lint) return '';

  const lines: string[] = [];
  try {
    for (const v of [...lint.a11y.violations, ...lint.design.violations]) {
      if (!v || !PER_FILE_VIOLATIONS.has(v.type) || !(v.count > 0)) continue;
      lines.push(`  • ${v.message}`);
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
