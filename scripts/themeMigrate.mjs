#!/usr/bin/env node
/**
 * themeMigrate — move a client file from colour LITERALS to the semantic TOKENS (theme replacement,
 * PR C onward — admin 2026-09-18, "pura theme system badlo").
 *
 *   node scripts/themeMigrate.mjs src/components/AdminDashboard.tsx [more files] [--dry]
 *   then: node scripts/themeColourBaseline.mjs --write   (lock the smaller count in)
 *
 * WHY A CODEMOD AND NOT A HAND EDIT: the audit found 1,335 distinct literal classes but the heaviest
 * files use ~110 of them, and the top twenty carry 80% of the usages. One explicit table, applied
 * mechanically, is reviewable in a way 1,073 hand edits in one file are not — and it is the same
 * answer in every file, so two files can never drift apart on what `text-[#8b949e]` "means".
 *
 * TWO KINDS OF ROW, and the difference matters for review:
 *   EXACT — the literal is one `theme-compat.css` already remaps to a palette variable, and the token
 *           emits the SAME variable (`.bg-card{background-color:var(--surface-card)}`). Pixel-identical
 *           on every theme today, by construction; `tests/themeMigrate.test.ts` proves it against the
 *           compat file itself.
 *   FIX   — the literal is one the audit measured as unreadable (`text-white/40` is 1.9–2.2:1 on every
 *           theme; a light brand shade on a light card) and the token is the readable equivalent.
 *           These CHANGE pixels, on purpose, toward AA.
 * Anything not in the table is left exactly as it was and reported, so nothing is guessed.
 *
 * Variant prefixes (`hover:`, `md:`, `group-hover:`, `placeholder:` …) are preserved verbatim: the
 * LITERAL regex captures them and the replacement re-attaches them.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LITERAL, literalsIn } from './themeColourBaseline.mjs';

/** Semantic token → the palette variable its Tailwind utility resolves to (see `@theme inline` in index.css). */
export const TOKEN_VAR = {
  ink: '--text-primary', body: '--text-body', muted: '--text-muted', faint: '--text-faint',
  surface: '--surface-base', card: '--surface-card', raised: '--surface-raised', line: '--border-soft',
  well: '--surface-well', scrim: '--scrim',
  success: '--brand-success-text', warn: '--brand-warn-text', danger: '--brand-danger-text',
  info: '--brand-info-text', 'accent-text': '--brand-accent-strong',
};

// EXACT sets: each literal here is remapped by theme-compat.css to the variable its token emits.
const TEXT_BODY = ['[#c9d1d9]', '[#e6edf3]', '[#f7f9f9]', 'gray-100', 'gray-200', 'zinc-100', 'zinc-200', 'slate-200'];
const TEXT_MUTED = ['[#8b949e]', '[#969696]', '[#858585]', 'gray-300', 'gray-400', 'zinc-300', 'zinc-400', 'slate-400'];
const TEXT_FAINT = ['[#484f58]', '[#586069]', '[#6e7681]', '[#2d3748]', 'gray-500', 'gray-600', 'zinc-500', 'slate-500'];
const BG_SURFACE = ['[#0d1117]', '[#0d1520]', 'zinc-950', 'neutral-950', 'gray-950', 'slate-950', 'stone-950'];
const BG_CARD = ['[#161b22]', '[#1e1e1e]', '[#252526]', '[#111827]', '[#0f172a]', 'zinc-900', 'gray-900', 'neutral-900'];
const BG_RAISED = ['[#21262d]', '[#1c2128]', '[#1c2732]', '[#30363d]', 'zinc-800', 'gray-800', 'neutral-800', 'zinc-700', 'gray-700', 'neutral-700'];
const LINE = ['[#30363d]', '[#38444d]', '[#161b22]', '[#21262d]', 'zinc-700', 'zinc-800', 'gray-700', 'gray-800'];
// FIX sets: the same roles written in a grey family or hex the compat layer never covered — so today
// they do NOT follow the theme at all (a zinc-600 label stays #52525b on Light). These are the audit's
// "the next 1,347" and each is a readability fix, not an equivalence.
const TEXT_BODY_FIX = ['[#efeff1]', '[#f0f6fc]', '[#d6d3d1]', 'stone-200', 'neutral-200', 'stone-300'];
const TEXT_MUTED_FIX = ['[#a1a1aa]', 'neutral-400', 'stone-400', 'neutral-300'];
const TEXT_FAINT_FIX = ['[#30363d]', 'zinc-600', 'neutral-500', 'stone-500', 'neutral-600', 'stone-600'];
const BG_SURFACE_FIX = ['[#07090e]', '[#08090c]', '[#0b0f14]', '[#0b0e14]', '[#0a0e14]'];
const BG_CARD_FIX = ['stone-900', 'slate-900'];
const BG_RAISED_FIX = ['[#1a212b]', '[#12161f]', '[#1f2937]', '[#1c2430]', '[#1c2a38]', '[#2f363d]', 'stone-800', 'stone-700', 'zinc-600', 'gray-600', 'neutral-600'];
const LINE_FIX = ['[#2b2b2b]', '[#1e293b]', 'zinc-600', 'zinc-500', 'gray-600', 'gray-500', 'stone-800', 'stone-700', 'neutral-700', 'neutral-800', 'slate-700', 'slate-800'];
/** Hex brand text the hue table cannot see. */
const HEX_BRAND = { '[#ff8080]': 'danger', '[#fda4af]': 'danger', '[#f85149]': 'danger', '[#58a6ff]': 'info', '[#60a5fa]': 'info', '[#2496ed]': 'info', '[#a259ff]': 'accent-text' };
/** The neutral "unknown" dot / knob greys — a faint surface, not a text colour, so `bg-faint`. */
const BG_FAINT = ['[#484f58]', 'zinc-500', 'gray-500', 'neutral-500', 'slate-500'];

/** Brand hue family → the readable-on-every-theme text token. */
const HUE_TOKEN = {
  green: 'success', emerald: 'success', teal: 'success', lime: 'success',
  amber: 'warn', yellow: 'warn', orange: 'warn',
  red: 'danger', rose: 'danger',
  sky: 'info', cyan: 'info', blue: 'info',
  indigo: 'accent-text', violet: 'accent-text', purple: 'accent-text', fuchsia: 'accent-text', pink: 'accent-text',
};

const inSet = (set, v) => set.includes(v);

/**
 * A SOLID brand fill on the same element — the case theme-compat.css protects with
 * `.bg-indigo-600.text-white { color: #fff }`: white on a saturated button stays white on every theme,
 * so there the token is `text-on-accent`, never `text-ink`. Opacity variants (`bg-indigo-500/10`) are a
 * tint on a card, not a fill, and are deliberately NOT matched — same distinction the compat file draws.
 */
export const SOLID_FILL = /(?<![\w-])(?:[a-z-]+:)*bg-(?:indigo|blue|emerald|green|red|rose|purple|violet|fuchsia|amber|orange|teal|cyan|pink|sky)-(?:500|600|700)(?:\/(?:[6-9]\d|100))?(?![\w/-])|(?<![\w-])(?:[a-z-]+:)*bg-gradient-|(?<![\w-])(?:[a-z-]+:)*bg-\[#(?:24292e|1877f2|25d366|0a66c2|ff0000|000000)\](?![\w/-])/;

/** The smallest quoted span of `line` around `idx` — one className string, or one ternary branch of it. */
export function enclosingSpan(line, idx) {
  const isQ = (c) => c === "'" || c === '"' || c === '`';
  let a = idx; while (a > 0 && !isQ(line[a - 1])) a--;
  let b = idx; while (b < line.length && !isQ(line[b])) b++;
  return line.slice(a, b);
}

/**
 * Is the utility at `idx` on a solid brand fill? Three answers, because one is not enough:
 *   'yes'   — the fill is in the same quoted span (`'bg-indigo-600 text-white'`), the compat case.
 *   'no'    — no fill anywhere near it.
 *   'mixed' — the utility sits in a template literal's OUTER text and the fill is chosen by a ternary
 *             inside it (`\`text-white ${banned ? 'bg-emerald-600' : 'bg-rose-600'}\``). If EVERY
 *             branch that sets a background is a solid fill the text is white on all of them ('yes');
 *             if only some are, no single class is right for both branches, so it is left for a hand
 *             split rather than guessed.
 */
export function fillContext(line, idx, prevLine = '') {
  const span = enclosingSpan(line, idx);
  if (SOLID_FILL.test(span)) return 'yes';
  // A label directly INSIDE a filled box: `<div className="… bg-indigo-600 …">` on the line above and a
  // span with no background of its own on this one. The same-element rule cannot see a parent, and
  // this shape (an avatar badge, a count pill) is where the audit found white labels going dark.
  if (!/(?<![\w-])(?:[a-z-]+:)*bg-/.test(span) && /className=/.test(prevLine) && SOLID_FILL.test(prevLine)) return 'yes';
  const start = lineStart(line, idx);
  const bounded = line[start - 1] === '`' || line[start + span.length] === '`';
  if (!bounded) return 'no';
  const branches = [...line.matchAll(/'[^']*'|"[^"]*"/g)].map((m) => m[0].slice(1, -1)).filter((b) => /(?<![\w-])(?:[a-z-]+:)*bg-/.test(b));
  if (!branches.length) return 'no';
  if (branches.every((b) => SOLID_FILL.test(b))) return 'yes';
  return branches.some((b) => SOLID_FILL.test(b)) ? 'mixed' : 'no';
}
function lineStart(line, idx) {
  const isQ = (c) => c === "'" || c === '"' || c === '`';
  let a = idx; while (a > 0 && !isQ(line[a - 1])) a--;
  return a;
}

/**
 * The token for one literal utility (variant prefix already stripped), or null to leave it alone.
 * `kind` says which row it was, so the CLI can report how many pixels a run changed on purpose.
 */
export function mapToken(base, { onSolidFill = false } = {}) {
  const m = base.match(/^(text|bg|border(?:-[trblxy])?|divide|placeholder|ring|decoration|from|via|to)-(.+?)(?:\/(\d{1,3}))?$/);
  if (!m) return null;
  const [, prop, value, opacityRaw] = m;
  const opacity = opacityRaw === undefined ? null : Number(opacityRaw);
  const withOpacity = (v) => (opacity === null ? v : `${v}/${opacity}`);

  if (prop === 'text' || prop === 'placeholder') {
    if (value === 'white') {
      if (onSolidFill) return { token: `${prop}-on-accent`, kind: opacity === null ? 'exact' : 'fix' };
      // The faded-label idiom. `text-white/40` is 1.9–2.2:1 on every theme; `text-faint` clears 4.5.
      if (opacity === null) return { token: `${prop}-ink`, kind: 'exact' };
      if (opacity >= 70) return { token: `${prop}-body`, kind: 'fix' };
      if (opacity >= 45) return { token: `${prop}-muted`, kind: 'fix' };
      return { token: `${prop}-faint`, kind: 'fix' };
    }
    if (inSet(TEXT_BODY, value)) return { token: `${prop}-body`, kind: opacity === null ? 'exact' : 'fix' };
    if (inSet(TEXT_MUTED, value)) return { token: `${prop}-muted`, kind: opacity === null ? 'exact' : 'fix' };
    if (inSet(TEXT_FAINT, value)) return { token: `${prop}-faint`, kind: opacity === null ? 'exact' : 'fix' };
    if (inSet(TEXT_BODY_FIX, value)) return { token: `${prop}-body`, kind: 'fix' };
    if (inSet(TEXT_MUTED_FIX, value)) return { token: `${prop}-muted`, kind: 'fix' };
    if (inSet(TEXT_FAINT_FIX, value)) return { token: `${prop}-faint`, kind: 'fix' };
    if (HEX_BRAND[value]) return { token: `${prop}-${HEX_BRAND[value]}`, kind: 'fix' };
    const hue = value.match(/^([a-z]+)-(50|100|200|300|400|500)$/);
    if (hue && HUE_TOKEN[hue[1]]) return { token: `${prop}-${HUE_TOKEN[hue[1]]}`, kind: 'fix' }; // opacity dropped: it only lowers contrast
    return null;
  }
  if (prop === 'bg') {
    if (opacity === null) {
      if (inSet(BG_SURFACE, value)) return { token: 'bg-surface', kind: 'exact' };
      if (inSet(BG_CARD, value)) return { token: 'bg-card', kind: 'exact' };
      if (inSet(BG_RAISED, value)) return { token: 'bg-raised', kind: 'exact' };
      if (inSet(BG_FAINT, value)) return { token: 'bg-faint', kind: 'fix' };
      if (inSet(BG_SURFACE_FIX, value)) return { token: 'bg-surface', kind: 'fix' };
      if (inSet(BG_CARD_FIX, value)) return { token: 'bg-card', kind: 'fix' };
      if (inSet(BG_RAISED_FIX, value)) return { token: 'bg-raised', kind: 'fix' };
      return null; // bg-white / bg-black with no opacity are ambiguous (a toggle knob? a swatch?) — by hand
    }
    // Translucent dark chrome over dark chrome is invisible translucency (compat's own reasoning for the
    // -950 family): a solid token is a faithful remap when the wash is near-opaque, and a raised surface
    // when it is a lighter panel over the base.
    if (inSet(BG_SURFACE, value) || inSet(BG_SURFACE_FIX, value)) return { token: opacity >= 80 ? 'bg-surface' : 'bg-raised', kind: 'fix' };
    if (inSet(BG_CARD, value) || inSet(BG_CARD_FIX, value)) return { token: opacity >= 80 ? 'bg-card' : 'bg-raised', kind: 'fix' };
    if (inSet(BG_RAISED, value) || inSet(BG_RAISED_FIX, value)) return { token: 'bg-raised', kind: 'fix' };
    // A faint grey wash (`hover:bg-stone-500/15`) is the same lift as `bg-white/5`.
    if (/^(zinc|gray|neutral|stone|slate)-(400|500|600)$/.test(value) && opacity <= 30) return { token: 'bg-raised', kind: 'fix' };
    if (value === 'white') {
      if (opacity <= 30) return { token: 'bg-raised', kind: 'fix' }; // a subtle lift on dark; invisible on light
      if (opacity >= 80) return { token: 'bg-card', kind: 'fix' };
      return null;
    }
    if (value === 'black') {
      // ≤ 50 is an inset well inside a card; ≥ 60 is a modal scrim, which stays dark on every theme.
      return opacity <= 50 ? { token: 'bg-well', kind: 'fix' } : { token: 'bg-scrim', kind: 'fix' };
    }
    return null;
  }
  if (prop === 'from' || prop === 'via' || prop === 'to') {
    // A gradient that fades INTO the chrome (`from-emerald-900/40 to-[#161b22]`): the chrome stop follows
    // the theme, or on Light the card ends in a GitHub-dark corner with unreadable labels on it.
    if (inSet(BG_SURFACE, value) || inSet(BG_SURFACE_FIX, value)) return { token: `${prop}-surface`, kind: 'fix' };
    if (inSet(BG_CARD, value) || inSet(BG_CARD_FIX, value)) return { token: `${prop}-card`, kind: 'fix' };
    if (inSet(BG_RAISED, value) || inSet(BG_RAISED_FIX, value)) return { token: `${prop}-raised`, kind: 'fix' };
    return null; // a brand or white stop is a design choice — by hand
  }
  if (prop === 'decoration') {
    // `underline decoration-white/20 hover:decoration-white` — the underline follows the text it sits under.
    if (value === 'white') return { token: opacity === null ? 'decoration-ink' : 'decoration-line', kind: 'fix' };
    return null;
  }
  // border / border-x / divide / ring
  if (inSet(LINE, withOpacity(value))) return { token: `${prop}-line`, kind: 'exact' };
  if (inSet(LINE_FIX, value) || (opacity !== null && (inSet(LINE, value) || inSet(LINE_FIX, value)))) return { token: `${prop}-line`, kind: 'fix' };
  // `border-white/10` is a FIX row, not exact: compat's LAST rule for it is a 10% mix of --text-primary,
  // identical to --border-soft on dark and a near-identical light grey on light (the test says so).
  if (value === 'white' && opacity !== null && opacity <= 30) return { token: `${prop}-line`, kind: 'fix' };
  return null;
}

/** Rewrite one source. Returns the new text plus what changed and what was left, for the report. */
export function migrate(src) {
  const changed = {}; const left = {}; let exact = 0; let fix = 0;
  // Arbitrary-opacity forms first: `bg-white/[0.02]` is `bg-white` at 2%, and the LITERAL regex reads
  // only the `bg-white` part — mapping that alone would leave `bg-raised/[0.02]`, a 2% raised surface
  // nobody can see. Normalise to the percent form the table understands.
  const normalised = src.replace(/(?<![\w-])((?:[a-z-]+:)*(?:bg|text|border|divide)-(?:white|black))\/\[(0?\.\d+)\]/g,
    (_, cls, frac) => `${cls}/${Math.max(1, Math.round(Number(frac) * 100))}`);
  const lines = normalised.split('\n');
  const out = lines.map((line, i) => line.replace(LITERAL, (m, v1, v2, offset) => {
    const variant = v1 ?? v2 ?? '';
    const base = m.slice(variant.length);
    const ctx = /(?:text|placeholder)-white/.test(base) ? fillContext(line, offset, lines[i - 1] ?? '') : 'no';
    if (ctx === 'mixed') { left[`${m} (mixed fills in one template — split by hand)`] = (left[`${m} (mixed fills in one template — split by hand)`] || 0) + 1; return m; }
    const r = mapToken(base, { onSolidFill: ctx === 'yes' });
    if (!r) { left[m] = (left[m] || 0) + 1; return m; }
    const to = variant + r.token;
    const label = `${m} → ${to}`;
    changed[label] = (changed[label] || 0) + 1;
    if (r.kind === 'exact') exact++; else fix++;
    return to;
  })).join('\n');
  return { out, changed, left, exact, fix };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: node scripts/themeMigrate.mjs <file...> [--dry]'); process.exit(2); }
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const before = literalsIn(src).length;
    const { out, changed, left, exact, fix } = migrate(src);
    const after = literalsIn(out).length;
    console.log(`\n${f}: ${before} → ${after} literals (${exact} exact, ${fix} readability fixes)${dry ? ' [dry]' : ''}`);
    for (const [k, n] of Object.entries(changed).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
    const leftRows = Object.entries(left).sort((a, b) => b[1] - a[1]);
    if (leftRows.length) { console.log(`  left as-is (${leftRows.reduce((s, r) => s + r[1], 0)}):`); for (const [k, n] of leftRows) console.log(`  ${String(n).padStart(4)}  ${k}`); }
    if (!dry && out !== src) writeFileSync(f, out);
  }
}
