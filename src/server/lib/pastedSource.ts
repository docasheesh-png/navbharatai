// A PROMPT THAT IS PASTED CODE IS NOT PROSE (autopsy a106df77, 2026-10-01).
//
// 🔴 WHAT SHIPPED. A user pasted their own bill-maker app, a whole HTML file, into the build box with
// nothing else. Every reader that treats the prompt as a sentence then read markup:
//   • the published app's <title>, og:title, manifest name and description became
//     `<!doctype html> <html lang="en"> <head>` (appDisplayName's prompt fallback);
//   • the summary was prefixed with "You asked for “width=device-width,initial-scale=1”, but the summary
//     never mentions it" — a `<meta content="…">` attribute read as the app name the user quoted;
//   • the feature probe looked for controls named after words in the JavaScript and the CSS.
// The pasted file already said what the app is called (`<title>A1 Decor India - Bill Maker…`) and what
// it has (its tabs, buttons and fields). Nothing read those.
//
// 🔑 THE CLASS: a reader of the user's WORDS must read the words the user wrote, not the code they
// pasted. This module is the one place that tells the two apart; every such reader asks it.
//
// PRECISION FIRST. An ordinary prompt is returned unchanged, byte for byte. A prompt counts as pasted
// source only when it carries an HTML document, or at least MIN_CODE_LINES lines that read as code and
// make up most of the lines between the first and the last of them. A sentence that quotes one tag
// ("make the <button> bigger") is not pasted source.
//
// PURE — no I/O, no clock. Never throws.

/** Fewer code lines than this is a quote inside a sentence, not a pasted file. */
const MIN_CODE_LINES = 8;
/** Inside the pasted span, at least this share of the non-empty lines must read as code. */
const MIN_CODE_SHARE = 0.5;

const HTML_DOCUMENT = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]/i;
const FENCE = /^\s*(```|~~~)/;

/** Does this one line read as code (markup, a statement, a CSS declaration)? */
export function isCodeLine(raw: string): boolean {
  const line = raw.trim();
  if (!line) return false;
  if (FENCE.test(line)) return true;
  if (/^<[a-zA-Z!/?]/.test(line)) return true; // markup
  if (/^[{}()[\]]/.test(line)) return true; // a bracket opening or closing a block
  if (/[{};]$/.test(line) || /=>\s*\{?$/.test(line)) return true; // a statement or a block's edge
  // A comment — but NOT a line that merely starts with `* `: that is a Markdown bullet in a written
  // spec ("* Total Advertisers"), and a bulleted spec is the opposite of pasted code. A JSDoc
  // continuation line still counts, because `pastedSpan` tracks the `/* … */` block it sits in.
  if (/^(?:\/\/|\/\*|\*\/)/.test(line)) return true;
  if (/^(?:let|const|var|function|import|export|return|if|else|for|while|switch|case|class|def|async|await|try|catch)\b/.test(line)) return true;
  if (/^--?[\w-]+\s*:\s*\S/.test(line)) return true; // a CSS custom property
  if (/^[a-z-]+:\S/.test(line)) return true; // `box-sizing:border-box` — no space after the colon
  if (/^[\w$.]+\s*(?:[+\-*/]?=|\()\S*/.test(line) && !/\s\w+\s\w+\s\w+/.test(line)) return true; // `x=1`, `foo(`
  if (/^[\w$]+\s*:\s*[\w$"'`[{(]/.test(line) && /[,(]$/.test(line)) return true; // `name: value,` in an object literal
  return false;
}

/** The first and last line (inclusive) of the pasted code, or null when there is none worth the name. */
function pastedSpan(lines: readonly string[]): { first: number; last: number; codeLines: number } | null {
  let first = -1;
  let last = -1;
  let codeLines = 0;
  let inFence = false;
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const isFence = FENCE.test(lines[i]);
    // Every line of a `/* … */` block is code, including its ` * ` continuations — tracked here rather
    // than by the shape of the line, so a Markdown bullet outside any block is never mistaken for one.
    const wasInBlock = inBlockComment;
    const t = lines[i].trim();
    if (inBlockComment && /\*\//.test(t)) inBlockComment = false;
    else if (!inBlockComment && /\/\*/.test(t) && !/\*\/.*$/.test(t.slice(t.indexOf('/*') + 2))) inBlockComment = true;
    const code = inFence || wasInBlock || isCodeLine(lines[i]);
    if (isFence) inFence = !inFence;
    if (!code) continue;
    codeLines++;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? null : { first, last, codeLines };
}

/** Is the prompt a pasted HTML DOCUMENT — a whole page, not a component or a snippet? PURE. */
export function isPastedHtmlDocument(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '');
  return HTML_DOCUMENT.test(text) && isPastedSource(text);
}

/**
 * Is the prompt mostly pasted source — an HTML document, or a block of code — rather than a request
 * written in words? PURE.
 */
export function isPastedSource(prompt: string | null | undefined): boolean {
  const text = String(prompt ?? '');
  if (!text.trim()) return false;
  const lines = text.split('\n');
  const span = pastedSpan(lines);
  if (!span) return false;
  if (HTML_DOCUMENT.test(text) && span.codeLines >= 3) return true;
  if (span.codeLines < MIN_CODE_LINES) return false;
  const inside = lines.slice(span.first, span.last + 1).filter((l) => l.trim()).length;
  return inside > 0 && span.codeLines / inside >= MIN_CODE_SHARE;
}

/**
 * The words the user wrote around the paste — the lines before the pasted code and after it. The prompt
 * unchanged when it is not pasted source; '' when the paste stands alone. PURE.
 */
export function readablePrompt(prompt: string | null | undefined): string {
  const text = String(prompt ?? '');
  if (!isPastedSource(text)) return text;
  const lines = text.split('\n');
  const span = pastedSpan(lines);
  if (!span) return text;
  return [...lines.slice(0, span.first), ...lines.slice(span.last + 1)].join('\n').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * The text a visitor would read on the pasted page: no scripts, no styles, no tags, nothing after
 * `</html>`. A `<style>` the user forgot to close (the a106df77 file did) ends at the next tag, since CSS
 * holds no `<`. '' when the prompt carries no markup. PURE.
 */
export function pastedVisibleText(prompt: string | null | undefined): string {
  const text = String(prompt ?? '');
  if (!isPastedSource(text) || !/<[a-zA-Z]/.test(text)) return '';
  const html = text.replace(/<\/html\s*>[\s\S]*$/i, '');
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, ' ')
      .replace(/<style\b[^>]*>[^<]*(?:<\/style\s*>)?/gi, ' ')
      .replace(/<title\b[\s\S]*?<\/title\s*>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PastedAppFacts {
  /** The pasted page's own `<title>`, decoded. */
  title: string | null;
  /** Its first `<h1>`, decoded. */
  heading: string | null;
  /** Its `<meta name="description">`. */
  description: string | null;
  /** Buttons and tabs, in page order, deduplicated. */
  controls: string[];
  /** Input fields, named by their label or placeholder. */
  fields: string[];
  /** Colours it declares as CSS custom properties, `--name: #hex`. */
  colours: Array<{ name: string; value: string }>;
}

function clean(s: string | undefined | null): string | null {
  const t = decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return t.length >= 2 && /\p{L}/u.test(t) ? t : null;
}

function uniq(list: Array<string | null>, max: number): string[] {
  const out: string[] = [];
  for (const v of list) if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  return out.slice(0, max);
}

/**
 * What the pasted page says about itself: its name, its controls, its fields and its colours. Read from
 * the markup outside `<script>`, so a button built inside a JavaScript template is not counted (it is
 * code the builder reads, not a label we can vouch for). Empty facts when the prompt is not pasted HTML.
 * PURE.
 */
export function pastedAppFacts(prompt: string | null | undefined): PastedAppFacts {
  const none: PastedAppFacts = { title: null, heading: null, description: null, controls: [], fields: [], colours: [] };
  const text = String(prompt ?? '');
  if (!isPastedSource(text) || !/<[a-zA-Z]/.test(text)) return none;
  const css = (text.match(/<style\b[^>]*>([^<]*)/gi) ?? []).join('\n');
  const html = text.replace(/<\/html\s*>[\s\S]*$/i, '').replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, ' ');
  const title = clean(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]);
  const heading = clean(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(html)?.[1]);
  const description = clean(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1]);
  const controls = uniq(
    [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi)].map((m) => clean(m[1])),
    24,
  );
  const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label\s*>/gi)].map((m) => clean(m[1]));
  const placeholders = [...html.matchAll(/<(?:input|textarea|select)\b[^>]*placeholder=["']([^"']+)["']/gi)].map((m) => clean(m[1]));
  const fields = uniq([...labels, ...placeholders], 24);
  const colours: Array<{ name: string; value: string }> = [];
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) {
    if (!colours.some((c) => c.name === m[1])) colours.push({ name: m[1], value: m[2] });
    if (colours.length >= 8) break;
  }
  return { title, heading, description, controls, fields, colours };
}
