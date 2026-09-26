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

import { lintDesign, designSummary, type DesignLintResult } from '../AppMakerLab/intelligence/DesignLinter';
import { lintA11y, type A11yLintResult } from '../AppMakerLab/intelligence/A11yLinter';

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
    parts.push(content);
    selected.push([path, content]);
    total += content.length;
    fileCount++;
  }

  // Nothing to judge. Returning null rather than a perfect score is the honest answer: a 100 here would
  // read as "this app is flawless" when it means "we looked at nothing".
  if (fileCount === 0) return null;

  const joined = parts.join('\n');
  return {
    design: lintDesign(joined),
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
      found = [...lintDesign(content).violations, ...lintA11y(content).violations]
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
