import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEFAULT_FONT_ID,
  DEVANAGARI_STACK,
  FONT_CHOICES,
  FONT_STACK,
  fontChoice,
  fontFamilyStack,
  googleFontHref,
} from '../src/lib/imageFonts';
import {
  MAX_BORDER_PCT,
  bandRect,
  defaultLayer,
  drawTextLayers,
  fontStringAt,
  normalizeLayer,
  rgbaFrom,
  splitFill,
  type TextContext,
  type TextLayer,
} from '../src/lib/textOverlay';

/**
 * 🔒 FONTS, A REAL COLOUR PICKER, A BACKGROUND WITH AN OPACITY, AND A BORDER (admin 2026-09-21).
 *
 * Verbatim: *"image me text add karne ke samaya Width ki jagah background karo. opacity kam jyada
 * karne ki line bhi add karo. clour picker bhi add karo, colour, bale golo ke age last me. font
 * badalne ka bhi system add karo, kam se kam 25+ font chahiye. border add/remove bhi chahiye. abhi
 * yeh kam karo professionally real aur working."*
 *
 * 🔴 THE ONE THING THAT COULD HAVE GONE SILENTLY WRONG, and most of this file is about it: a font
 * picker is the easiest way to break Hindi. The editor exists *because* an image model cannot spell
 * Devanagari; a list of pretty Latin display faces that replaced the family stack would turn
 * "शर्मा स्वीट्स" into empty boxes, and nothing would fail — the picture would just be wrong, in the
 * one script this whole feature was built for. So every stack is asserted to END in the Devanagari
 * fallbacks, for Latin-only faces too.
 */

const SRC = resolve(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
/** Comments are prose. A note QUOTING an old control must not decide whether a case passes. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const EDITOR = read('components/ide/TextOverlayEditor.tsx');

/** A recorder with the border's `strokeRect`, so a stroke can be asserted rather than assumed. */
type Call = { op: string; args: number[]; stroke: unknown; fill: unknown; lineWidth: number };
function recorder() {
  const calls: Call[] = [];
  const ctx: TextContext & { calls: Call[] } = {
    calls,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', textAlign: '', textBaseline: '',
    save() {}, restore() {},
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillText(t: string, x: number, y: number) { calls.push({ op: `fillText:${t}`, args: [x, y], stroke: this.strokeStyle, fill: this.fillStyle, lineWidth: this.lineWidth }); },
    strokeText(t: string, x: number, y: number) { calls.push({ op: `strokeText:${t}`, args: [x, y], stroke: this.strokeStyle, fill: this.fillStyle, lineWidth: this.lineWidth }); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'fillRect', args: [x, y, w, h], stroke: this.strokeStyle, fill: this.fillStyle, lineWidth: this.lineWidth }); },
    strokeRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'strokeRect', args: [x, y, w, h], stroke: this.strokeStyle, fill: this.fillStyle, lineWidth: this.lineWidth }); },
  };
  return ctx;
}
const layer = (over: Partial<TextLayer> = {}): TextLayer =>
  normalizeLayer({ ...defaultLayer('a', 'HELLO'), band: '', outline: false, ...over });

describe('🔒 HINDI SURVIVES EVERY FONT — the rule the picker could most easily have broken', () => {
  it('every choice ends in the Devanagari fallbacks, Latin-only faces included', () => {
    for (const f of FONT_CHOICES) {
      expect(fontFamilyStack(f.id).endsWith(FONT_STACK), `${f.label} drops the fallback stack`).toBe(true);
      expect(fontFamilyStack(f.id)).toContain(DEVANAGARI_STACK);
    }
  });

  it('a Latin-only face is named FIRST and the Devanagari face after it', () => {
    // Per-glyph resolution is what makes a mixed line work: the Latin comes from Bebas Neue, the
    // Hindi from a face that has it. Reversing the order would draw the Latin in Noto instead.
    const stack = fontFamilyStack('bebas-neue');
    expect(stack.indexOf('"Bebas Neue"')).toBe(0);
    expect(stack.indexOf('"Bebas Neue"')).toBeLessThan(stack.indexOf('Noto Sans Devanagari'));
  });

  it('the default choice prepends nothing — it IS the stack', () => {
    expect(fontFamilyStack(DEFAULT_FONT_ID)).toBe(FONT_STACK);
    expect(googleFontHref(DEFAULT_FONT_ID)).toBe('');
  });

  it('a stored id this build has never heard of falls back, rather than producing an empty family', () => {
    // A layer saved by a build that knew a font this one does not must still draw.
    expect(fontChoice('a-font-from-2027').id).toBe(DEFAULT_FONT_ID);
    expect(normalizeLayer({ ...defaultLayer('x', 'hi'), fontId: 'nope' } as TextLayer).fontId).toBe(DEFAULT_FONT_ID);
    expect(fontStringAt(layer({ fontId: 'nope' }), 40)).toContain(DEVANAGARI_STACK);
  });
});

describe('🔒 the catalogue is real, and big enough to be the feature that was asked for', () => {
  it('carries more than the 25 fonts the admin asked for', () => {
    expect(FONT_CHOICES.length).toBeGreaterThanOrEqual(26);
  });

  it('offers a real Devanagari choice, not one token entry', () => {
    // An India-first product whose Hindi users get four fonts and whose English users get thirty is
    // the same quiet second-class treatment the language rule already forbids elsewhere.
    expect(FONT_CHOICES.filter((f) => f.devanagari && f.id !== DEFAULT_FONT_ID).length).toBeGreaterThanOrEqual(10);
    expect(FONT_CHOICES.filter((f) => !f.devanagari).length).toBeGreaterThanOrEqual(10);
  });

  it('every id is unique and every non-default entry names a family', () => {
    expect(new Set(FONT_CHOICES.map((f) => f.id)).size).toBe(FONT_CHOICES.length);
    for (const f of FONT_CHOICES) {
      if (f.id === DEFAULT_FONT_ID) { expect(f.family).toBe(''); continue; }
      expect(f.family.length, `${f.id} has no family`).toBeGreaterThan(0);
      expect(f.google.length, `${f.id} has no Google spec`).toBeGreaterThan(0);
    }
  });

  it('🔴 the Google spec is URL-shaped — a space would make every request 400', () => {
    // The CSS2 API takes `Noto+Sans+Devanagari`, not `Noto Sans Devanagari`. A raw space produces a
    // stylesheet that never loads, and the failure is a font that silently is not there.
    for (const f of FONT_CHOICES) {
      if (!f.google) continue;
      expect(f.google, `${f.id} has a space in its Google spec`).not.toMatch(/\s/);
      expect(f.google.startsWith(f.family.replace(/\s/g, '+')), `${f.id}: spec does not match its family`).toBe(true);
    }
  });

  it('🔴 a weight axis is only ever asked for as 400;700 — never a value a family may not publish', () => {
    // The CSS2 API answers HTTP 400 for an unpublished weight, so a wrong axis does not degrade, it
    // makes that font fail to load entirely. Single-weight display faces carry no axis at all and
    // have their bold synthesized, which is what a poster face wants anyway.
    for (const f of FONT_CHOICES) {
      if (!f.google.includes('wght')) continue;
      expect(f.google, `${f.id} asks for an unexpected axis`).toContain(':wght@400;700');
    }
  });

  it('builds a display=swap stylesheet URL on the Google Fonts CSS2 endpoint', () => {
    const href = googleFontHref('poppins');
    expect(href).toBe('https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap');
  });
});

describe('🔒 the chosen font is what MEASURES as well as what draws', () => {
  it('the layer’s family reaches the font string', () => {
    expect(fontStringAt(layer({ fontId: 'poppins' }), 48)).toContain('"Poppins"');
    expect(fontStringAt(layer({ fontId: 'poppins', bold: false }), 48)).toContain('400 48px');
    expect(fontStringAt(layer({ fontId: 'poppins', bold: true }), 48)).toContain('700 48px');
  });

  it('🔴 wrapping is measured in the SAME string the text is drawn with', () => {
    // Measure in one face and draw in another and the line breaks land in the wrong place — the
    // preview the user positioned is not the file they save, and nothing fails to reveal it.
    const ctx = recorder();
    const fonts: string[] = [];
    const base = ctx.measureText.bind(ctx);
    ctx.measureText = (t: string) => { fonts.push(ctx.font); return base(t); };
    drawTextLayers(ctx, [layer({ fontId: 'oswald', text: 'one two three four five six seven' })], 600, 600);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).toContain('"Oswald"');
  });
});

describe('🔒 the background is ONE stored string, shown as a colour and an opacity', () => {
  it('composes a colour and an opacity into a fill', () => {
    expect(rgbaFrom('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(rgbaFrom('#ffffff', 1)).toBe('rgb(255,255,255)');
  });

  it('🔴 opacity 0 IS "no background" — there is no second on/off flag to drift from', () => {
    expect(rgbaFrom('#000000', 0)).toBe('');
    expect(rgbaFrom('#000000', -1)).toBe('');
    expect(bandRect(layer({ band: rgbaFrom('#000000', 0) }), 500, 500, (t) => t.length * 10)).toBeNull();
  });

  it('reads back what earlier code and every template already wrote', () => {
    // These exact strings are on layers real users already have; a parser that only understood its
    // own output would show them all as "no background" the first time somebody opened the editor.
    expect(splitFill('rgba(0,0,0,0.55)')).toEqual({ hex: '#000000', alpha: 0.55 });
    expect(splitFill('rgba(255,255,255,0.82)')).toEqual({ hex: '#ffffff', alpha: 0.82 });
    expect(splitFill('#000')).toEqual({ hex: '#000000', alpha: 1 });
    expect(splitFill('')).toEqual({ hex: '#000000', alpha: 0 });
  });

  it('round-trips, so moving the slider cannot drift the colour', () => {
    for (const hex of ['#ffffff', '#000000', '#0a84ff', '#ff2d9b']) {
      for (const a of [0.1, 0.55, 0.82, 1]) {
        expect(splitFill(rgbaFrom(hex, a))).toEqual({ hex, alpha: a });
      }
    }
  });

  it('anything unreadable is "no background", never a guessed colour', () => {
    expect(splitFill('chartreuse')).toEqual({ hex: '#000000', alpha: 0 });
    expect(splitFill('var(--accent)')).toEqual({ hex: '#000000', alpha: 0 });
  });
});

describe('🔒 the border frames the SAME box the background fills', () => {
  const measure = (t: string) => t.length * 10;

  it('a layer with a border and NO background still has a box to draw', () => {
    // The whole point: a frame with nothing behind it is a real thing to want, and the old
    // `if (!band) return null` would have silently drawn nothing.
    const rect = bandRect(layer({ band: '', borderPct: 0.06, text: 'HI' }), 800, 800, measure);
    expect(rect).not.toBeNull();
  });

  it('no background and no border is still no box at all', () => {
    expect(bandRect(layer({ band: '', borderPct: 0 }), 800, 800, measure)).toBeNull();
  });

  it('the border and the fill are the same rectangle, so they cannot sit apart', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [layer({ band: 'rgba(0,0,0,0.5)', borderPct: 0.06, text: 'HI' })], 800, 800);
    const fill = ctx.calls.find((c) => c.op === 'fillRect');
    const stroke = ctx.calls.find((c) => c.op === 'strokeRect');
    expect(fill, 'no background was filled').toBeTruthy();
    expect(stroke, 'no border was stroked').toBeTruthy();
    // Inset by exactly half the stroke: a canvas stroke straddles its path, so without the inset a
    // thick border spills half its weight outside the bar it is framing.
    const lw = stroke!.lineWidth;
    expect(lw).toBeGreaterThan(0);
    expect(stroke!.args[0]).toBeCloseTo(fill!.args[0] + lw / 2, 5);
    expect(stroke!.args[1]).toBeCloseTo(fill!.args[1] + lw / 2, 5);
    expect(stroke!.args[2]).toBeCloseTo(fill!.args[2] - lw, 5);
    expect(stroke!.args[3]).toBeCloseTo(fill!.args[3] - lw, 5);
  });

  it('the border is drawn BEFORE the text, never over it', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [layer({ band: '', borderPct: 0.06, text: 'HI' })], 800, 800);
    const stroke = ctx.calls.findIndex((c) => c.op === 'strokeRect');
    const text = ctx.calls.findIndex((c) => c.op.startsWith('fillText'));
    expect(stroke).toBeGreaterThanOrEqual(0);
    expect(text).toBeGreaterThan(stroke);
  });

  it('uses the border’s own colour, not the text’s', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [layer({ band: '', borderPct: 0.06, borderColor: '#ff0000', color: '#ffffff', text: 'HI' })], 800, 800);
    expect(ctx.calls.find((c) => c.op === 'strokeRect')!.stroke).toBe('#ff0000');
  });

  it('a runaway width is clamped rather than swallowing the letters', () => {
    expect(normalizeLayer(layer({ borderPct: 9 })).borderPct).toBe(MAX_BORDER_PCT);
    expect(normalizeLayer(layer({ borderPct: -3 })).borderPct).toBe(0);
    expect(normalizeLayer({ ...layer(), borderPct: Number.NaN }).borderPct).toBe(0);
  });

  it('a new layer starts with no border and no font override — today’s look, unchanged', () => {
    const d = defaultLayer('n', 'hi');
    expect(d.borderPct).toBe(0);
    expect(d.fontId).toBe(DEFAULT_FONT_ID);
  });
});

describe('🔒 the editor really renders the five controls, and the old one is gone', () => {
  const src = code(EDITOR);

  it('the font picker is a real select over the whole catalogue', () => {
    expect(src).toMatch(/<select[\s\S]*?id="nbai-text-font"/);
    expect(src).toContain('FONT_CHOICES.filter');
    expect(src).toMatch(/patch\(active\.id, \{ fontId: e\.target\.value \}\)/);
  });

  it('the colour picker is the device’s own, and sits at the END of the swatches', () => {
    // A hand-built HSB square would be hundreds of lines that work worse on a touch screen, and it
    // could not be reached by a keyboard or a screen reader for free.
    expect(src).toMatch(/type="color"/);
    const swatches = src.indexOf('SWATCHES.map');
    const dot = src.indexOf('<ColourDot', swatches);
    expect(swatches).toBeGreaterThan(-1);
    expect(dot, 'the picker does not follow the swatch row').toBeGreaterThan(swatches);
  });

  it('background and opacity edit the one stored fill through the shared helpers', () => {
    expect(src).toMatch(/rgbaFrom\(/);
    expect(src).toMatch(/splitFill\(active\.band\)/);
    // A second local notion of "is the background on?" is exactly the drift this avoids.
    expect(src).not.toMatch(/bandEnabled|backgroundOn|hasBand/);
  });

  it('the border row can add AND remove', () => {
    expect(src).toContain('BORDER_CHOICES');
    expect(src).toMatch(/borderPct: b\.value/);
    expect(src).toMatch(/borderColor: c/);
  });

  it('🔴 the Width slider no longer sits on every caption', () => {
    // The admin asked for background in its place. It survives for a RATE LIST only, where it is the
    // span the two price columns are set against — deleting it there would remove a real capability
    // rather than a confusing control.
    expect(src).not.toMatch(/>Width</);
    expect(src).toContain('Table width');
    const table = src.indexOf('Table width');
    const guard = src.lastIndexOf("active.kind === 'list' && (", table);
    expect(guard, 'the width slider is not behind the rate-list guard').toBeGreaterThan(-1);
  });
});

describe('🔒 THE LIVE CSP ALLOWS THE STYLESHEET THIS FEATURE FETCHES', () => {
  /**
   * 🔴 THE FAILURE THIS CATCHES IS TOTALLY SILENT, AND IT WAS REAL UNTIL THE SAME COMMIT.
   *
   * `securityHeaders.ts` shipped `style-src 'self' 'unsafe-inline'` — and a Google Fonts `<link
   * rel="stylesheet">` is governed by STYLE-src, not by font-src. `font-src` already allowed
   * `https:`, so the .woff2 files were never the problem; the stylesheet that NAMES them was blocked,
   * every `document.fonts.check` came back false, and all 44 families would have quietly fallen back
   * to the device default. The picker would have looked perfect and changed nothing.
   *
   * The host is DERIVED from `googleFontHref` rather than typed here, so the two cannot drift: point
   * the loader at another CDN and this fails until the policy is told about it.
   */
  it('style-src names the exact origin the font loader requests from', async () => {
    const { securityHeadersConfig } = await import('../src/server/lib/securityHeaders');
    const origin = new URL(googleFontHref('poppins')).origin;
    const csp = securityHeadersConfig.contentSecurityPolicy;
    const directives = (typeof csp === 'object' && csp && 'directives' in csp ? csp.directives : {}) as Record<string, unknown>;
    expect(String(directives.styleSrc), `style-src does not allow ${origin}`).toContain(origin);
  });

  it('font-src still allows the face files the stylesheet points at', () => {
    // Separate from the line above on purpose: allowing the stylesheet and allowing the fonts it
    // names are two different directives, and having one without the other loads a stylesheet whose
    // every @font-face is then blocked.
    return import('../src/server/lib/securityHeaders').then(({ securityHeadersConfig }) => {
      const csp = securityHeadersConfig.contentSecurityPolicy;
      const directives = (typeof csp === 'object' && csp && 'directives' in csp ? csp.directives : {}) as Record<string, unknown>;
      const fontSrc = String(directives.fontSrc);
      expect(fontSrc.includes('https:') || fontSrc.includes('fonts.gstatic.com')).toBe(true);
    });
  });
});

describe('🔒 a font that has not arrived can never be measured with', () => {
  const src = code(EDITOR);

  it('🔴 the repaint depends on the font state', () => {
    // Without this the canvas keeps the frame it measured in the FALLBACK face: the text is wrapped
    // at one set of widths and never re-wrapped at the real ones. Nothing errors; the picture is
    // just laid out in a font the user did not choose.
    expect(src).toMatch(/\[image, paint, fontState\]/);
  });

  it('Done waits for every chosen font before it exports', () => {
    const done = src.slice(src.indexOf('const handleDone'));
    const wait = done.indexOf('loadImageFont');
    const draw = done.indexOf('paint(canvas, image)');
    expect(wait, 'the export does not wait for the fonts').toBeGreaterThan(-1);
    expect(wait, 'the export paints before the fonts are ready').toBeLessThan(draw);
  });

  it('a font that could not be fetched is SAID, not silently swapped', () => {
    // The second absolute rule reaches a dropdown as much as a button: the option works, or it says
    // it does not. `loadImageFont` returns the honest verdict from `document.fonts.check`.
    expect(src).toMatch(/fontNote/);
    expect(src).toContain('could not be loaded on this device');
    const loader = code(read('lib/imageFontLoader.ts'));
    expect(loader).toMatch(/fonts\.check\(/);
    expect(loader).toMatch(/fonts\.load\(/);
  });

  it('the loader asks for both weights, because Bold switches between them at draw time', () => {
    const loader = code(read('lib/imageFontLoader.ts'));
    expect(loader).toContain('400 64px');
    expect(loader).toContain('700 64px');
  });
});
