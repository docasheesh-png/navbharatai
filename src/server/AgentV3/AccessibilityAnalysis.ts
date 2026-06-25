// AgentV3 — Accessibility (a11y) analysis (additive seventh evaluate dimension).
//
// Layer 78 ("Sabke-Liye" / Inclusion). Real static scanning over the actual
// front-end markup the agent writes, for concrete WCAG-class defects that lock
// real users out: images with no alt text, form controls with no accessible
// name, click handlers on non-interactive elements (keyboard/screen-reader
// users can't reach them), positive tabindex traps, and pages with no document
// language. Findings are computed deterministically from real content so the
// `evaluate` tool can report concrete, fixable accessibility issues — never a
// synthetic "looks accessible". Rules are intentionally conservative (single-
// line, tag-local) so the precision is high and the agent isn't sent chasing
// false positives.

export type AccessibilitySeverity = 'high' | 'medium' | 'low';

export interface AccessibilityIssue {
  file: string;
  line: number;
  kind: string;
  severity: AccessibilitySeverity;
  snippet: string;
}

/** Only front-end markup files carry a11y semantics. */
const FRONTEND_EXT = /\.(tsx|jsx|vue|svelte|html?|astro)$/i;

/** Paths we never scan — generated, vendored, or test code. */
const SKIP_PATH = /(^|[\\/])(node_modules|dist|build|coverage|vendor|\.next|\.git)([\\/]|$)|\.test\.|\.spec\.|__tests__|(^|[\\/])tests?([\\/]|$)/i;

const SNIPPET_MAX = 120;

/** Does a tag's attribute text contain a given boolean/any-value attribute? */
function hasAttr(tag: string, attr: string): boolean {
  // matches `attr=`, `attr =`, or a bare boolean `attr` followed by space/>/end.
  return new RegExp(`\\b${attr}\\s*=`, 'i').test(tag) || new RegExp(`\\b${attr}(\\s|>|/|$)`, 'i').test(tag);
}

/** The element name of an opening tag like `<input ...>` → "input" (lowercased). */
function tagName(tag: string): string {
  const m = /^<\s*([a-zA-Z][\w-]*)/.exec(tag);
  return m ? m[1].toLowerCase() : '';
}

/** Form controls that need an accessible name. */
const LABELLED_CONTROLS = new Set(['input', 'select', 'textarea']);
/** Input types that do not need a text label. */
const NO_LABEL_INPUT_TYPES = /\btype\s*=\s*['"{]?\s*(hidden|submit|button|reset|image)\b/i;
/** Non-interactive elements that should not be the sole click target. */
const NONINTERACTIVE = new Set(['div', 'span', 'li', 'td', 'tr', 'section', 'article', 'header', 'footer', 'main', 'nav', 'p']);

/**
 * Scan one file's content for accessibility issues. Returns [] for non-markup
 * files or clean files. Each opening tag is examined in isolation on its own
 * line (conservative — multi-line tags are skipped rather than guessed at).
 */
export function scanAccessibility(file: string, content: string): AccessibilityIssue[] {
  if (!FRONTEND_EXT.test(file) || SKIP_PATH.test(file)) return [];
  const issues: AccessibilityIssue[] = [];
  const lines = content.split('\n');
  // Match each self-contained opening/void tag on the line (must close on the
  // same line so the attribute set is complete — avoids false positives).
  const tagRe = /<\s*[a-zA-Z][\w-]*\b[^<>]*?\/?>/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 4000) continue; // skip minified/huge lines
    let m: RegExpExecArray | null;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(line)) !== null) {
      const tag = m[0];
      const name = tagName(tag);
      if (!name) continue;
      const push = (kind: string, severity: AccessibilitySeverity) =>
        issues.push({ file, line: i + 1, kind, severity, snippet: trimSnippet(line) });

      // ── high: <img> with no alt attribute (screen readers announce nothing) ──
      if (name === 'img' && !hasAttr(tag, 'alt')) {
        push('img-missing-alt', 'high');
      }

      // ── high: <input type="image"> (a graphical submit button) with no alt —
      // it is an image control, so a screen reader announces nothing without alt
      // (WCAG 1.1.1). The plain img-missing-alt rule only covers the <img> tag. ──────
      if (name === 'input' && /\btype\s*=\s*['"{]?\s*image\b/i.test(tag) && !hasAttr(tag, 'alt')) {
        push('input-image-missing-alt', 'high');
      }

      // ── medium: <html> with no lang (assistive tech can't pick a voice) ──────
      if (name === 'html' && !hasAttr(tag, 'lang')) {
        push('html-missing-lang', 'medium');
      }

      // ── medium: <iframe> with no accessible name (screen readers announce only
      // "iframe" with no context — WCAG 4.1.2). title is the standard fix; an
      // aria-label is accepted as an equivalent name. ────────────────────────────
      if (name === 'iframe' && !hasAttr(tag, 'title') && !hasAttr(tag, 'aria-label')) {
        push('iframe-missing-title', 'medium');
      }

      // ── medium: media that auto-plays SOUND without user action (WCAG 1.4.2) —
      // <audio autoplay> always, or a <video autoplay> that is NOT muted. (A muted
      // video autoplay — common for background loops — is fine and not flagged.) ────
      if (
        (name === 'audio' || name === 'video') &&
        hasAttr(tag, 'autoplay') &&
        !(name === 'video' && hasAttr(tag, 'muted'))
      ) {
        push('media-autoplay', 'medium');
      }

      // ── medium: form control with no accessible name ─────────────────────────
      // Conservative: only flag when there is NO labelling hint at all — no
      // aria-label / aria-labelledby / title, AND no id (an id may be the target
      // of a <label for>), AND it is not a type that needs no label.
      if (
        LABELLED_CONTROLS.has(name) &&
        !hasAttr(tag, 'aria-label') &&
        !hasAttr(tag, 'aria-labelledby') &&
        !hasAttr(tag, 'title') &&
        !hasAttr(tag, 'id') &&
        !NO_LABEL_INPUT_TYPES.test(tag)
      ) {
        push('control-unlabeled', 'medium');
      }

      // ── low: click handler on a non-interactive element with no role ─────────
      // Keyboard and screen-reader users cannot reach a bare div/span onClick.
      if (NONINTERACTIVE.has(name) && /\bonClick\b/.test(tag) && !hasAttr(tag, 'role')) {
        push('click-on-noninteractive', 'low');
      }

      // ── low: positive tabindex (breaks the natural focus order) ──────────────
      const ti = /\btab[Ii]ndex\s*=\s*['"{]?\s*([0-9]+)/.exec(tag);
      if (ti && Number(ti[1]) >= 1) {
        push('positive-tabindex', 'low');
      }

      // ── low: anchor with no href (not focusable / not a real link) ───────────
      if (name === 'a' && !hasAttr(tag, 'href')) {
        push('anchor-missing-href', 'low');
      }

      // ── medium: aria-hidden="true" on an interactive element (WCAG 4.1.2) ─────
      // The element stays focusable but is hidden from assistive tech — a keyboard
      // user tabs to a control a screen reader never announces (a "ghost" focus
      // trap). Buttons, links with href, and form controls are interactive.
      if (
        (name === 'button' || name === 'select' || name === 'textarea' ||
          (name === 'a' && hasAttr(tag, 'href')) || name === 'input') &&
        /\baria-hidden\s*=\s*['"{]?\s*true\b/i.test(tag)
      ) {
        push('aria-hidden-interactive', 'medium');
      }
    }

    // ── low: <button> with no accessible name (e.g. an icon-only button) ───────
    // A button that opens and closes on the same line whose inner content, once
    // child tags are stripped, has no visible text — and whose opening tag has no
    // aria-label / aria-labelledby / title. Catches `<button><svg/></button>` and
    // `<button></button>` but not `<button>Save</button>` or `<button><Icon/>Save</button>`.
    const btn = /<\s*button\b([^>]*)>(.*?)<\/\s*button\s*>/i.exec(line);
    if (
      btn &&
      !/\b(aria-label|aria-labelledby|title)\s*=/i.test(btn[1]) &&
      btn[2].replace(/<[^>]*>/g, '').trim() === ''
    ) {
      issues.push({ file, line: i + 1, kind: 'button-no-accessible-name', severity: 'low', snippet: trimSnippet(line) });
    }

    // ── low: <a href> link with no accessible name (e.g. an icon-only link) ────
    // A link that opens and closes on the same line, HAS an href (a real link), whose
    // inner content (child tags stripped) has no visible text, and whose opening tag
    // has no aria-label / aria-labelledby / title — a screen reader announces nothing.
    // Catches `<a href="/x"><svg/></a>` but not `<a href="/x">Home</a>`.
    const lnk = /<\s*a\b([^>]*)>(.*?)<\/\s*a\s*>/i.exec(line);
    if (
      lnk &&
      /\bhref\s*=/i.test(lnk[1]) &&
      !/\b(aria-label|aria-labelledby|title)\s*=/i.test(lnk[1]) &&
      lnk[2].replace(/<[^>]*>/g, '').trim() === ''
    ) {
      issues.push({ file, line: i + 1, kind: 'link-no-accessible-name', severity: 'low', snippet: trimSnippet(line) });
    }
  }
  return issues;
}

function trimSnippet(line: string): string {
  const t = line.trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX) + '…' : t;
}

/** A concise, honest accessibility report for the agent. */
export function accessibilitySummary(issues: AccessibilityIssue[]): string {
  if (issues.length === 0) return 'Accessibility scan: ✓ No accessibility issues detected.';
  const order: Record<AccessibilitySeverity, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = issues.reduce(
    (acc, x) => ((acc[x.severity] = (acc[x.severity] || 0) + 1), acc),
    {} as Record<AccessibilitySeverity, number>,
  );
  const head = `Accessibility scan: ${issues.length} issue(s) — ` +
    (['high', 'medium', 'low'] as AccessibilitySeverity[])
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(', ') + '.';
  const shown = sorted.slice(0, 15);
  const body = shown.map((x) => `  - [${x.severity}] ${x.file}:${x.line} — ${x.kind}: ${x.snippet}`);
  const more = issues.length > shown.length ? [`  …and ${issues.length - shown.length} more.`] : [];
  return [head, ...body, ...more].join('\n');
}
