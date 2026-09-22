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
import { LITERAL, literalsIn, maskEmbeddedSources } from './themeColourBaseline.mjs';

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
/**
 * A `bg-[#hex]` that is NOT one of the chrome hexes the table maps to a surface token is a FIXED brand
 * fill — VS Code's status-bar blue `bg-[#007acc]`, a partner's colour — and the theme will never change
 * it, so white text on it must stay white. (Chrome hexes become `bg-card` etc. and are NOT fills.)
 */
const CHROME_HEX = new Set([...BG_SURFACE, ...BG_CARD, ...BG_RAISED, ...BG_SURFACE_FIX, ...BG_CARD_FIX, ...BG_RAISED_FIX, ...BG_FAINT].filter((v) => v.startsWith('[#')));
export function hasHexBrandFill(span) {
  for (const m of span.matchAll(/(?<![\w-])(?:[a-z-]+:)*bg-(\[#[0-9a-fA-F]{6}\])(?![\w/-])/g)) {
    if (!CHROME_HEX.has(m[1].toLowerCase())) return true;
  }
  return false;
}

/** WCAG relative luminance of a 6-digit hex. */
function hexLuminance(hex) {
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * A FIXED background — one the theme can never repaint — and which way its labels must go.
 *
 * `bg-black`, `bg-white` and a non-chrome `bg-[#hex]` are all fixed: `mapToken` already refuses to
 * map them, so the box keeps its colour on every theme. Everything NESTED inside such a box is
 * therefore fixed too, and that is the half this function exists for — a `text-white` deep inside a
 * `bg-black` Twitter-card mockup must stay white, not become `text-ink` and go near-black on Light.
 *
 * ⚠️ The DIRECTION is decided by the fill's own luminance, never assumed. White on Facebook's
 * `bg-[#f0f2f5]` is 1.1:1 — invisible. So a LIGHT fixed fill returns 'light', and the codemod then
 * leaves its labels alone rather than guessing a dark token inside somebody else's mockup.
 *
 * Brand-hue fills (`bg-indigo-600`, gradients — the SOLID_FILL set) are deliberately NOT judged here:
 * they keep the 'dark' verdict they have had since PR C, and the handful whose hue is genuinely light
 * (amber-500 and friends) are the separate, already-recorded `bg-success` fill-token item.
 */
export function fixedFill(span) {
  for (const m of span.matchAll(/(?<![\w-])(?:[a-z-]+:)*bg-(\[#([0-9a-fA-F]{6})\]|black|white)(?![\w/-])/g)) {
    const raw = m[1].toLowerCase();
    if (raw === 'black') return 'dark';
    if (raw === 'white') return 'light';
    if (CHROME_HEX.has(raw)) continue; // a chrome hex becomes a surface token — not a fixed fill
    // White text needs 4.5:1 against the fill to be a legitimate label colour.
    return 1.05 / (hexLuminance(m[2].toLowerCase()) + 0.05) >= 4.5 ? 'dark' : 'light';
  }
  return null;
}

/**
 * An inline `style={{ backgroundColor: brand }}` on the same line — a fill the theme never changes (a
 * white-label preview's buttons, a collaborator's avatar in their own colour). A `var(--…)` background
 * follows the theme and is NOT a fixed fill.
 */
export function hasInlineFill(line) {
  // The lookahead carries its own `\s*` so backtracking through the one before it cannot slip past `var(`.
  return /style=\{\{[^}]*\bbackground(?:Color)?\s*:(?!\s*['"`]?var\()/.test(line);
}

/**
 * The same inline background, but as a DIRECTION — and it opens a subtree, not just an element.
 * `style={{ background: '#12141c' }}` is a near-black panel the theme never repaints, so the labels
 * inside it must be fixed too; reading the `className` alone missed it and put `text-body` (near-black
 * on Light) on a near-black panel.
 *
 * An inline colour we cannot read (`backgroundColor: config.primaryColor` — the user's own brand)
 * stays 'dark', which is the behaviour PR G shipped and the crawl verified: white on a brand fill.
 */
export function inlineFillKind(line) {
  const m = line.match(/style=\{\{[^}]*\bbackground(?:Color)?\s*:\s*([^,}]+)/);
  if (!m) return null;
  const value = m[1].trim();
  if (/^['"`]?var\(/.test(value)) return null; // follows the theme
  const hex = value.match(/#([0-9a-fA-F]{6})/);
  if (!hex) return 'dark'; // an expression we cannot read — today's behaviour
  return 1.05 / (hexLuminance(hex[1].toLowerCase()) + 0.05) >= 4.5 ? 'dark' : 'light';
}

export function fillContext(line, idx, insideFill = null) {
  const span = enclosingSpan(line, idx);
  // A LIGHT fixed fill first: white on it is invisible, so neither the white nor the dark token is
  // ours to choose — the literal is left exactly as the author wrote it.
  const ownFill = fixedFill(span);
  if (ownFill === 'light') return 'fixed-light';
  const inlineKind = inlineFillKind(line);
  if (inlineKind === 'light') return 'fixed-light';
  if (ownFill === 'dark' || SOLID_FILL.test(span) || inlineKind === 'dark') return 'yes';
  // A label INSIDE a filled box — an element with no background of its own, nested (by indentation)
  // under an opener whose className carries a solid fill. The same-element rule cannot see a parent,
  // and this shape (an avatar badge, a status bar's labels) is where the audit found labels going dark.
  // ⚠️ A RESTING, OPAQUE background only. `hover:bg-emerald-500/10` paints nothing at rest, and a
  // translucent tint (`bg-amber-500/10`) lets the fixed box show straight through — in both cases the
  // element is still sitting on whatever encloses it. Reading either as "has its own background" is
  // what put a `text-ink` label on a fixed near-black dropdown and a `text-warn` strip on a fixed
  // near-black header, both invisible on Light.
  if (insideFill && !hasOwnOpaqueBackground(span)) return insideFill === 'light' ? 'fixed-light' : 'yes';
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
export function mapToken(base, { onSolidFill = false, fixedInkOnSameElement = false } = {}) {
  const m = base.match(/^(text|bg|border(?:-[trblxy])?|divide|placeholder|ring|decoration|from|via|to)-(.+?)(?:\/(\d{1,3}))?$/);
  if (!m) return null;
  const [, prop, value, opacityRaw] = m;
  const opacity = opacityRaw === undefined ? null : Number(opacityRaw);
  const withOpacity = (v) => (opacity === null ? v : `${v}/${opacity}`);

  if (prop === 'text' || prop === 'placeholder') {
    // On a SOLID fill (a brand button, VS Code's status-bar blue) every grey label is white: the fill
    // is fixed, the theme never changes it, and #8b949e on #007acc is 1.47:1 whichever theme is on.
    if (onSolidFill && value !== 'white' && [TEXT_BODY, TEXT_MUTED, TEXT_FAINT, TEXT_BODY_FIX, TEXT_MUTED_FIX, TEXT_FAINT_FIX].some((set) => inSet(set, value))) {
      return { token: `${prop}-on-accent`, kind: 'fix' };
    }
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
    // Same rule as the hue row below: on a FIXED fill the ink stays the literal the author chose
    // (Figma's `#a259ff` on its own dark purple chip), because neither half of the pair ever repaints.
    if (HEX_BRAND[value]) return onSolidFill ? null : { token: `${prop}-${HEX_BRAND[value]}`, kind: 'fix' };
    // 50–500: a LIGHT shade as text (unreadable on light). 600–700: a DARK shade as text (3.3:1 on dark).
    // The role token is the readable shade on every theme.
    const hue = value.match(/^([a-z]+)-(50|100|200|300|400|500|600|700)$/);
    if (hue && HUE_TOKEN[hue[1]]) {
      // On a FIXED fill the box never changes, so the ink must not either: `text-amber-400` on a
      // near-black panel reads on every theme, while `text-warn` goes dark-amber on Light — 2.59:1.
      if (onSolidFill) return null;
      return { token: `${prop}-${HUE_TOKEN[hue[1]]}`, kind: 'fix' }; // opacity dropped: it only lowers contrast
    }
    return null;
  }
  if (prop === 'bg' && fixedInkOnSameElement) {
    // The element carries a FIXED hex text colour the table cannot map (a code block's syntax blue).
    // Theming the background under it is what makes the pair unreadable — `bg-surface` is near-white
    // on Light and `#a5d6ff` is a pale blue: 1.47:1. Neither half is ours to guess, so both stay.
    return null;
  }
  if (prop === 'bg') {
    // A dark tint (`bg-emerald-900/30`) is a wash on dark and a mid-dark smear on light; the 500 shade at
    // 10% is a tint on both. Only brand hues — a grey 900 is chrome and handled above.
    // Past 60% a dark tint is an opaque PANEL (an error overlay with white text), not a wash — by hand.
    const dark = value.match(/^([a-z]+)-(800|900|950)$/);
    if (dark && HUE_TOKEN[dark[1]] && opacity !== null && opacity <= 60) return { token: `bg-${dark[1]}-500/10`, kind: 'fix' };
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

/**
 * For each line, is it nested under an element whose className carries a SOLID fill? Formatted JSX
 * nests by indentation, so an opener at indent k that is not closed on its own line owns every deeper
 * line until the next line at indent ≤ k. Only the opener's OWN className span is judged (a fill in a
 * ternary branch elsewhere on the line does not count), so this cannot over-reach.
 */
/**
 * A gradient that is a WASH, not a fill: any stop that is translucent (`to-black/30`) or already a theme
 * token (`from-raised`) means the page's own surface shows through, so the labels on top are themed
 * normally. This repo is full of such wrappers — a 1px gradient border around a `bg-surface` card, a
 * tinted panel over the page — and treating them as fixed fills would paint their labels white.
 */
function gradientIsWash(span) {
  if (!/(?<![\w-])(?:[a-z-]+:)*bg-gradient-/.test(span)) return false;
  return /(?<![\w-])(?:from|via|to)-(?:\[?#?[\w.]*\]?-?\d{2,3}\/\d{1,3}|surface|card|raised|well|line|ink|body|muted|faint|transparent)(?![\w-])/.test(span)
    || /(?<![\w-])(?:from|via|to)-\w+-\d{2,3}\/\d{1,3}(?![\w-])/.test(span);
}

/**
 * Does this element paint a surface of its OWN? Only a resting, opaque background does: a variant
 * prefix means it is not painted at rest, and an opacity under 80% means the surface beneath still
 * shows through and still decides what is readable on top.
 */
export function hasOwnOpaqueBackground(span) {
  // ⚠️ The value class MUST carry `-`: a Tailwind colour is `amber-500`, and a class without it
  // matched only `amber`, failed the trailing lookahead on the hyphen, and returned false for EVERY
  // hyphenated background — which made this helper right about tints purely by accident.
  for (const m of span.matchAll(/(?<![\w-])((?:[a-z-]+:)*)bg-([\w[\]#.-]+)(?:\/(\d{1,3}))?(?![\w/-])/g)) {
    if (m[1]) continue;                       // hover:, focus:, md: — not the resting state
    if (m[2] === 'gradient' || m[2].startsWith('gradient-')) continue;
    if (m[3] !== undefined && Number(m[3]) < 80) continue; // a tint, not a surface
    return true;
  }
  return false;
}

/** A themed surface the element declares for ITSELF — it ends any fixed subtree it sits in. */
function declaresThemedSurface(span) {
  return /(?<![\w-])(?:[a-z-]+:)*bg-(?:surface|card|raised|well)(?![\w-])/.test(span);
}

export function fillScopes(lines) {
  const stack = []; // { indent, kind: 'dark' | 'light' | null }  — null ends a fixed subtree
  return lines.map((line) => {
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (trimmed !== '') while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const inside = stack.length ? stack[stack.length - 1].kind : null;
    const at = line.indexOf('className=');
    if (trimmed !== '' && at >= 0 && !/<\/\w+>\s*$/.test(trimmed) && !/\/>\s*$/.test(trimmed)) {
      const span = enclosingSpan(line, at + 'className="'.length);
      const fixed = fixedFill(span) || inlineFillKind(line);
      // Its own themed surface wins: the children sit on THAT, whatever encloses it.
      if (declaresThemedSurface(span) && !fixed) stack.push({ indent, kind: null });
      else if (fixed) stack.push({ indent, kind: fixed });
      else if (SOLID_FILL.test(span) && !gradientIsWash(span)) stack.push({ indent, kind: 'dark' });
    }
    return inside;
  });
}

/** Rewrite one source. Returns the new text plus what changed and what was left, for the report. */
// ── INLINE STYLE COLOURS — `style={{ color: '#818cf8' }}` ────────────────────────────────────────
//
// 🔴 WHY THIS EXISTS, AND WHY IT IS THE WHOLE REMAINING TAIL. The table above covers Tailwind
// utilities — the ones `theme-compat.css` was at least REMAPPING per theme. An inline style was
// remapped by NOTHING: CSS cannot override it, which is why the census already counts it double as
// a smell. `color: 'rgba(255,255,255,0.4)'` is white-at-40% on Light exactly as on Dark — 1.1:1,
// one of the 236 invisible nodes the audit measured. After PR C–K the literals still standing are
// almost entirely this shape, and the codemod could not see a single one of them.
//
// ⚠️ THE TWO ROW KINDS MEAN SOMETHING SLIGHTLY DIFFERENT HERE, and it is stated rather than blurred:
// there is no compat layer for an inline style to be identical to, so
//   exact — the literal IS the dark palette's own value for that role, byte for byte. Dark renders
//           identically; LIGHT is repaired. That is the entire point of the row.
//   fix   — the literal is NEAR a role without equalling it (a lighter brand shade, a white alpha).
//           Dark shifts a little too, on purpose, toward the role it was imitating.
// `tests/themeMigrate.test.ts` proves every `exact` row against `index.css`'s own dark block, so a
// palette change that invalidates a row fails CI instead of silently repainting Dark.
//
// 🔒 THE CLASSIFICATION IS NOT RE-STATED — it is DERIVED from the class tables above. `#8b949e` must
// mean `--text-muted` whether it arrives as `text-[#8b949e]` or as `color: '#8b949e'`; two hand-kept
// lists of the same hexes is exactly how the two syntaxes would come to disagree.

/** `[#c9d1d9]` rows of a class set → `{ '#c9d1d9': '--text-body' }`. Tailwind names have no inline form. */
const hexRows = (set, varName) => Object.fromEntries(
  set.filter((v) => v.startsWith('[#')).map((v) => [v.slice(1, -1).toLowerCase(), varName]),
);

/** Canonical form, so one colour has one key: `white`/`#FFF`/`#ffffff` are the same colour. */
export function normaliseColour(raw) {
  let v = String(raw).trim().toLowerCase();
  if (v === 'white') v = '#ffffff';
  if (v === 'black') v = '#000000';
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  if (/^rgba?\(/.test(v)) v = v.replace(/\s+/g, '');
  return v;
}

function rgbaParts(v) {
  const m = v.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : Number(m[4]) } : null;
}

/**
 * The DARK palette's own value for each role, read off `index.css`'s `:root, html[data-theme="dark"]`
 * block — and asserted against that block by `tests/themeMigrate.test.ts`, so a palette change that
 * invalidates a row fails CI rather than silently repainting Dark.
 *
 * 🔴 THIS EXISTS BECAUSE `exact` HAD TO BECOME A MEASUREMENT, NOT A CLAIM. The first version of this
 * pass inherited `exact` from the class tables above, where it means "the compat layer already remaps
 * this literal to that variable". For an inline style there IS no compat layer, so that inheritance
 * would have labelled `color: '#e6edf3'` → `var(--text-body)` as pixel-identical when Dark's
 * `--text-body` is `#c9d1d9` — a visible change reported as no change at all. The kind is now derived
 * by comparing the literal with the value below, so the label cannot disagree with the pixels.
 */
export const DARK_VALUE = {
  '--text-primary': '#ffffff', '--text-body': '#c9d1d9', '--text-muted': '#8b949e', '--text-faint': '#838d97',
  '--border-soft': 'rgba(255, 255, 255, 0.1)',
  '--surface-base': '#0d1117', '--surface-card': '#161b22', '--surface-raised': '#21262d',
  '--surface-raised-hover': '#191c22', '--surface-well': 'rgba(0, 0, 0, 0.3)',
  '--surface-well-hover': 'rgba(0, 0, 0, 0.45)', '--scrim': 'rgba(0, 0, 0, 0.7)',
  '--accent': '#818cf8', '--brand-accent-text': '#a5b4fc', '--brand-accent-strong': '#818cf8',
  '--brand-success-text': '#34d399', '--brand-success-strong': '#6ee7b7',
  '--brand-warn-text': '#fcd34d', '--brand-warn-strong': '#fbbf24',
  '--brand-danger-text': '#f87171', '--brand-info-text': '#7dd3fc',
};

/** `exact` iff the literal IS this role's dark value: Dark renders identically, Light is repaired. */
const hit = (value, varName) => ({
  varName,
  kind: normaliseColour(DARK_VALUE[varName] ?? '\u0000') === value ? 'exact' : 'fix',
});

/**
 * ONE map per ROLE — the classification is derived from the class tables above wherever they already
 * decided what a hex means, so `#8b949e` cannot mean `--text-muted` as a class and something else as
 * an inline style. Only the rows the class table never needed (a hex form of a shade it maps by NAME)
 * are written out here.
 */
export const INLINE_TEXT = {
  ...hexRows(TEXT_BODY, '--text-body'), ...hexRows(TEXT_MUTED, '--text-muted'),
  ...hexRows(TEXT_FAINT, '--text-faint'), ...hexRows(TEXT_BODY_FIX, '--text-body'),
  ...hexRows(TEXT_MUTED_FIX, '--text-muted'), ...hexRows(TEXT_FAINT_FIX, '--text-faint'),
  ...Object.fromEntries(Object.entries(HEX_BRAND).map(([k, t]) => [k.slice(1, -1).toLowerCase(), TOKEN_VAR[t]])),
  '#ffffff': '--text-primary',
  '#818cf8': '--brand-accent-strong', '#a5b4fc': '--brand-accent-text', '#6366f1': '--brand-accent-strong',
  '#4f46e5': '--brand-accent-strong', '#a78bfa': '--brand-accent-text',
  '#34d399': '--brand-success-text', '#6ee7b7': '--brand-success-strong', '#22c55e': '--brand-success-text',
  '#86efac': '--brand-success-text', '#7ee787': '--brand-success-text', '#4ade80': '--brand-success-text',
  '#fcd34d': '--brand-warn-text', '#fbbf24': '--brand-warn-strong', '#f59e0b': '--brand-warn-text',
  '#fde68a': '--brand-warn-text',
  '#f87171': '--brand-danger-text', '#ef4444': '--brand-danger-text', '#fca5a5': '--brand-danger-text',
  '#7dd3fc': '--brand-info-text', '#3b82f6': '--brand-info-text', '#93c5fd': '--brand-info-text',
  '#a5f3fc': '--brand-info-text',
};
export const INLINE_LINE = {
  'rgba(255,255,255,0.1)': '--border-soft',
  ...hexRows(LINE, '--border-soft'), ...hexRows(LINE_FIX, '--border-soft'),
};
export const INLINE_BG = {
  ...hexRows(BG_SURFACE, '--surface-base'), ...hexRows(BG_CARD, '--surface-card'),
  ...hexRows(BG_RAISED, '--surface-raised'), ...hexRows(BG_SURFACE_FIX, '--surface-base'),
  ...hexRows(BG_CARD_FIX, '--surface-card'), ...hexRows(BG_RAISED_FIX, '--surface-raised'),
  'rgba(0,0,0,0.7)': '--scrim', 'rgba(0,0,0,0.3)': '--surface-well', 'rgba(0,0,0,0.45)': '--surface-well-hover',
};
/**
 * Solid brand fills — LEFT EXACTLY AS WRITTEN, and the reason is TRAP 3 of
 * `tests/inlineThemeColours.test.ts` (2026-08-16), which this pass must not relitigate: *"a label on
 * an indigo button must keep its white, or the sweep would have put dark text on a dark-blue button."*
 * Theming the FILL is not free either — white on Dark's `--accent` (#818cf8) is 3.0:1 against 5.6:1
 * on #4f46e5, so "follow the theme" would have LOWERED contrast on the theme most users are in.
 * So a brand fill counts as FIXED: its background stays, and its label stays.
 */
export const INLINE_ACCENT_FILL = new Set(['#818cf8', '#4f46e5', '#6366f1']);

const TEXT_PROPS = new Set(['color', 'caretColor', 'fill', 'stroke']);
const LINE_PROPS = new Set(['borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor']);
const BG_PROPS = new Set(['background', 'backgroundColor']);

/**
 * What the element's own inline background is, for the ONE question that matters: may the text on it
 * be themed?
 *
 *   'themed' — a value this pass turns into a surface token, so the text must follow the theme too.
 *   'wash'   — a tint under 50%: whatever encloses it shows through, so it is not a background.
 *   'fixed'  — an opaque colour, or an expression we cannot read (a user's own brand). The theme can
 *              never repaint it, so a white label on it must STAY white. That is the same verdict
 *              `inlineFillKind` already gives the class pass, applied to the inline props.
 */
export function inlineBackgroundKind(scope) {
  const m = scope.match(/\bbackground(?:Color)?\s*:\s*(['"])([^'"\n]*)\1/);
  if (!m) return /\bbackground(?:Color)?\s*:(?!\s*['"`]?var\()/.test(scope) ? 'fixed' : 'none';
  const v = normaliseColour(m[2]);
  if (INLINE_ACCENT_FILL.has(v)) return 'fixed';
  if (v in INLINE_BG) return 'themed';
  const p = rgbaParts(v);
  if (p && p.a < 0.5) return 'wash';
  if (/^#[0-9a-f]{6}$/.test(v) || (p && p.a >= 0.5)) return 'fixed';
  return 'none';
}

/**
 * The `style={{ … }}` objects of a source, as [start, end) offsets.
 *
 * 🔴 THIS IS NOT A REFINEMENT — IT IS THE FIX FOR A REGRESSION THIS PASS ACTUALLY PRODUCED, caught in
 * its own diff before it left the branch. The first version asked "what is the background on this
 * LINE?", and a style object is routinely written over several:
 *
 *     style={{
 *       background: '#4f46e5',
 *       color: 'white',
 *     }}
 *
 * The `color` line carries no background, so the guard saw none, and `white` became `--text-primary`
 * — near-black on Light, sitting on an indigo fill at about 2.2:1. That is precisely the invisible
 * label this whole migration exists to remove, re-created by the tool removing it. A declaration's
 * context is its OBJECT, never its line.
 */
export function styleObjectSpans(src) {
  const spans = [];
  for (let i = src.indexOf('style={{'); i !== -1; i = src.indexOf('style={{', i + 1)) {
    let depth = 0;
    for (let j = i + 6; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { spans.push([i, j + 1]); i = j; break; } }
    }
  }
  return spans;
}

/**
 * The palette variable for one inline declaration, or null to leave it exactly as written.
 *
 * ⚠️ A WHITE ALPHA IS THE DEFECT ITSELF, so it is a ladder rather than a lookup: `rgba(255,255,255,α)`
 * was the old dark UI's way of writing "less important text", and every rung of it is invisible on
 * Light. The α bands below are that intent, translated into the roles that mean it on every theme.
 * ⚠️ A LOW-ALPHA BACKGROUND IS LEFT ALONE, deliberately: a 5% white wash on Light is merely invisible,
 * not unreadable, and a wrong surface guess is a change a reader can SEE. Nothing is guessed — it is
 * reported and left, exactly as the class table treats a literal it has no row for.
 */
export function inlineColourToken(prop, raw, backgroundKind = 'none') {
  const v = normaliseColour(raw);
  if (v.startsWith('var(')) return null;
  const p = rgbaParts(v);
  const whiteAlpha = p && p.r === 255 && p.g === 255 && p.b === 255 && p.a < 1;
  if (TEXT_PROPS.has(prop)) {
    // ON A SOLID ACCENT FILL THE LABEL IS `--on-accent`, which is white on every theme. Reading
    // it as "white text" and mapping it to `--text-primary` is what put a near-black label on an
    // indigo button; leaving it as the literal `white` would be right on the pixels and wrong on the
    // ratchet, since the token is how the census tells "white by design" from "white because the app
    // was dark". A NON-white label on an accent fill is the author's own choice and is left alone.
    if (v in INLINE_TEXT) return hit(v, INLINE_TEXT[v]);
    if (whiteAlpha) {
      if (p.a >= 0.8) return hit(v, '--text-primary');
      if (p.a >= 0.55) return hit(v, '--text-body');
      if (p.a >= 0.35) return hit(v, '--text-muted');
      return hit(v, '--text-faint');
    }
    return null;
  }
  if (LINE_PROPS.has(prop)) {
    if (v in INLINE_LINE) return hit(v, INLINE_LINE[v]);
    // A BRAND-COLOURED RULE IS NOT A DIVIDER. `borderLeftColor: '#ef4444'` is the red stripe down the
    // side of an error row — it carries the meaning, so it takes the danger token. Mapping it to the
    // divider colour would be a readability fix that deleted the information.
    const brand = INLINE_TEXT[v];
    if (brand && brand.startsWith('--brand-')) return hit(v, brand);
    if (whiteAlpha && p.a <= 0.25) return hit(v, '--border-soft');
    return null;
  }
  if (BG_PROPS.has(prop)) {
    if (v in INLINE_BG) return hit(v, INLINE_BG[v]);
    if (p && p.r === 0 && p.g === 0 && p.b === 0) {
      if (p.a >= 0.6) return hit(v, '--scrim');
      if (p.a >= 0.35) return hit(v, '--surface-well-hover');
      if (p.a >= 0.15) return hit(v, '--surface-well');
    }
    return null;
  }
  return null;
}

const INLINE_DECL = new RegExp(
  '\\b(color|caretColor|fill|stroke|background|backgroundColor|borderColor|borderTopColor'
  + '|borderRightColor|borderBottomColor|borderLeftColor|outlineColor)\\s*:\\s*'
  + "(['\"])(#[0-9a-fA-F]{3,8}|rgba?\\([^)'\"\\n]*\\)|white|black)\\2",
  'g',
);

/**
 * FILES THE INLINE PASS MUST NOT TOUCH — excluded BY NAME, never by a loose pattern, because (in that
 * suite's own words) *"an exception that is not named is an exception nobody can tell from an
 * oversight"*. Each was already decided by the 2026-08-16 sweep, and this pass re-states it rather
 * than rediscovering the same two traps the hard way.
 */
export const INLINE_SKIP = {
  'ShellTerminal.tsx': 'TRAP 1 — xterm parses colours itself and cannot read var(); a library config is not a DOM style.',
  'MultiPageBuilder.tsx': "TRAP 2 — exports colours into the USER'S app, where our variables do not exist.",
  'DarkModeGenerator.tsx': "TRAP 2 — generates a theme for the USER'S app.",
  'WhitelabelBranding.tsx': "TRAP 2 — the user's own brand colours.",
  // —— added 2026-09-21, after the full sweep left them at 100% and nothing said why ——
  'previewUtils.ts': "TRAP 2 — a CSS string injected into the PREVIEW IFRAME, which is the user's app document; our var(--…) tokens do not exist there.",
  'SEOOptimizer.tsx': 'THIRD-PARTY PREVIEW — Google\'s and Facebook\'s own result/card colours (#1a0dab, #006621, #f0f2f5). Repainting them would make the mockup stop looking like the thing it is mocking.',
  'frameworkOptions.ts': "BRAND CATALOGUE — each framework's OWN colour (#61DAFB React, #FF3E00 Svelte, #E34F26 HTML5). Theming them would make a logo's colour follow the user's theme.",
  // 🔴 A STATUS DOT IS NOT A SURFACE, and this one produced a real regression before it was caught.
  // The sweep turned the neutral dot's `bg-zinc-600` into `bg-raised` — a SURFACE token, so the dot
  // took the colour of the card it sits on and all but disappeared — `bg-zinc-500` into `bg-faint`
  // (a TEXT token used as a background), and added `text-on-accent` to elements that carry no text.
  // CLAUDE.md names this file's class by example: *"a status dot whose `bg-emerald-500` a test
  // names … must not be migrated as a side effect."* A semantic swatch needs a hand decision.
  'agentV3History.ts': 'SEMANTIC SWATCH — status DOTS, not surfaces. The table maps a dot\'s `bg-*` to surface tokens, which makes the neutral dot invisible on the card it sits on.',
};
export const inlineSkipReason = (file) => INLINE_SKIP[String(file).split('/').pop()] ?? null;

/**
 * The JSX element a declaration sits in — its opening tag, from `<` to the matching `>`.
 *
 * 🔴 WHY THE OBJECT IS STILL NOT ENOUGH. `styleObjectSpans` fixed "the background is on another
 * LINE"; this fixes "the background is not inline at all". `AuthComponent`'s Apple button carries
 * `className="… bg-black … text-on-accent …"` and, beside it, an inline `color: '#ffffff'` whose own
 * comment says it exists to be unthemeable: *"Force white text + icon inline so the label is readable
 * no matter what theme/global CSS is applied"*. The inline guard saw no inline background, themed it,
 * and broke TRAP 3 of `tests/inlineThemeColours.test.ts`. A fill is a fill whether it is written as a
 * style or as a class.
 */
export function elementAt(src, offset) {
  let a = src.lastIndexOf('<', offset);
  if (a === -1) return src.slice(Math.max(0, offset - 400), offset + 400);
  let depth = 0;
  for (let j = a; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth <= 0) return src.slice(a, j + 1);
  }
  return src.slice(a);
}

/**
 * Does this element already fix its own text colour? A solid or fixed CLASS fill, or an explicit
 * `text-on-accent`, both mean the author decided the label — so an inline colour beside it is a
 * deliberate override and is left exactly as written.
 */
export function elementFixesItsLabel(element) {
  return fixedFill(element) !== null || SOLID_FILL.test(element) || /(?<![\w-])text-on-accent(?![\w-])/.test(element);
}

/** The inline pass. Runs BEFORE the class pass so the class pass masks the source it actually edits. */
export function migrateInlineStyles(src, changed, left) {
  let exact = 0; let fix = 0;
  const masked = maskEmbeddedSources(src);            // same length: offsets line up
  const spans = styleObjectSpans(src);
  /** The style object a declaration sits in — its real context (see `styleObjectSpans`). */
  const scopeAt = (offset) => {
    const s2 = spans.find(([from, to]) => offset >= from && offset < to);
    return s2 ? src.slice(s2[0], s2[1]) : src.slice(src.lastIndexOf('\n', offset) + 1, src.indexOf('\n', offset) + 1 || undefined);
  };
  const out = src.replace(INLINE_DECL, (m, prop, q, value, offset) => {
    if (masked.slice(offset, offset + m.length) !== m) return m; // somebody else's app — never touched
    const bg = TEXT_PROPS.has(prop)
      ? (elementFixesItsLabel(elementAt(src, offset)) ? 'fixed' : inlineBackgroundKind(scopeAt(offset)))
      : 'none';
    if (bg === 'fixed') {
      const key = `${prop}: ${value} (on a fixed inline fill — somebody else's surface, by hand)`;
      left[key] = (left[key] || 0) + 1;
      return m;
    }
    const r = inlineColourToken(prop, value, bg);
    if (!r) { const k = `${prop}: ${value}`; left[k] = (left[k] || 0) + 1; return m; }
    if (r.kind === 'exact') exact++; else fix++;
    changed[`${prop}: ${value} → var(${r.varName})`] = (changed[`${prop}: ${value} → var(${r.varName})`] || 0) + 1;
    return `${prop}: ${q}var(${r.varName})${q}`;
  });
  return { out, exact, fix };
}

/**
 * The inline pass alone, in `migrate`'s shape.
 *
 * WHY IT EXISTS: the class sweep and the inline sweep touch different literals and collide with
 * different pinned tests, so mixing them in one change makes the diff unreviewable and the failures
 * indistinguishable. A file whose class literals an earlier PR deliberately left — a status dot whose
 * `bg-emerald-500` a test names, an exit dialog's `bg-white/10` — must not be migrated as a side
 * effect of fixing its inline styles.
 */
export function inlineOnlyRun(src) {
  const changed = {}; const left = {};
  const { out, exact, fix } = migrateInlineStyles(src, changed, left);
  return { out, changed, left, exact, fix };
}

export function migrate(src) {
  const changed = {}; const left = {}; let exact = 0; let fix = 0;
  // Arbitrary-opacity forms first: `bg-white/[0.02]` is `bg-white` at 2%, and the LITERAL regex reads
  // only the `bg-white` part — mapping that alone would leave `bg-raised/[0.02]`, a 2% raised surface
  // nobody can see. Normalise to the percent form the table understands.
  const normalised = src.replace(/(?<![\w-])((?:[a-z-]+:)*(?:bg|text|border|divide)-(?:white|black))\/\[(0?\.\d+)\]/g,
    (_, cls, frac) => `${cls}/${Math.max(1, Math.round(Number(frac) * 100))}`);
  // Embedded source (a starter project, a copyable snippet) is somebody else's app: masked here so
  // no literal inside it is ever rewritten, and the real lines are restored below from `lines`.
  // The INLINE pass runs first and hands its output to the class pass, so the class pass computes its
  // own mask over the text it is actually editing — offsets from a stale mask are how a rewrite lands
  // inside somebody else's starter project.
  const inlined = migrateInlineStyles(normalised, changed, left);
  exact += inlined.exact; fix += inlined.fix;
  const lines = inlined.out.split('\n');
  const masked = maskEmbeddedSources(inlined.out).split('\n');
  const insideFill = fillScopes(masked);
  // LITERAL has one variant-prefix capture per alternative (grey/hex, hue text, dark tint): the callback
  // receives all of them before `offset`, so the arity here must follow the regex.
  const out = lines.map((line, i) => line.replace(LITERAL, (m, v1, v2, v3, offset) => {
    // Inside an embedded-source span the masked line holds spaces where the match is: leave it alone.
    if (masked[i].slice(offset, offset + m.length) !== m) return m;
    return rewrite(line, i, m, v1 ?? v2 ?? v3 ?? '', offset);
  }));
  function rewrite(line, i, m, variant, offset) {
    const base = m.slice(variant.length);
    const ctx = /^(?:text|placeholder)-/.test(base) ? fillContext(line, offset, insideFill[i]) : 'no';
    if (ctx === 'mixed') { left[`${m} (mixed fills in one template — split by hand)`] = (left[`${m} (mixed fills in one template — split by hand)`] || 0) + 1; return m; }
    if (ctx === 'fixed-light') { left[`${m} (inside a LIGHT fixed fill — somebody else's surface, by hand)`] = (left[`${m} (inside a LIGHT fixed fill — somebody else's surface, by hand)`] || 0) + 1; return m; }
    // A fixed hex TEXT colour on this same element that the table has no row for.
    const span = enclosingSpan(line, offset);
    const fixedInk = [...span.matchAll(/(?<![\w-])(?:[a-z-]+:)*text-(\[#[0-9a-fA-F]{6}\])(?![\w/-])/g)]
      .some((h) => mapToken(`text-${h[1]}`) === null);
    const r = mapToken(base, { onSolidFill: ctx === 'yes', fixedInkOnSameElement: fixedInk });
    if (!r) { left[m] = (left[m] || 0) + 1; return m; }
    const to = variant + r.token;
    const label = `${m} → ${to}`;
    changed[label] = (changed[label] || 0) + 1;
    if (r.kind === 'exact') exact++; else fix++;
    return to;
  }
  // A solid fill with NO text colour of its own inherits the page's `text-body` — which was white on the
  // old dark UI and is near-black on Light: "Download YAML" on `bg-violet-600` read at 3.0:1. The label
  // on a fixed fill is `text-on-accent`, stated on the element so nothing depends on what it inherits.
  // Only a RESTING, unprefixed fill counts (a `hover:bg-indigo-600` on a flat button must not pin white
  // text for the resting state), and gradient TEXT (`bg-clip-text`) is not a fill at all.
  const RESTING_FILL = /(?<![\w:-])bg-(?:indigo|blue|emerald|green|red|rose|purple|violet|fuchsia|amber|orange|teal|cyan|pink|sky)-(?:500|600|700)(?:\/(?:[6-9]\d|100))?(?![\w/-])|(?<![\w:-])bg-gradient-|(?<![\w:-])bg-\[#(?!(?:0d1117|161b22|21262d|30363d|0d1520|1c2128|1c2732|1e1e1e|252526|111827|0f172a)\])[0-9a-fA-F]{6}\](?![\w/-])/;
  const HAS_TEXT_COLOUR = /(?<![\w-])(?:[a-z-]+:)*text-(?:on-accent|ink|body|muted|faint|accent-text|success|warn|danger|info|white|black|transparent|current|inherit|[a-z]+-\d{2,3}|\[#)/;
  const INHERITED_LABEL = '(label inherits its colour on a solid fill) + text-on-accent';
  for (let i = 0; i < out.length; i++) {
    const m2 = maskEmbeddedSources(out[i]); // same length as out[i]: offsets line up
    out[i] = out[i].replace(/'[^'\n]*'|"[^"\n]*"/g, (q, offset) => {
      if (m2.slice(offset, offset + q.length) !== q) return q; // embedded source — never touched
      const body = q.slice(1, -1);
      if (!RESTING_FILL.test(body) || HAS_TEXT_COLOUR.test(body) || /bg-clip-text/.test(body)) return q;
      if (fixedFill(body) === 'light') return q; // white on a light fixed fill is invisible — never stamped
      if (!/(?:^|\s)(?:[a-z-]+:)*(?:bg|text|rounded|px|py|p|flex|w|h|border|font|shadow|inline|block)[\w-]*(?:\s|$)/.test(body)) return q; // not a class list
      changed[INHERITED_LABEL] = (changed[INHERITED_LABEL] || 0) + 1; fix++;
      return `${q[0]}${body} text-on-accent${q[0]}`;
    });
  }
  // A HOVER TO THE SURFACE IT ALREADY HAS IS NOT A HOVER (PR #3095's guard, tests/hoverIsNotANoOp.test.ts).
  // `bg-white/5` and `bg-white/10` both map to `bg-raised`, so a chip written as
  // `bg-white/5 hover:bg-white/10` came out as `bg-raised hover:bg-raised` — pixel-identical on rest and
  // hover, i.e. a control that no longer answers the pointer. Nine of those were fixed by hand in PR J;
  // the codemod must not keep producing them. Where a class list rests on a themed surface and hovers to
  // the SAME one, the hover moves to that surface's `-hover` token, which every theme declares as a real
  // step away from the resting value.
  // 📱 `active:` IS THE ONLY FEEDBACK A PHONE HAS, so it joined this pass on 2026-09-19 (admin's Code
  // Studio screenshot). A finger never hovers: `bg-raised active:bg-raised` on the mobile editor
  // toolbar meant the button did not answer a tap at all, and this codemod had emitted it — the same
  // collapsed mapping the comment above describes, one variant over, invisible to the guard that
  // caught the first one because that guard only read `hover:`.
  const DEAD_HOVER_LABEL = 'hover/press to the surface it already has → its -hover token';
  for (let i = 0; i < out.length; i++) {
    const m3 = maskEmbeddedSources(out[i]);
    out[i] = out[i].replace(/'[^'\n]*'|"[^"\n]*"/g, (q, offset) => {
      if (m3.slice(offset, offset + q.length) !== q) return q;
      let body = q.slice(1, -1);
      for (const surface of ['raised', 'well']) {
        const resting = new RegExp(`(?<![\\w:-])bg-${surface}(?![\\w/-])`);
        const dead = new RegExp(`(?<![\\w-])((?:group-)?hover:|active:)bg-${surface}(?![\\w/-])`, 'g');
        if (resting.test(body) && dead.test(body)) {
          body = body.replace(dead, (_, v) => `${v}bg-${surface}-hover`);
          changed[DEAD_HOVER_LABEL] = (changed[DEAD_HOVER_LABEL] || 0) + 1; fix++;
        }
      }
      return `${q[0]}${body}${q[0]}`;
    });
  }
  return { out: out.join('\n'), changed, left, exact, fix };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: node scripts/themeMigrate.mjs <file...> [--dry]'); process.exit(2); }
  const inlineOnly = args.includes('--inline-only');
  for (const f of files) {
    const skip = inlineSkipReason(f);
    if (skip) { console.log(`\n${f}: SKIPPED — ${skip}`); continue; }
    const src = readFileSync(f, 'utf8');
    const before = literalsIn(src).length;
    const { out, changed, left, exact, fix } = inlineOnly ? inlineOnlyRun(src) : migrate(src);
    const after = literalsIn(out).length;
    console.log(`\n${f}: ${before} → ${after} literals (${exact} exact, ${fix} readability fixes)${dry ? ' [dry]' : ''}`);
    for (const [k, n] of Object.entries(changed).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
    const leftRows = Object.entries(left).sort((a, b) => b[1] - a[1]);
    if (leftRows.length) { console.log(`  left as-is (${leftRows.reduce((s, r) => s + r[1], 0)}):`); for (const [k, n] of leftRows) console.log(`  ${String(n).padStart(4)}  ${k}`); }
    if (!dry && out !== src) writeFileSync(f, out);
  }
}
