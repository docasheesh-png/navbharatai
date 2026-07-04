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
  // `(?<![-\w])` (NOT the old `\b`) so a DIFFERENT attribute that merely ENDS in `attr` — e.g.
  // `data-alt` for `alt`, `formaction` for `action` — is not mistaken for it (the `\b` after a
  // hyphen matched `alt` inside `data-alt`, so `<img data-alt="x">` was wrongly read as HAVING alt
  // and the missing-alt finding was silently skipped).
  return new RegExp(`(?<![-\\w])${attr}\\s*=`, 'i').test(tag) || new RegExp(`(?<![-\\w])${attr}(\\s|>|/|$)`, 'i').test(tag);
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
// Abstract ARIA roles exist only to organise the ARIA taxonomy and MUST NOT be used in
// markup — assistive tech ignores them, so the element is left with no usable role.
const ABSTRACT_ROLES = new Set([
  'command', 'composite', 'input', 'landmark', 'range', 'roletype', 'section',
  'sectionhead', 'select', 'structure', 'widget', 'window',
]);
// The implicit ARIA role of a native element. Setting role= to this same value is
// redundant noise (axe "no-redundant-roles"). Only unambiguous mappings are listed.
// NOTE: ul/ol → list and li → listitem are intentionally EXCLUDED. `<ul role="list">` is a
// well-known, legitimate fix: when `list-style: none` is applied, Safari + VoiceOver stop
// announcing the element as a list, and re-adding role="list" restores it. Flagging that as
// "redundant" would give actively harmful advice, so only unambiguous mappings are listed.
const IMPLICIT_ROLE: Record<string, string> = {
  button: 'button', a: 'link', nav: 'navigation',
  main: 'main', table: 'table', textarea: 'textbox',
  h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
};

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

      // ── high: <area href> (an image-map region, i.e. a link) with no alt — a screen
      // reader announces nothing for it (WCAG 1.1.1 / axe "area-alt"). ──────────────
      if (name === 'area' && hasAttr(tag, 'href') && !hasAttr(tag, 'alt')) {
        push('area-missing-alt', 'high');
      }

      // ── medium: <input type="button"> with no accessible name — unlike submit/reset
      // (which default to "Submit"/"Reset"), a plain button input has no default label, so
      // with no value / aria-label it is announced as just "button". ──────────────────
      if (
        name === 'input' && /\btype\s*=\s*['"{]?\s*button\b/i.test(tag) &&
        !hasAttr(tag, 'value') && !hasAttr(tag, 'aria-label') &&
        !hasAttr(tag, 'aria-labelledby') && !hasAttr(tag, 'title')
      ) {
        push('input-button-no-name', 'medium');
      }

      // ── medium: a `scope` attribute on a <td> — scope is only valid on a <th> (it tells
      // a screen reader whether a header labels its row or column). On a <td> it is ignored,
      // so the data cell was meant to be a header (axe "scope-attr-valid"). ──────────────
      if (name === 'td' && hasAttr(tag, 'scope')) {
        push('scope-on-td', 'medium');
      }

      // ── medium: <marquee>/<blink> auto-move or flash content with no way to pause it
      // (WCAG 2.2.2 Pause/Stop/Hide); both are deprecated and dropped by modern browsers. ─
      if (name === 'marquee' || name === 'blink') {
        push('deprecated-marquee-blink', 'medium');
      }

      // ── medium: <html> with no lang (assistive tech can't pick a voice) ──────
      if (name === 'html' && !hasAttr(tag, 'lang')) {
        push('html-missing-lang', 'medium');
      }

      // ── medium: <meta http-equiv="refresh"> auto-refreshes/redirects the page on a
      // timer — it disorients users, can trap screen-reader users, and moves focus
      // without consent (WCAG 2.2.1 Timing Adjustable / 3.2.5 Change on Request). ─────
      if (name === 'meta' && /http-equiv\s*=\s*['"{]?\s*refresh\b/i.test(tag)) {
        push('meta-refresh', 'medium');
      }

      // ── medium: a viewport meta that DISABLES pinch-zoom (user-scalable=no or
      // maximum-scale=1) locks out low-vision users who need to zoom (WCAG 1.4.4). ──
      if (
        name === 'meta' && /name\s*=\s*['"{]?\s*viewport\b/i.test(tag) &&
        /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0+)?(?![.\d])/i.test(tag)
      ) {
        push('zoom-disabled', 'medium');
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
      // A control WRAPPED by a <label> on this line (e.g. `<label>Email <input/></label>`, a very
      // common React form pattern) IS labelled by the label's text — flagging it as unlabeled is a
      // false positive. Detect the enclosing label: an unclosed `<label …>` opens before the control.
      const beforeTag = line.slice(0, m.index);
      const insideWrappingLabel =
        beforeTag.lastIndexOf('<label') !== -1 &&
        beforeTag.lastIndexOf('<label') > beforeTag.lastIndexOf('</label');
      if (
        LABELLED_CONTROLS.has(name) &&
        !insideWrappingLabel &&
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

      // ── low: autofocus on a form control yanks focus to it on page load —
      // it disorients screen-reader users (they are dropped mid-page with no
      // context) and can skip past important content (axe "no-autofocus"). The
      // hasAttr check matches both HTML `autofocus` and JSX `autoFocus`. ──────────
      if (
        (name === 'input' || name === 'select' || name === 'textarea' || name === 'button') &&
        hasAttr(tag, 'autofocus')
      ) {
        push('autofocus', 'low');
      }

      // ── medium: aria-hidden="true" on an interactive element (WCAG 4.1.2) ─────
      // The element stays focusable but is hidden from assistive tech — a keyboard
      // user tabs to a control a screen reader never announces (a "ghost" focus
      // trap). Buttons, links with href, and form controls are interactive.
      const interactive =
        name === 'button' || name === 'select' || name === 'textarea' ||
        (name === 'a' && hasAttr(tag, 'href')) || name === 'input';
      if (interactive && /\baria-hidden\s*=\s*['"{]?\s*true\b/i.test(tag)) {
        push('aria-hidden-interactive', 'medium');
      }

      // ── medium: role="none"/"presentation" on an interactive element strips its
      // semantics — a screen reader no longer announces it as a button/link/control. ──
      if (interactive && /\brole\s*=\s*['"{]?\s*(?:none|presentation)\b/i.test(tag)) {
        push('role-presentation-interactive', 'medium');
      }

      // ── abstract / redundant ARIA role ───────────────────────────────────────
      const roleM = /\brole\s*=\s*['"{]?\s*([a-zA-Z-]+)/.exec(tag);
      if (roleM) {
        const role = roleM[1].toLowerCase();
        if (ABSTRACT_ROLES.has(role)) {
          // medium: an abstract role is ignored by AT — the element ends up with no role.
          push('abstract-aria-role', 'medium');
        } else if (IMPLICIT_ROLE[name] === role && (name !== 'a' || hasAttr(tag, 'href'))) {
          // low: explicit role that just duplicates the element's native role (noise).
          push('redundant-role', 'low');
        }
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

    // ── medium: an empty heading (<h1>…<h6> with no text) ──────────────────────
    // Screen-reader users navigate by headings; an empty one is announced as a
    // heading with no content, breaking the page outline (axe "empty-heading",
    // WCAG 1.3.1 / 2.4.6). Same-line open/close; child tags are stripped, so
    // `<h2><Icon/></h2>` with no text is flagged but `<h2>About</h2>` is not. An
    // aria-label on the heading provides the name and is accepted.
    const hdg = /<\s*h([1-6])\b([^>]*)>(.*?)<\/\s*h\1\s*>/i.exec(line);
    if (
      hdg &&
      !/\b(aria-label|aria-labelledby|title)\s*=/i.test(hdg[2]) &&
      hdg[3].replace(/<[^>]*>/g, '').trim() === ''
    ) {
      issues.push({ file, line: i + 1, kind: 'empty-heading', severity: 'medium', snippet: trimSnippet(line) });
    }

    // ── medium: an empty table header (<th> with no text) ──────────────────────
    // A <th> names its row/column for screen-reader table navigation; an empty one
    // leaves that row/column unlabeled (WCAG 1.3.1). Same-line; child tags stripped, so
    // `<th><Icon/></th>` is flagged but `<th>Name</th>` is not. aria-label is accepted.
    const th = /<\s*th\b([^>]*)>(.*?)<\/\s*th\s*>/i.exec(line);
    if (
      th &&
      !/\b(aria-label|aria-labelledby|title)\s*=/i.test(th[1]) &&
      th[2].replace(/<[^>]*>/g, '').trim() === ''
    ) {
      issues.push({ file, line: i + 1, kind: 'empty-table-header', severity: 'medium', snippet: trimSnippet(line) });
    }

    // ── medium: an explicit <label for="…"> with no content ────────────────────
    // A for-label MUST carry the control's visible name; when truly empty it gives the
    // associated control no accessible name. Only the truly-empty form is flagged (no
    // children at all), so a wrapping `<label><input/>…</label>` is never a false positive.
    const lbl = /<\s*label\b([^>]*)>(.*?)<\/\s*label\s*>/i.exec(line);
    if (
      lbl &&
      /\bfor\s*=/i.test(lbl[1]) &&
      !/\b(aria-label|aria-labelledby|title)\s*=/i.test(lbl[1]) &&
      lbl[2].trim() === ''
    ) {
      issues.push({ file, line: i + 1, kind: 'empty-label', severity: 'medium', snippet: trimSnippet(line) });
    }
  }

  // ── medium: duplicate static id within the same file ─────────────────────────
  // A repeated id="foo" breaks <label for>/aria-* references (they target the FIRST
  // match) and is invalid HTML. Only literal string ids are checked — dynamic ids
  // (id={foo}, id={`row-${i}`}) are expected to vary and are not counted.
  const idLineByValue = new Map<string, number>();
  const idCount = new Map<string, number>();
  const idRe = /\bid\s*=\s*["']([^"'{}\s]+)["']/g;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 4000) continue;
    let m: RegExpExecArray | null;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(lines[i])) !== null) {
      const val = m[1];
      idCount.set(val, (idCount.get(val) || 0) + 1);
      // Record the line of the SECOND occurrence (where the collision first shows).
      if (idCount.get(val) === 2) idLineByValue.set(val, i + 1);
    }
  }
  for (const [val, count] of idCount) {
    if (count >= 2) {
      const ln = idLineByValue.get(val) ?? 1;
      issues.push({ file, line: ln, kind: 'duplicate-id', severity: 'medium', snippet: `id="${val}" appears ${count} times` });
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
