// AgentV3 — an app that renders its OWN error message has not done its job (Q-362, autopsy 981ce4cc,
// admin chose option (a) 2026-10-04: "apke sare suggestion accepted").
//
// 🔴 WHY. "Edit pdf" built a PDF app whose only job was opening a PDF. It rendered, every check passed,
// the readiness score read 92/100, and its copy was published — while the page itself said "Failed to load
// PDF file". pdf.js reports its worker failure through `console.log`, which no check reads, and every
// render check asks only "did the app paint?". A page that paints an error IS painted, so the one sentence
// on screen that said the app was broken was the one thing nothing looked at.
//
// WHAT IT READS. The DOM the real browser captured after paint (the same HTML the render verdict judged).
// Three shapes, all precision-first:
//   1. `alert`     — an element marked `role="alert"` (or `aria-live="assertive"`) whose own text says
//                    something failed.
//   2. `error-box` — an element whose class or id names an error (`error`, `danger`, `failed`, as a word
//                    of the name: `error-banner`, `react-pdf__message--error`, `errorBox`) whose own text
//                    says something failed.
//   3. `runtime-text` — a short visible line that only a failing runtime writes: "TypeError: …",
//                    "Cannot read properties of undefined", "Setting up fake worker failed", or a line
//                    that STARTS with "Failed to load/fetch/…", "Something went wrong", "Could not load…".
//
// ⚠️ WHAT IT DELIBERATELY IGNORES: text inside <pre>, <code>, <textarea>, <option>, <script>, <style>
// (a code editor or a log viewer shows error words as its content); elements marked hidden; a designed
// empty state ("No results found" — "not found" is not a failure word here); a whole page (an element
// whose text is longer than a banner is not a banner).
//
// 🔒 EVIDENCE, NEVER A GATE. The route records `APP_SHOWS_ERROR` as a warning with a one-tap offer to fix
// it. It fails no build, starts no repair by itself and moves no money. PURE.

export type VisibleErrorVia = 'alert' | 'error-box' | 'runtime-text';

export interface VisibleAppError {
  /** The error text as the page showed it, trimmed to one line. */
  text: string;
  /** Which of the three shapes matched — see the header. */
  via: VisibleErrorVia;
}

/** The report code. An APP finding: the user's own app shows an error on screen. */
export const APP_SHOWS_ERROR_CODE = 'APP_SHOWS_ERROR';

/** Longest text an error banner can carry before it reads as a page rather than a message. */
const BANNER_MAX_CHARS = 300;

/** Words that make an alert's or error box's own text a FAILURE rather than a notice. */
const FAILURE_WORDS = new RegExp(
  '(?:\\b(?:failed|failure|fails|error|errors|cannot|can\'t|could\\s*n[o\']t|couldn\'t|unable\\s+to|went\\s+wrong|timed\\s+out|exception|crash(?:ed)?)\\b'
  + '|विफल|त्रुटि|असफल|गड़बड़)',
  'i',
);

/** Lines only a failing runtime writes, wherever they appear. */
const RUNTIME_LINE = new RegExp(
  '^(?:uncaught\\s+)?(?:TypeError|ReferenceError|SyntaxError|RangeError|ChunkLoadError)\\s*:'
  + '|cannot\\s+read\\s+propert(?:y|ies)\\s+of\\s+(?:undefined|null)'
  + '|setting\\s+up\\s+fake\\s+worker\\s+failed'
  + '|failed\\s+to\\s+fetch\\s+dynamically\\s+imported\\s+module',
  'i',
);

/** A short line that OPENS with a failure — the shape of an app's own error message. */
const FAILURE_LINE_START =
  /^(?:⚠️?\s*|❌\s*|error\s*:\s*)?(?:failed\s+to\s+(?:load|fetch|connect|initiali[sz]e|open|read|parse|start|render|get|retrieve|save|play|decode)|something\s+went\s+wrong|could\s*n[o']t\s+(?:load|fetch|connect|open|read)|unable\s+to\s+(?:load|fetch|connect|open|read))\b/i;

/** Elements whose content is somebody's data or code, never the app talking about itself. */
const OPAQUE_TAGS = ['script', 'style', 'pre', 'code', 'textarea', 'option', 'template', 'noscript', 'svg'];

/** Tags that begin a new visual line. */
const BLOCK_TAG = /<\/?(?:div|p|li|ul|ol|h[1-6]|section|article|header|footer|main|nav|aside|tr|td|th|table|br|hr|form|label|button|dialog|figure|figcaption|body|html)\b[^>]*>/gi;

function stripOpaque(html: string): string {
  let out = html;
  for (const tag of OPAQUE_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** `hidden`, `aria-hidden="true"` or an inline `display:none` / `visibility:hidden` on the tag itself. */
function tagIsHidden(tag: string): boolean {
  return /\shidden(?:\s|=|>|\/)/i.test(tag)
    || /aria-hidden\s*=\s*["']?true/i.test(tag)
    || /style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(tag);
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

/** The words of one class or id token: `react-pdf__message--error` → [react, pdf, message, error]; `errorBox` → [error, box]. */
function tokenWords(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const ERROR_NAME_WORDS = new Set(['error', 'errors', 'danger', 'failed', 'failure', 'fail']);
/** Names that mention an error but are not one: a boundary wrapper, a "no errors" state, an error LOG screen. */
const NOT_AN_ERROR_NAME = new Set(['boundary', 'no', 'none', 'log', 'logs', 'list', 'page', 'icon', 'count', 'free']);

function namesAnError(tag: string): boolean {
  const names = `${attr(tag, 'class')} ${attr(tag, 'id')}`.split(/\s+/).filter(Boolean);
  return names.some((n) => {
    const words = tokenWords(n);
    return words.some((w) => ERROR_NAME_WORDS.has(w)) && !words.some((w) => NOT_AN_ERROR_NAME.has(w));
  });
}

function isAlertTag(tag: string): boolean {
  return /\srole\s*=\s*["']?alert/i.test(tag) || /aria-live\s*=\s*["']?assertive/i.test(tag);
}

/** The inner HTML of the element opened at `start` (a tag of `name`), by balancing same-name tags. */
function innerOf(html: string, start: number, openTag: string, name: string): string {
  if (/\/>\s*$/.test(openTag)) return '';
  const body = start + openTag.length;
  const re = new RegExp(`<(\\/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = body;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].endsWith('/>')) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(body, m.index);
  }
  return html.slice(body, body + 2000);
}

/** The document with every element marked hidden removed, subtree and all. */
function withoutHidden(html: string): string {
  let out = html;
  for (let guard = 0; guard < 200; guard++) {
    const re = /<([a-zA-Z][\w-]*)\b[^>]*>/g;
    let cut = false;
    for (let m = re.exec(out); m; m = re.exec(out)) {
      if (!tagIsHidden(m[0])) continue;
      const inner = innerOf(out, m.index, m[0], m[1].toLowerCase());
      const end = m.index + m[0].length + inner.length;
      const close = out.slice(end).match(new RegExp(`^<\\/${m[1]}\\s*>`, 'i'));
      out = out.slice(0, m.index) + ' ' + out.slice(end + (close ? close[0].length : 0));
      cut = true;
      break;
    }
    if (!cut) break;
  }
  return out;
}

/** The document without list items and table cells — the app's data, not its messages. */
function withoutDataCells(html: string): string {
  return html.replace(/<(li|td|th|dd)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
}

function oneLine(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
}

/**
 * The first error message the rendered page shows, or `null`. PURE.
 * `html` is the DOM the real browser captured after paint.
 */
export function visibleAppError(html: string): VisibleAppError | null {
  if (typeof html !== 'string' || !html.trim()) return null;
  const doc = withoutHidden(stripOpaque(html));

  // 1 + 2 — an alert or an element named as an error, whose own text says something failed.
  const openTag = /<([a-zA-Z][\w-]*)\b[^>]*>/g;
  for (let m = openTag.exec(doc); m; m = openTag.exec(doc)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    const alert = isAlertTag(tag);
    if (!alert && !namesAnError(tag)) continue;
    if (tagIsHidden(tag)) continue;
    const text = textOf(innerOf(doc, m.index, tag, name));
    if (!text || text.length > BANNER_MAX_CHARS) continue;
    if (!FAILURE_WORDS.test(text) && !RUNTIME_LINE.test(text)) continue;
    return { text: oneLine(text), via: alert ? 'alert' : 'error-box' };
  }

  // 3 — a short visible line only a failing runtime, or an app reporting its own failure, writes.
  // A block element starts a new line; an inline one (`<b>`, `<span>`) is part of the same sentence, so
  // "Failed to <b>load</b> PDF" stays one line.
  // A list item or table cell holds the app's DATA (a task called "Failed to load truck"), never the
  // app reporting on itself, so only a runtime-only line is read there.
  const lines = decodeEntities(withoutDataCells(doc).replace(BLOCK_TAG, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && l.length <= BANNER_MAX_CHARS);
  for (const line of lines) {
    if (RUNTIME_LINE.test(line) || FAILURE_LINE_START.test(line)) return { text: oneLine(line), via: 'runtime-text' };
  }
  const dataLines = decodeEntities(doc.replace(BLOCK_TAG, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0 && l.length <= BANNER_MAX_CHARS);
  for (const line of dataLines) {
    if (RUNTIME_LINE.test(line)) return { text: oneLine(line), via: 'runtime-text' };
  }
  return null;
}

/** The admin report line for a page that shows an error. */
export function appShowsErrorNote(err: VisibleAppError, where: string): {
  code: string; severity: 'warning'; message: string; detail: string; autoResolved: boolean;
} {
  return {
    code: APP_SHOWS_ERROR_CODE,
    severity: 'warning',
    autoResolved: false,
    message: `The app rendered, but its own screen shows an error message (${where}): "${err.text}". A page that paints an error has not done its job, whatever the render check says.`,
    detail: `via=${err.via}`,
  };
}
