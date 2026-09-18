#!/usr/bin/env node
// THEME COLOUR RATCHET — the census behind tests/themeTokensOnly.test.ts, and the one command that
// lowers its baseline.
//
// WHY THIS EXISTS (admin audit 2026-09-18, "pura theme system badlo"). NavBharatAI had no theme
// system: the UI was written in hardcoded GitHub-dark classes (`text-white` ×1,852, `bg-[#0d1117]`,
// `text-[#8b949e]` …, 14,620 usages) and `theme-compat.css` re-mapped an ALLOWLIST of those literals
// to CSS variables. An allowlist can never be complete against an open-ended set of class names — it
// was patched three times (2026-08-08, 08-16, 09-13) and the audit still found 1,347 usages outside
// it plus 387 inline `style={{ color }}` values CSS cannot reach, giving 236 invisible and 1,557
// near-invisible text nodes across 420 page×theme screenshots. Comfort failed on 84/84 screens.
//
// THE RULE THIS ENFORCES: colour comes from the semantic tokens (`bg-surface`, `text-ink`,
// `text-muted`, `border-line`, `text-danger` … defined in index.css `@theme inline`) — never from a
// literal. A literal is anything a theme must flip and cannot see: white/black, the grey families,
// the GitHub hexes, brand TEXT shades, arbitrary `[#hex]`/`[rgb()]` colours, and inline style colours.
// Solid brand BACKGROUNDS (`bg-indigo-600`) are deliberately NOT counted: they are the same in every
// theme and do not break one; they migrate to `bg-accent` opportunistically.
//
// HOW THE RATCHET WORKS: tests/fixtures/themeColourBaseline.json records today's count PER FILE. The
// test fails when any file is ABOVE its baseline (a new literal) or BELOW it (an improvement not yet
// locked in — run `node scripts/themeColourBaseline.mjs --write` and commit the smaller number). A file
// absent from the baseline has a baseline of ZERO, so every new file is token-only from its first line.
// The number can only go down. When it reaches zero everywhere, theme-compat.css can be deleted.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
export const BASELINE_PATH = 'tests/fixtures/themeColourBaseline.json';

const PROPS = '(?:text|bg|border|border-[trblxy]|ring|divide|placeholder|from|via|to|outline|fill|stroke|caret|decoration)';
const GREY = '(?:slate|gray|zinc|neutral|stone)';
const HUE = '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const GITHUB_HEX = '(?:0d1117|161b22|21262d|30363d|0d1520|1c2128|1c2732|1e1e1e|252526|111827|0f172a|c9d1d9|e6edf3|f7f9f9|8b949e|969696|858585|484f58|586069|6e7681|2d3748|38444d|15202b|22303c|fdf6e3|eee8d5)';
/**
 * A colour utility the theme cannot see. Variant prefixes (`hover:`, `md:`, `group-hover:` …) are
 * part of the match so a hover literal counts the same as a resting one — the audit's 270 unmapped
 * hover classes were exactly the ones an earlier sweep forgot.
 */
export const LITERAL = new RegExp(
  `(?<![\\w-])((?:[a-z-]+:)*)${PROPS}-(?:white|black|${GREY}-\\d{2,3}|\\[#[0-9a-fA-F]{3,8}\\]|\\[rgba?\\([^\\]]*\\)\\])(?:\\/\\d{1,3})?(?![\\w-])`
  + `|(?<![\\w-])((?:[a-z-]+:)*)text-${HUE}-(?:50|100|200|300|400|500|600|700)(?:\\/\\d{1,3})?(?![\\w-])`
  // A DARK tint (`bg-emerald-900/30`): a subtle wash on dark, a mid-dark smear on light — the theme cannot
  // lighten a 900 shade. The readable idiom is the 500 shade at low opacity, which is a tint on both.
  + `|(?<![\\w-])((?:[a-z-]+:)*)bg-${HUE}-(?:800|900|950)\\/\\d{1,3}(?![\\w-])`,
  'g',
);
/** `style={{ color: '#fff' }}` and friends — CSS cannot override these, so they count double as a smell. */
export const INLINE = /\b(?:color|background(?:Color)?|borderColor|fill|stroke|outlineColor|caretColor)\s*:\s*['"`]?(?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|white|black)(?![\w-])/g;

/** Strip comments so a quoted class name in prose is not a usage. Same discipline as uiLanguageEnglishOnly. */
export function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
}

/**
 * Blank out EMBEDDED SOURCE — a template literal whose body is markup (`className=`, `class=`, an
 * HTML tag). NavBharatAI's own UI never puts JSX inside a backtick string; what does is source that
 * belongs to SOMEBODY ELSE'S app: the starter projects in SyncedTemplates.ts, the copyable snippets in
 * ComponentLibrary, a scaffold a builder writes into the user's workspace. Those apps do not have our
 * tokens, so a `text-white` there is not a theme bug and rewriting it to `text-ink` would break the
 * component the user copies. The body is replaced with spaces (newlines kept) so line numbers and
 * offsets still line up for the census and the codemod alike.
 */
/**
 * The outermost template literals of a source, as [start, end) offsets — nesting-aware, because a
 * report assembled as `<table>${rows.map((r) => `<tr>…</tr>`)}</table>` is ONE literal, and a scan
 * that ends at the first inner backtick would leave every other segment of it visible to the census.
 */
export function templateLiteralSpans(src) {
  const spans = [];
  const stack = []; // 'tpl' | { braces: n } for a ${ … } expression
  let start = -1;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (top === 'tpl') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { stack.pop(); if (stack.length === 0) spans.push([start, i + 1]); continue; }
      if (ch === '$' && src[i + 1] === '{') { stack.push({ braces: 0 }); i++; }
      continue;
    }
    if (top && typeof top === 'object') {
      if (ch === '`') { stack.push('tpl'); continue; }
      if (ch === "'" || ch === '"') { // a plain string inside the expression: skip it whole
        for (i++; i < src.length && src[i] !== ch && src[i] !== '\n'; i++) if (src[i] === '\\') i++;
        continue;
      }
      if (ch === '{') top.braces++;
      else if (ch === '}') { if (top.braces === 0) stack.pop(); else top.braces--; }
      continue;
    }
    if (ch === '`') { stack.push('tpl'); start = i; }
  }
  return spans;
}

export function maskEmbeddedSources(src) {
  const blank = (lit) => lit.replace(/[^\n]/g, ' ');
  const isMarkup = (lit) => /className=|\bclass=|<[a-z][\w-]*[\s>]/.test(lit);
  let out = '';
  let cursor = 0;
  for (const [a, b] of templateLiteralSpans(src)) {
    const lit = src.slice(a, b);
    out += src.slice(cursor, a) + (isMarkup(lit) ? blank(lit) : lit);
    cursor = b;
  }
  out += src.slice(cursor);
  // A single- or double-quoted string that OPENS an HTML tag is markup too: a printable report
  // assembled with .replace(), a syntax highlighter's `<span style=…>`. JSX itself is never
  // inside quotes, and a className string never contains `<tag`, so this cannot touch the UI.
  return out.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (lit) =>
    (/<[a-z][\w-]*[\s>]/.test(lit) ? blank(lit) : lit));
}

/** Every client source file — the surfaces a user reads. Server code renders no UI. */
export function clientFiles(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      const rel = relative(root, p).split('\\').join('/');
      if (rel.startsWith('src/server') || e === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(rel);
    }
  };
  walk(join(root, 'src'));
  return out.sort();
}

/** The literal colours in one file, with line numbers — what the failure message prints. */
export function literalsIn(src) {
  const hits = [];
  maskEmbeddedSources(codeOnly(src)).split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LITERAL)) hits.push({ line: i + 1, token: m[0] });
    for (const m of line.matchAll(INLINE)) hits.push({ line: i + 1, token: m[0] });
  });
  return hits;
}

export function census(root = ROOT) {
  const counts = {};
  for (const f of clientFiles(root)) {
    const n = literalsIn(readFileSync(join(root, f), 'utf8')).length;
    if (n) counts[f] = n;
  }
  return counts;
}

export function readBaseline(root = ROOT) {
  try { return JSON.parse(readFileSync(join(root, BASELINE_PATH), 'utf8')); } catch { return {}; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const counts = census();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (process.argv.includes('--write')) {
    writeFileSync(join(ROOT, BASELINE_PATH), JSON.stringify(counts, null, 2) + '\n');
    console.log(`themeColourBaseline: wrote ${Object.keys(counts).length} files, ${total} literal colours → ${BASELINE_PATH}`);
  } else {
    const base = readBaseline();
    const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
    console.log(`themeColourBaseline: ${total} literal colours in ${Object.keys(counts).length} files (baseline ${baseTotal}). Top 15:`);
    for (const [f, n] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(String(n).padStart(5), f);
  }
}
