import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { BRAND_GENERIC_GLYPHS, BRAND_GLYPHS, BRAND_GLYPH_KEYWORDS, LUCIDE_VERSION } from '../src/lib/brandGlyphs.generated';
import { LETTER_PATHS, chooseMark, glyphForName, latinInitial, markColours, markLabel, markSvg } from '../src/lib/brandMark';

// Admin 2026-10-21: a chosen logo first; else a Lucide symbol that fits the app's name; else the first letter of its name.
// No AI image. These tests pin that rule, and the vendored data it draws from.
describe('which mark does an app get', () => {
  it('a symbol that fits the name comes first (Lucide before the alphabet)', () => {
    expect(markLabel(chooseMark('Chai Shop'))).toBe('lucide:coffee');
    expect(markLabel(chooseMark('Quran Reader'))).toBe('lucide:book-open');
    expect(markLabel(chooseMark('Racing Game'))).toBe('lucide:gamepad-2');
    expect(markLabel(chooseMark('Gym Tracker'))).toBe('lucide:dumbbell');
    expect(markLabel(chooseMark('Dhaba Express'))).toBe('lucide:utensils');
  });
  it('Hinglish words in a name select a symbol too', () => {
    expect(glyphForName('Meri Dukan')).toBe('shopping-cart');
    expect(glyphForName('Kheti Mitra')).toBe('sprout');
    expect(glyphForName('Mausam Live')).toBe('cloud-sun');
  });
  it('no fitting symbol → the FIRST LETTER of the name, on the app\'s own colour', () => {
    expect(markLabel(chooseMark('Pixelyt'))).toBe('letter:P');
    expect(markLabel(chooseMark('Zen'))).toBe('letter:Z');
    expect(markLabel(chooseMark('  7 Wonders'))).toBe('letter:7');
    expect(latinInitial('Éclair')).toBe('E');
  });
  it('a name in another script (no Latin letter, no keyword) still gets its OWN stable mark — never a default', () => {
    const m = chooseMark('चाय की दुकान');
    expect(m.kind).toBe('glyph'); expect(BRAND_GENERIC_GLYPHS).toContain((m as { glyph: string }).glyph);
    expect(markLabel(chooseMark('चाय की दुकान'))).toBe(markLabel(m)); // stable
    expect(latinInitial('चाय की दुकान')).toBeNull();
  });
  it('a letter later in the name is used when the name starts in another script', () => {
    expect(latinInitial('चाय Wala')).toBe('W');
  });
  it('keywords match whole words, or a long keyword as a word PREFIX — "gamer" is a game, "a" is not', () => {
    expect(glyphForName('Gamer Hub')).toBe('gamepad-2');
    expect(glyphForName('Teacher Pro')).toBe('graduation-cap');
    expect(glyphForName('Algebra')).toBeNull(); // "al" is not a keyword and must not match inside a word
  });
  it('same name → same mark and colours; different names → different colours', () => {
    expect(chooseMark('Pixelyt')).toEqual(chooseMark('pixelyt  '.trim()));
    const cols = ['Pixelyt', 'Zen', 'Orbit', 'Mango', 'Nimbus', 'Quill'].map((n) => markColours(chooseMark(n)).a);
    expect(new Set(cols).size).toBe(cols.length);
  });
});

describe('the drawn mark', () => {
  const svg = markSvg(chooseMark('Chai Shop'));
  it('is a standalone, font-free, reference-free SVG document', () => {
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).not.toMatch(/<text|font-family|href=|url\(http|<image|<script/);
    expect(svg).toContain('data-nbai-mark="lucide:coffee"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });
  it('every letter and digit is drawn from its own path — no font needed', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(LETTER_PATHS[ch], ch).toBeTruthy();
    expect(markSvg(chooseMark('Pixelyt'))).toContain(LETTER_PATHS.P);
  });
  it('two marks inlined into one page do not share a gradient id (the first would paint every tile)', () => {
    const id = (s: string) => /linearGradient id="([^"]+)"/.exec(s)![1];
    expect(id(markSvg(chooseMark('Pixelyt')))).not.toBe(id(markSvg(chooseMark('Zen'))));
  });
  it('the glyph-only variant is transparent (the adaptive-icon foreground) and smaller, to sit in the safe zone', () => {
    const fg = markSvg(chooseMark('Chai Shop'), { tile: 'none' });
    expect(fg).not.toMatch(/<rect|<circle|linearGradient/);
    expect(fg).toContain('scale(' + (1024 * 0.4 / 24) + ')');
  });
  it('the tile shapes: rounded (launcher / install), square (full-bleed), round', () => {
    expect(markSvg(chooseMark('Zen'), { tile: 'rounded' })).toContain('rx="228"');
    expect(markSvg(chooseMark('Zen'), { tile: 'square' })).not.toContain('rx=');
    expect(markSvg(chooseMark('Zen'), { tile: 'round' })).toContain('<circle');
  });
});

describe('the vendored Lucide glyphs (licence, size, no duplicates, real)', () => {
  const file = readFileSync('src/lib/brandGlyphs.generated.ts', 'utf8');
  it('carries the ISC licence notice and the version it came from', () => {
    expect(file).toMatch(/ISC licence/);
    expect(file).toMatch(/Copyright \(c\) 2026 Lucide Icons and Contributors/);
    expect(file).toMatch(/Permission to use, copy, modify, and\/or distribute/);
    expect(LUCIDE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('is a curated handful, not the library: under 40 KB and under 120 glyphs', () => {
    expect(file.length).toBeLessThan(40_000);
    expect(Object.keys(BRAND_GLYPHS).length).toBeLessThan(120);
    expect(Object.keys(BRAND_GLYPHS).length).toBeGreaterThan(50);
  });
  it('every keyword row has its glyph and every generic pick exists', () => {
    for (const id of Object.keys(BRAND_GLYPH_KEYWORDS)) expect(BRAND_GLYPHS[id], id).toBeTruthy();
    for (const id of BRAND_GENERIC_GLYPHS) expect(BRAND_GLYPHS[id], id).toBeTruthy();
  });
  it('no glyph is stored twice under two names (no duplicate icons)', () => {
    const seen = new Map<string, string>();
    for (const [id, markup] of Object.entries(BRAND_GLYPHS)) {
      expect(seen.get(markup), `${id} duplicates ${seen.get(markup)}`).toBeUndefined();
      seen.set(markup, id);
    }
  });
  it('every vendored id is a real icon of the installed lucide-react', () => {
    const dir = 'node_modules/lucide-react/dist/esm/icons';
    if (!existsSync(dir)) return; // a checkout without node_modules
    for (const id of Object.keys(BRAND_GLYPHS)) expect(existsSync(`${dir}/${id}.mjs`), id).toBe(true);
  });
  it('no vendor name other than Lucide appears in the generated file (no Capacitor, no framework icon)', () => {
    expect(file).not.toMatch(/capacitor|vite\.svg|react\.svg/i);
  });
});
