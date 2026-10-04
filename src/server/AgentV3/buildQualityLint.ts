// BUILD-END DESIGN CONSISTENCY + ACCESSIBILITY — two finished linters that nothing was calling.
//
// `DesignLinter` and `A11yLinter` are pure, deterministic and unit-tested, and have existed for months
// behind `POST /api/design/lint` and `POST /api/design/a11y`. Nothing in the app has ever called either
// route, so on a real build neither has ever run. This module is the missing call.
//
// WHY THEY ARE NOT REDUNDANT WITH THE DESIGN GATE, which is the first thing to check before wiring
// anything (they sound like the same feature and are not):
//   • DesignCoverage asks "is this PAGE designed at all?" — bare markup, no heading, a raw table.
//     It catches the fifth screen degrading into <div>s.
//   • DesignLinter asks "is the design CONSISTENT?" — 20 one-off colours, 5 font families, spacing off
//     the 4px grid, hex codes instead of tokens. A page can be fully styled and still fail this.
//   • A11yLinter asks a question NOTHING in the stack asks today: missing alt text, unlabelled form
//     fields, icon-only buttons with no accessible name, a positive tabindex. tsc, ESLint, the CSS
//     consistency check and the reviewer are all blind to every one of those.
//
// DELIBERATELY NOT FLAG-GATED. A flag is the "never break the app" insurance for a behaviour that
// touches real users; this is deterministic, spends nothing, calls no model, and only ever appends
// advisory findings to a build that has already succeeded. Adding a dial for it would grow the flag
// surface the admin has objected to, in exchange for the ability to turn off a check that cannot
// affect an app. The call site wraps it the same way its neighbours are wrapped, so a throw here can
// never reach the build.

import {
  lintDesign, designSummary, TOKEN_MODULE_PATH, extractSpacingPx, offGridSpacing, MAX_OFFGRID, SPACING_GRID, type DesignLintResult,
} from '../AppMakerLab/intelligence/DesignLinter';
import { lintA11y, type A11yLintResult } from '../AppMakerLab/intelligence/A11yLinter';
import { stripCommentsForMarkup } from './stripCodeComments';

/** Source files worth linting. Everything else is noise the linters would only mis-read. */
const LINTABLE = /\.(tsx?|jsx?|css|scss|html)$/i;

/**
 * Paths that are not the user's design.
 *
 * A vendored bundle or a minified stylesheet contains thousands of hex colours that belong to somebody
 * else, and feeding one in would report a catastrophic "consistency" score for an app whose own code is
 * perfectly clean — the fastest way to make a linter that everyone learns to ignore.
 */
const NOT_APP_DESIGN = /(^|\/)(node_modules|dist|build|coverage|\.next|out)\//i;
const GENERATED = /(\.min\.(css|js)|\.bundle\.js|-lock\.json)$/i;

/**
 * The same three predicates, for `spacingSnap.ts`. ONE definition on purpose: the snap rewrites exactly
 * the values the `DESIGN_CONSISTENCY` finding counts, and a private copy of the
 * file selection there is the drifted-copy class this repo has already paid for four times.
 */
export { LINTABLE as LINTABLE_DESIGN_FILE, NOT_APP_DESIGN as NOT_APP_DESIGN_FILE, GENERATED as GENERATED_FILE };

/**
 * Total characters fed to the linters.
 *
 * They are regex scanners over one string, so cost grows with input and a 60-file app could hand them
 * megabytes. The cap keeps a build-end advisory from becoming a measurable pause. It is generous enough
 * that a normal app is linted whole, and `truncated` reports honestly when it was not.
 */
export const MAX_LINT_CHARS = 400_000;

/** One file's own count of a single violation type. */
export interface FileOffence {
  path: string;
  /**
   * That FILE's own count when the linter is run over it alone.
   *
   * ⚠️ For a DISTINCTNESS rule ("58 distinct colours", "3 font families") these counts deliberately do
   * NOT sum to the app-wide total — two files can each use the same one-off colour. The word used in
   * the report is "worst", which is true of every rule; nothing claims a share of the total.
   */
  count: number;
}

/** How many files each violation names. Three is enough to start; a longer list is a wall of text. */
export const OFFENDERS_PER_TYPE = 3;

export interface BuildQualityLint {
  design: DesignLintResult;
  a11y: A11yLintResult;
  /** How many files actually contributed — 0 means nothing was lintable and the scores mean nothing. */
  fileCount: number;
  /** True when the cap above cut the input short, so the caller can say so rather than imply full coverage. */
  truncated: boolean;
  /**
   * Violation `type` → the files carrying the most of it, worst first.
   *
   * 🔴 WHY THIS EXISTS (autopsy e706e068, the School ERP). That build's report said *"Accessibility
   * 45/100 (D) … 14 form field(s) with no label … 7 button/link with no accessible name"* and
   * *"Design consistency 50/100 (D) … 58 distinct colours"* — across a 31-file app, naming **no file
   * and no line**. Neither the user nor any repair pass could act on a single one of them, so both
   * findings shipped as permanent unresolved warnings.
   *
   * The same report carried `DESIGN_PAGE_INCONSISTENT`, which DOES name its files (*"worst:
   * src/pages/Attendance.tsx"*) — two quality linters in one document, one actionable and one not.
   * The reason is structural, not an oversight: `lintBuiltApp` JOINS every file into one string before
   * linting, so by the time a violation exists the file it came from has already been thrown away.
   *
   * 🔒 THE SCORE IS UNCHANGED. Attribution is a SECOND pass over the SAME selected files, in the same
   * loop, so the headline number still comes from the joined text exactly as before and the two can
   * never disagree about which files were judged. Cost is one more regex scan over the same
   * characters, on a build that has already succeeded.
   */
  offenders: Record<string, FileOffence[]>;
}

/**
 * Lint a built app's own source. Pure apart from the linters it calls, and total on its inputs — a
 * malformed file set yields empty results rather than throwing, because this runs on a build that has
 * already succeeded and must never be the reason one is reported as failed.
 */
export function lintBuiltApp(files: Record<string, string>): BuildQualityLint | null {
  const parts: string[] = [];
  let total = 0;
  let truncated = false;
  let fileCount = 0;

  const selected: Array<[string, string]> = [];

  for (const [path, content] of Object.entries(files || {})) {
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!LINTABLE.test(path) || NOT_APP_DESIGN.test(path) || GENERATED.test(path)) continue;
    if (total + content.length > MAX_LINT_CHARS) { truncated = true; continue; }
    // What a comment says is not what the app shows — neither linter may count it (autopsy 4541f1cf:
    // a CSS comment naming `<img>` cost every app 8 accessibility points). Length-preserving.
    const shipped = stripCommentsForMarkup(content);
    parts.push(shipped);
    selected.push([path, shipped]);
    total += content.length;
    fileCount++;
  }

  // Nothing to judge. Returning null rather than a perfect score is the honest answer: a 100 here would
  // read as "this app is flawless" when it means "we looked at nothing".
  if (fileCount === 0) return null;

  const joined = parts.join('\n');
  const tokenModuleCode = selected.filter(([p]) => TOKEN_MODULE_PATH.test(p)).map(([, c]) => c).join('\n');
  return {
    design: lintDesign(joined, { tokenModuleCode }),
    a11y: lintA11y(joined),
    fileCount,
    truncated,
    offenders: attributeOffenders(selected),
  };
}

/**
 * Which FILES carry each violation type — the linters re-run over one file at a time.
 *
 * Only files that genuinely contributed to the score are attributed (the same `selected` list the
 * join was built from), so a file skipped by the size cap is never named for a violation it was not
 * measured for. Total on its inputs: a linter that throws on one file costs that file's attribution,
 * never the whole result.
 */
function attributeOffenders(selected: ReadonlyArray<readonly [string, string]>): Record<string, FileOffence[]> {
  const byType = new Map<string, FileOffence[]>();
  for (const [path, content] of selected) {
    let found: Array<{ type: string; count: number }> = [];
    try {
      found = [...lintDesign(content, { tokenModuleCode: TOKEN_MODULE_PATH.test(path) ? content : '' }).violations, ...lintA11y(content).violations]
        .map((v) => ({ type: v.type, count: v.count }));
    } catch { continue; }
    for (const { type, count } of found) {
      if (!(count > 0)) continue;
      const list = byType.get(type) ?? [];
      list.push({ path, count });
      byType.set(type, list);
    }
  }
  const out: Record<string, FileOffence[]> = {};
  for (const [type, list] of byType) {
    // Worst first; ties broken by path so the same app always produces the same sentence.
    list.sort((a, b) => (b.count - a.count) || a.path.localeCompare(b.path));
    out[type] = list.slice(0, OFFENDERS_PER_TYPE);
  }
  return out;
}

/** " Worst: a.tsx (4), b.tsx (2)." for one violation type, or '' when nothing could be attributed. */
export function offenderNote(r: BuildQualityLint, type: string): string {
  const files = r.offenders?.[type];
  if (!files || files.length === 0) return '';
  return ` Worst: ${files.map((o) => `${o.path} (${o.count})`).join(', ')}.`;
}

/** One line for the build report — the score plus the count, never a bare grade with no evidence. */
export function designLintSummary(r: BuildQualityLint): string {
  const v = r.design.violations.length;
  return `Design consistency ${r.design.score}/100 (${r.design.grade}) across ${r.fileCount} file(s)${r.truncated ? ', partially scanned' : ''}. ${designSummary(r.design)}${v ? ` ${r.design.violations.map((x) => `${x.message}${offenderNote(r, x.type)}`).join(' ')}` : ''}`.trim();
}

/** One line for the build report, listing the real WCAG criteria rather than a score alone. */
export function a11yLintSummary(r: BuildQualityLint): string {
  const v = r.a11y.violations;
  if (v.length === 0) return `Accessibility ${r.a11y.score}/100 (${r.a11y.grade}) — no common WCAG failures found across ${r.fileCount} file(s).`;
  return `Accessibility ${r.a11y.score}/100 (${r.a11y.grade}) across ${r.fileCount} file(s)${r.truncated ? ', partially scanned' : ''}. ${v.map((x) => `WCAG ${x.wcag}: ${x.message}${offenderNote(r, x.type)}`).join(' ')}`;
}

/**
 * The accessibility failures to hand to a repair pass that is ALREADY running on the app's pages — or
 * '' when there are none (autopsy SignBridge, 2026-09-26). That build ran a paid design repair over its
 * pages and shipped an unlabelled field and an unnamed icon button in the same pages, because nothing
 * told the repair about them: the accessibility linter only ever wrote its verdict into the report.
 *
 * It never STARTS a pass (two labels are not worth a model call on their own); it only makes the pass
 * that is already paid for fix what a screen-reader user would meet. Each line is the linter's own
 * ready-to-send `fix`, plus the files it attributed. PURE.
 */
export function a11yRepairAddendum(r: BuildQualityLint | null | undefined): string {
  const v = r?.a11y?.violations ?? [];
  if (!r || v.length === 0) return '';
  const lines = v.map((x) => `- WCAG ${x.wcag}: ${x.fix}${offenderNote(r, x.type)}`);
  return `\n\nWhile you are in these pages, also fix these accessibility failures (a screen-reader user cannot use the app with them):\n${lines.join('\n')}`;
}

/** The accessibility findings the end-of-turn hand-back gives the builder, and their plain wording. */
const HAND_BACK_A11Y: Record<string, string> = {
  'control-name': 'button/link with no accessible name (add visible text or an aria-label)',
  'input-label': 'form field with no label (a <label htmlFor> or an aria-label)',
  'img-alt': 'image with no alt text',
};

/**
 * The files to hand back for accessibility, worst first, from a lint result already computed. These are
 * the defects only the builder can fix well — a name for an icon button has to MEAN something, so it is
 * never guessed by a deterministic pass. PURE.
 */
export function a11yHandBack(r: BuildQualityLint | null | undefined, max = 6): Array<{ file: string; issues: string[] }> {
  if (!r) return [];
  const byFile = new Map<string, string[]>();
  for (const [type, text] of Object.entries(HAND_BACK_A11Y)) {
    for (const o of r.offenders?.[type] ?? []) {
      const list = byFile.get(o.path) ?? [];
      list.push(`${o.count} ${text}`);
      byFile.set(o.path, list);
    }
  }
  return [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, max).map(([file, issues]) => ({ file, issues }));
}

/**
 * 🔴 `offGridHandBack` LIVED HERE AND IS GONE (autopsy 536c8189, 2026-10-01). It collected the
 * `DESIGN_CONSISTENCY` spacing values so the end-of-turn hand-back could ask the MODEL to snap them.
 * The first real build to meet that hand-back spent three model calls writing `node -e` regex scripts
 * over a 634-line stylesheet and moved ON-grid values OFF the grid. `round(v / 4) * 4` has exactly one
 * right answer, so `spacingSnap.ts` does it by construction and this function had no caller left.
 *
 * Deleted rather than kept "for the report": the snap's own note says what moved, and the finding says
 * what is left. A collector nothing calls is the dead code the admin has twice asked to be removed.
 */

