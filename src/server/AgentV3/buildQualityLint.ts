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

export interface BuildQualityLint {
  design: DesignLintResult;
  a11y: A11yLintResult;
  /** How many files actually contributed — 0 means nothing was lintable and the scores mean nothing. */
  fileCount: number;
  /** True when the cap above cut the input short, so the caller can say so rather than imply full coverage. */
  truncated: boolean;
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

  for (const [path, content] of Object.entries(files || {})) {
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (!LINTABLE.test(path) || NOT_APP_DESIGN.test(path) || GENERATED.test(path)) continue;
    if (total + content.length > MAX_LINT_CHARS) { truncated = true; continue; }
    parts.push(content);
    total += content.length;
    fileCount++;
  }

  // Nothing to judge. Returning null rather than a perfect score is the honest answer: a 100 here would
  // read as "this app is flawless" when it means "we looked at nothing".
  if (fileCount === 0) return null;

  const joined = parts.join('\n');
  return { design: lintDesign(joined), a11y: lintA11y(joined), fileCount, truncated };
}

/** One line for the build report — the score plus the count, never a bare grade with no evidence. */
export function designLintSummary(r: BuildQualityLint): string {
  const v = r.design.violations.length;
  return `Design consistency ${r.design.score}/100 (${r.design.grade}) across ${r.fileCount} file(s)${r.truncated ? ', partially scanned' : ''}. ${designSummary(r.design)}${v ? ` ${r.design.violations.map((x) => x.message).join(' ')}` : ''}`.trim();
}

/** One line for the build report, listing the real WCAG criteria rather than a score alone. */
export function a11yLintSummary(r: BuildQualityLint): string {
  const v = r.a11y.violations;
  if (v.length === 0) return `Accessibility ${r.a11y.score}/100 (${r.a11y.grade}) — no common WCAG failures found across ${r.fileCount} file(s).`;
  return `Accessibility ${r.a11y.score}/100 (${r.a11y.grade}) across ${r.fileCount} file(s)${r.truncated ? ', partially scanned' : ''}. ${v.map((x) => `WCAG ${x.wcag}: ${x.message}`).join(' ')}`;
}
