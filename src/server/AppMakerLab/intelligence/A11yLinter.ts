// P-TQA.11 (builder-side, dependency-free) — static WCAG accessibility linter for GENERATED apps.
//
// The roadmap's P-TQA.11 proposes axe-core-in-Playwright in CI; axe-core needs a real browser DOM and
// is a heavy new dependency. This is the dependency-free, builder-side companion: fast static checks on
// the generated HTML string that catch the most common, high-impact WCAG failures BEFORE the app ships,
// surfaced live in the AI Copilot next to the design-consistency score. (A full axe-core AA gate in CI
// remains the deeper, separate option.)
//
// Same "pure logic + thin adapter" split as DesignLinter: all detection is pure and unit-tested; the
// route + UI are thin. Checks are deliberately CONSERVATIVE (regex on the HTML string, not a parser) so
// a real issue is flagged but false positives are rare — a linter that cries wolf gets ignored.

import { scanMarkup, hasAttr, type ScannedTag } from '../../AgentV3/jsxTags';
import { stripCommentsForMarkup } from '../../AgentV3/stripCodeComments';

export type A11yViolationType = 'img-alt' | 'input-label' | 'control-name' | 'html-lang' | 'positive-tabindex';

export interface A11yViolation {
  type: A11yViolationType;
  severity: 'info' | 'warn';
  wcag: string; // the WCAG success criterion, e.g. "1.1.1"
  message: string;
  /** A ready-to-send instruction that tells the builder AI how to fix this (one-click "Fix with AI"). */
  fix: string;
  count: number;
}

/** The AI fix-prompt for each accessibility violation type. */
const A11Y_FIX: Record<A11yViolationType, string> = {
  'img-alt': 'Add descriptive alt text to every image in this app (use alt="" only for purely decorative images).',
  'input-label': 'Give every form field in this app a clear label — a <label> element, or an aria-label — so screen readers announce it.',
  'control-name': 'Give every button and link an accessible name — visible text or an aria-label — especially icon-only buttons.',
  'html-lang': 'Add a lang attribute to the <html> element of this app (e.g. lang="en" or lang="hi").',
  'positive-tabindex': 'Remove positive tabindex values in this app; use tabindex="0" and natural DOM order so keyboard focus order stays logical.',
};

export interface A11yLintResult {
  score: number; // 0–100
  grade: 'A' | 'B' | 'C' | 'D';
  violations: A11yViolation[];
  stats: { images: number; imagesNoAlt: number; controls: number; controlsNoName: number; inputs: number; inputsNoLabel: number };
}

/** Strip HTML tags from a fragment and collapse whitespace — used to test a control's accessible text. Pure. */
function textContent(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// The attribute reader is shared now (autopsy 8a92e5ed): `hasAttr` lives in `AgentV3/jsxTags.ts`
// beside the scanner, so the two accessibility analyzers cannot drift apart again.

/** `<img>` tags with no `alt` attribute (WCAG 1.1.1). Returns [total, missing]. Pure. */
export function imagesMissingAlt(code: string): [number, number] {
  const tags = scanMarkup(code).filter((t) => t.isElement && t.name === 'img');
  const missing = tags.filter((t) => !hasAttr(t.tag, 'alt')).length;
  return [tags.length, missing];
}

/**
 * Form controls with no programmatic label (WCAG 1.3.1 / 4.1.2). Conservative: a control counts as
 * unlabelled only when it has NONE of aria-label / aria-labelledby / id / title (an `id` may be targeted
 * by a `<label for>`, so its presence suppresses the flag to avoid false positives). Skips hidden/button
 * inputs. Returns [total, unlabelled]. Pure.
 */
export function inputsMissingLabel(code: string): [number, number] {
  let total = 0;
  let missing = 0;
  for (const t of scanMarkup(code)) {
    const verdict = controlLabelVerdict(t);
    if (verdict === 'not-a-control') continue;
    total++;
    if (verdict === 'unlabelled') missing++;
  }
  return [total, missing];
}

/**
 * The 1-based source lines of the fields `inputsMissingLabel` counts as unlabelled, in order, at most `max`.
 * A count alone sent a model through ten edits of buttons that were already labelled before it found the one
 * `<input>` (autopsy 981ce4cc); the line is what makes the note actionable. Same verdict, so the count and
 * the lines can never disagree. Pure.
 */
export function unlabelledFieldLines(code: string, max = 5): number[] {
  const out: number[] = [];
  for (const t of scanMarkup(typeof code === 'string' ? code : '')) {
    if (controlLabelVerdict(t) !== 'unlabelled') continue;
    out.push(t.line + 1);
    if (out.length >= max) break;
  }
  return out;
}

const LABELLABLE_CONTROLS = new Set(['input', 'textarea', 'select']);

/**
 * THE ONE ANSWER to "does this form control need a label it does not have?" — shared by the linter
 * above and the repair below, so the two can never disagree about which field is unlabelled.
 */
export function controlLabelVerdict(t: ScannedTag): 'not-a-control' | 'labelled' | 'unlabelled' {
  // A COMPONENT is not an HTML control (autopsy 8a92e5ed / c847b523). `<Select label="Category" />`
  // has a real, working label; judging it by the rules for HTML `<select>` is a false finding
  // against anybody using a design system, and we cannot know a component's contract.
  if (!t.isElement || !LABELLABLE_CONTROLS.has(t.name)) return 'not-a-control';
  const typeMatch = /\btype\s*=\s*["']?([a-z]+)/i.exec(t.tag);
  const type = typeMatch ? typeMatch[1].toLowerCase() : '';
  if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return 'not-a-control';
  const labelled =
    // A WRAPPING `<label>` names the control by its own text — the commonest React form shape
    // there is, and the reason a correct golden scaffold was reported as having three unlabelled
    // fields in autopsy 8a92e5ed.
    t.insideLabel ||
    hasAttr(t.tag, 'aria-label') || hasAttr(t.tag, 'aria-labelledby') ||
    hasAttr(t.tag, 'id') || hasAttr(t.tag, 'title');
  return labelled ? 'labelled' : 'unlabelled';
}

/**
 * REPAIR THE ONE SHAPE THAT NEEDS NO GUESS: an unlabelled field whose own placeholder says what it is.
 *
 * 🔴 WHY (autopsy 6bae5835, 2026-09-27). One `<input>` in a working app shipped without a label, found
 * only after the app had been proven green, when Green Freeze forbids a repair. A write-time note now
 * reaches every write tool; this is the last line of defence, and it is deterministic, costs no model
 * call, and adds nothing the author did not already write: `placeholder="Search tasks"` becomes
 * `aria-label="Search tasks" placeholder="Search tasks"` — the name a screen reader should announce.
 *
 * Only a LITERAL placeholder is used (`placeholder={t('x')}` is left alone — its text is not known here),
 * only an HTML element (never a component), and only a control this linter calls unlabelled. PURE.
 */
export function labelFieldsFromPlaceholder(code: string): { code: string; repaired: number } {
  const edits: Array<{ at: number; insert: string }> = [];
  for (const t of scanMarkup(code)) {
    if (controlLabelVerdict(t) !== 'unlabelled') continue;
    const ph = /\splaceholder\s*=\s*("([^"{}]+)"|'([^'{}]+)')/.exec(t.tag);
    if (!ph) continue;
    const text = (ph[2] ?? ph[3] ?? '').trim();
    if (!text) continue;
    const quote = ph[1][0];
    // Insert straight after the element name, so the rest of the tag is untouched byte for byte.
    const at = t.index + 1 + t.rawName.length;
    if (code.slice(t.index + 1, at) !== t.rawName) continue;
    edits.push({ at, insert: ` aria-label=${quote}${text}${quote}` });
  }
  if (!edits.length) return { code, repaired: 0 };
  let out = code;
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.insert + out.slice(e.at);
  return { code: out, repaired: edits.length };
}

/**
 * Interactive controls with no accessible name (WCAG 4.1.2 / 2.4.4): `<button>`/`<a>` whose stripped
 * inner text is empty AND that carry no aria-label/aria-labelledby/title (e.g. an icon-only button).
 * Returns [total, unnamed]. Pure.
 */
export function controlsMissingName(code: string): [number, number] {
  let total = 0;
  let unnamed = 0;
  for (const t of scanMarkup(code)) {
    if (!t.isElement || (t.name !== 'button' && t.name !== 'a')) continue;
    if (/\/\s*>$/.test(t.tag)) continue;  // self-closing: there is no inner text to judge
    // A bare <a> with no href isn't an interactive control — skip anchors without href.
    if (t.name === 'a' && !hasAttr(t.tag, 'href')) continue;
    // The control's own text: from the end of its opening tag to its matching closer. Read from the
    // source rather than from a paired regex, whose `[^>]*` for the attributes ended at the first
    // `>` — which in JSX belongs to an arrow function, not to the tag.
    // `t.index` — never `indexOf(t.tag)`: three plain `<button>` tags share one text, so a search
    // returns the FIRST one every time and every later button is judged by the first one's content.
    const after = code.slice(t.index + t.tag.length);
    const close = after.search(new RegExp(`</\\s*${t.name}\\s*>`, 'i'));
    const inner = close < 0 ? after : after.slice(0, close);
    total++;
    const named =
      textContent(inner).length > 0 ||
      hasAttr(t.tag, 'aria-label') ||
      hasAttr(t.tag, 'aria-labelledby') ||
      hasAttr(t.tag, 'title');
    if (!named) unnamed++;
  }
  return [total, unnamed];
}

/** True when there's an `<html>` element but it declares no `lang` (WCAG 3.1.1). Pure. */
export function htmlMissingLang(code: string): boolean {
  const m = /<html\b[^>]*>/i.exec(code);
  if (!m) return false; // a fragment, not a full document — not applicable
  return !hasAttr(m[0], 'lang');
}

/** Count of positive `tabindex` values, an anti-pattern that breaks focus order (WCAG 2.4.3). Pure. */
export function positiveTabindexCount(code: string): number {
  const matches = code.match(/tabindex\s*=\s*["']?([1-9][0-9]*)/gi) || [];
  return matches.length;
}

function scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

/**
 * Lint generated code for common WCAG failures. Deterministic. Empty/tiny code → an honest 100.
 * Scoring weights the highest-impact issues (missing alt, unlabelled controls) most.
 */
export function lintA11y(code: string): A11yLintResult {
  // Comments never reach a screen reader, so no rule here may read one (autopsy 4541f1cf: a comment
  // mentioning `<html>` was reported as a document with no `lang`, in every golden scaffold).
  const src = stripCommentsForMarkup(typeof code === 'string' ? code : '');
  const [images, imagesNoAlt] = imagesMissingAlt(src);
  const [inputs, inputsNoLabel] = inputsMissingLabel(src);
  const [controls, controlsNoName] = controlsMissingName(src);
  const noLang = htmlMissingLang(src);
  const posTab = positiveTabindexCount(src);

  const violations: A11yViolation[] = [];
  let penalty = 0;

  if (imagesNoAlt > 0) {
    penalty += Math.min(30, imagesNoAlt * 6);
    violations.push({ type: 'img-alt', severity: 'warn', wcag: '1.1.1', count: imagesNoAlt, message: `${imagesNoAlt} image(s) missing alt text — add \`alt\` (use \`alt=""\` for decorative images).`, fix: A11Y_FIX['img-alt'] });
  }
  if (inputsNoLabel > 0) {
    penalty += Math.min(30, inputsNoLabel * 8);
    violations.push({ type: 'input-label', severity: 'warn', wcag: '1.3.1', count: inputsNoLabel, message: `${inputsNoLabel} form field(s) with no label — add a \`<label>\`, \`aria-label\`, or \`id\`.`, fix: A11Y_FIX['input-label'] });
  }
  if (controlsNoName > 0) {
    penalty += Math.min(25, controlsNoName * 8);
    violations.push({ type: 'control-name', severity: 'warn', wcag: '4.1.2', count: controlsNoName, message: `${controlsNoName} button/link with no accessible name — add text or an \`aria-label\` (e.g. icon-only buttons).`, fix: A11Y_FIX['control-name'] });
  }
  if (noLang) {
    penalty += 10;
    violations.push({ type: 'html-lang', severity: 'warn', wcag: '3.1.1', count: 1, message: 'The `<html>` element has no `lang` — add e.g. `lang="en"` (or `hi`) for screen readers.', fix: A11Y_FIX['html-lang'] });
  }
  if (posTab > 0) {
    penalty += Math.min(10, posTab * 3);
    violations.push({ type: 'positive-tabindex', severity: 'info', wcag: '2.4.3', count: posTab, message: `${posTab} positive tabindex value(s) — prefer \`tabindex="0"\`/DOM order so focus order stays logical.`, fix: A11Y_FIX['positive-tabindex'] });
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return {
    score,
    grade: scoreToGrade(score),
    violations,
    stats: { images, imagesNoAlt, controls, controlsNoName, inputs, inputsNoLabel },
  };
}
