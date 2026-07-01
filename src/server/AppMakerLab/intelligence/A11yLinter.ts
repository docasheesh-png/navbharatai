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

function hasAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\b${attr}\\s*=`, 'i').test(tag);
}

/** `<img>` tags with no `alt` attribute (WCAG 1.1.1). Returns [total, missing]. Pure. */
export function imagesMissingAlt(code: string): [number, number] {
  const tags = code.match(/<img\b[^>]*>/gi) || [];
  const missing = tags.filter((t) => !hasAttr(t, 'alt')).length;
  return [tags.length, missing];
}

/**
 * Form controls with no programmatic label (WCAG 1.3.1 / 4.1.2). Conservative: a control counts as
 * unlabelled only when it has NONE of aria-label / aria-labelledby / id / title (an `id` may be targeted
 * by a `<label for>`, so its presence suppresses the flag to avoid false positives). Skips hidden/button
 * inputs. Returns [total, unlabelled]. Pure.
 */
export function inputsMissingLabel(code: string): [number, number] {
  const tags = [
    ...(code.match(/<input\b[^>]*>/gi) || []),
    ...(code.match(/<textarea\b[^>]*>/gi) || []),
    ...(code.match(/<select\b[^>]*>/gi) || []),
  ];
  let total = 0;
  let missing = 0;
  for (const t of tags) {
    const typeMatch = /\btype\s*=\s*["']?([a-z]+)/i.exec(t);
    const type = typeMatch ? typeMatch[1].toLowerCase() : '';
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    total++;
    const labelled = hasAttr(t, 'aria-label') || hasAttr(t, 'aria-labelledby') || hasAttr(t, 'id') || hasAttr(t, 'title');
    if (!labelled) missing++;
  }
  return [total, missing];
}

/**
 * Interactive controls with no accessible name (WCAG 4.1.2 / 2.4.4): `<button>`/`<a>` whose stripped
 * inner text is empty AND that carry no aria-label/aria-labelledby/title (e.g. an icon-only button).
 * Returns [total, unnamed]. Pure.
 */
export function controlsMissingName(code: string): [number, number] {
  let total = 0;
  let unnamed = 0;
  const re = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const attrs = m[2];
    // A bare <a> with no href isn't an interactive control — skip anchors without href.
    if (m[1].toLowerCase() === 'a' && !hasAttr(attrs, 'href')) continue;
    total++;
    const named =
      textContent(m[3]).length > 0 ||
      hasAttr(attrs, 'aria-label') ||
      hasAttr(attrs, 'aria-labelledby') ||
      hasAttr(attrs, 'title');
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
  const src = typeof code === 'string' ? code : '';
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
