// THE APP'S OWN MARK — what an app gets as its logo when its owner has not chosen one (admin 2026-10-21).
//
// The rule, in the admin's words: a chosen logo first; otherwise a Lucide symbol that fits the app's name; otherwise the
// first letter of its name — "like the many websites that pick one of A…Z when you have no profile picture". NEVER Capacitor's
// icon, never the platform's, never a stale one. No AI image is generated: if the owner wants a picture they make or upload it.
//
// ONE function decides (chooseMark) and ONE function draws (markSvg), so the web app's install icon, the Android and iOS
// launcher icons and the splash screen are the same mark by construction. Pure and client-safe: no Node imports, no React,
// no network — it runs on the server, in the browser and (as a ready-made SVG the server writes) on a GitHub runner.
import { BRAND_GENERIC_GLYPHS, BRAND_GLYPHS, BRAND_GLYPH_KEYWORDS } from './brandGlyphs.generated';

export type BrandMark =
  | { kind: 'glyph'; glyph: string; generic: boolean; hue: number; hue2: number }
  | { kind: 'letter'; letter: string; hue: number; hue2: number };

/** Monoline letters and digits on Lucide's own 24x24 grid, stroke 2, round caps — drawn here, so no font is ever needed. */
export const LETTER_PATHS: Readonly<Record<string, string>> = {
  A: 'M6 20L12 4L18 20M8.5 14H15.5',
  B: 'M7 4v16M7 4h6a4 4 0 0 1 0 8H7M7 12h7a4 4 0 0 1 0 8H7',
  C: 'M17.5 8a6.5 6.5 0 1 0 0 8',
  D: 'M7 4v16h4a8 8 0 0 0 0-16H7',
  E: 'M17 4H7v16h10M7 12h8',
  F: 'M17 4H7v16M7 12h8',
  G: 'M17.5 8a6.5 6.5 0 1 0 .5 4H12',
  H: 'M7 4v16M17 4v16M7 12h10',
  I: 'M12 4v16M8 4h8M8 20h8',
  J: 'M16 4v11a4 4 0 0 1-8 0',
  K: 'M7 4v16M17 4L7 13M10.5 10.5L17 20',
  L: 'M7 4v16h10',
  M: 'M6 20V4l6 9 6-9v16',
  N: 'M7 20V4l10 16V4',
  O: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16z',
  P: 'M7 20V4h6a4.5 4.5 0 0 1 0 9H7',
  Q: 'M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM14 14l4 5',
  R: 'M7 20V4h6a4.5 4.5 0 0 1 0 9H7M12 13l5 7',
  S: 'M17 7.5C16 5 14 4 12 4C9 4 7 5.5 7 8C7 13 17 11 17 16C17 18.5 15 20 12 20C9.5 20 7.5 19 7 16.5',
  T: 'M6 4h12M12 4v16',
  U: 'M7 4v9a5 5 0 0 0 10 0V4',
  V: 'M6 4l6 16 6-16',
  W: 'M5 4l3.5 16L12 9l3.5 11L19 4',
  X: 'M7 4l10 16M17 4L7 20',
  Y: 'M7 4l5 8 5-8M12 12v8',
  Z: 'M7 4h10L7 20h10',
  '0': 'M12 4C8 4 7 8 7 12S8 20 12 20 17 16 17 12 16 4 12 4z',
  '1': 'M9 7l3-3v16M9 20h6',
  '2': 'M7 8a5 4 0 0 1 10 0c0 4-10 7-10 12h10',
  '3': 'M7 6c3-3 10-2 10 2 0 3-3 4-5 4 2 0 5 1 5 4 0 4-7 5-10 2',
  '4': 'M15 20V4L6 15h12',
  '5': 'M16 4H8l-1 7c4-2 10 0 10 4s-5 6-10 3',
  '6': 'M16 5c-6-3-9 4-9 9a5 5 0 0 0 10 0c0-5-7-6-10 0',
  '7': 'M7 4h10L10 20',
  '8': 'M12 4a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7M12 11a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9',
  '9': 'M8 19c6 3 9-4 9-9a5 5 0 0 0-10 0c0 5 7 6 10 0',
};

/** FNV-1a, 32-bit — a stable, dependency-free string hash. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The words of an app name, lower-cased, Latin and non-Latin alike. */
export function nameWords(appName: string): string[] {
  return String(appName || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The first Latin letter or digit of the name ("Éclair" → E); null for a name written wholly in another script. */
export function latinInitial(appName: string): string | null {
  for (const ch of String(appName || '')) {
    const base = ch.normalize('NFD')[0].toUpperCase();
    if (/^[A-Z0-9]$/.test(base)) return base;
  }
  return null;
}

/** The first glyph (in table order) with a keyword the name contains: a whole word, or a word that begins with a 4+ letter keyword. */
export function glyphForName(appName: string): string | null {
  const words = nameWords(appName);
  if (words.length === 0) return null;
  for (const [glyph, kws] of Object.entries(BRAND_GLYPH_KEYWORDS)) {
    if (!BRAND_GLYPHS[glyph]) continue;
    for (const kw of kws) if (words.some((w) => w === kw || (kw.length >= 4 && w.startsWith(kw)))) return glyph;
  }
  return null;
}

/**
 * Which mark does this app get? A symbol that fits its name; else the first letter of its name; else (a name with neither) a
 * stable symbol picked by the name's hash, so even an all-Devanagari name gets its own mark and never a default.
 */
export function chooseMark(appName: string): BrandMark {
  // Seeded by the NAME alone, so the web app's install icon (built before any app id exists), the Android and iOS launcher
  // icons and the splash are one and the same mark. Two apps with different names always differ; two with the SAME name look alike.
  const seed = String(appName || '').trim().toLowerCase();
  const h = fnv1a(seed);
  const hue = h % 360;
  const hue2 = (hue + 30 + (fnv1a(`${seed}#2`) % 60)) % 360;
  const glyph = glyphForName(appName);
  if (glyph) return { kind: 'glyph', glyph, generic: false, hue, hue2 };
  const letter = latinInitial(appName);
  if (letter && LETTER_PATHS[letter]) return { kind: 'letter', letter, hue, hue2 };
  const generic = BRAND_GENERIC_GLYPHS.filter((g) => BRAND_GLYPHS[g]);
  return { kind: 'glyph', glyph: generic[fnv1a(String(appName)) % generic.length], generic: true, hue, hue2 };
}

/** A short, stable label for reports and tests: "lucide:coffee", "letter:C". */
export function markLabel(m: BrandMark): string {
  return m.kind === 'glyph' ? `lucide:${m.glyph}` : `letter:${m.letter}`;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))) * 255);
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
/** The app's two brand colours as hex: the lighter tile colour, then the darker one. */
export function markColours(m: BrandMark): { a: string; b: string } {
  return { a: hslToHex(m.hue, 62, 40), b: hslToHex(m.hue2, 70, 24) };
}

export interface MarkSvgOptions {
  /** Output width and height in px (the drawing itself is 1024 units). Default 1024. */
  size?: number;
  /** 'rounded' = a tile with rounded corners (launcher, install icon); 'square' = full-bleed; 'round'; 'none' = the glyph alone on transparent. */
  tile?: 'rounded' | 'square' | 'round' | 'none';
  /** Fraction of the tile the glyph spans. Default 0.58 (0.40 for a 'none' foreground, which must sit inside the adaptive-icon safe zone). */
  scale?: number;
  /** An accessible name for the image ("Chai Shop icon"); omitted for a decorative use. Escaped here. */
  label?: string;
}

const esc = (t: string): string => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The mark as a standalone SVG document (valid XML; no fonts, no external references). */
export function markSvg(m: BrandMark, o: MarkSvgOptions = {}): string {
  const tile = o.tile ?? 'rounded';
  const size = o.size ?? 1024;
  const scale = o.scale ?? (tile === 'none' ? 0.4 : 0.58);
  const inner = m.kind === 'glyph' ? BRAND_GLYPHS[m.glyph] : `<path d="${LETTER_PATHS[m.letter]}"/>`;
  const k = (1024 * scale) / 24, off = (1024 - 1024 * scale) / 2;
  const { a, b } = markColours(m);
  // The gradient id carries the colours: two marks inlined into ONE page (a picker, a preview sheet) must not share an id,
  // or every tile paints with the first one's gradient.
  const gid = `nbai-g-${a.slice(1)}-${b.slice(1)}`;
  const bg = tile === 'none' ? '' :
    `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`
    + (tile === 'round' ? `<circle cx="512" cy="512" r="512" fill="url(#${gid})"/>`
      : `<rect width="1024" height="1024"${tile === 'rounded' ? ' rx="228"' : ''} fill="url(#${gid})"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024" data-nbai-mark="${markLabel(m)}"${o.label ? ` role="img" aria-label="${esc(o.label)}"` : ''}>`
    + bg
    + `<g transform="translate(${off} ${off}) scale(${k})" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>\n`;
}
