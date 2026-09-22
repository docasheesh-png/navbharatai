import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { defaultLayer, normalizeLayer, drawTextLayers, type TextLayer, type TextContext } from '../src/lib/textOverlay';

/**
 * THE TEXT FADES, THE BAR BEHIND IT DOES NOT (admin-mandated 2026-09-22).
 *
 * Admin, verbatim: *"image me jab, add text pess kiya jaye, to size ke just niche ek aur controller
 * aye, text opacity ka (same size aur opacity ke taraha,) jisko kam jyada karne se text ki poacity
 * kam jyada ko ja sake."*
 *
 * 🔑 WHAT WAS MISSING, precisely. `band` already carries its own alpha inside its `rgba(...)`, and
 * the editor's existing Opacity slider edits exactly that — so the BAR could always be faded and the
 * WORDS never could. A watermark, or a caption meant to sit under a photograph rather than on top of
 * it, was not expressible at all.
 *
 * 🔒 AND THE TWO MUST NOT MOVE TOGETHER. That is the whole content of this suite: `globalAlpha` is
 * set AFTER the background and the border are drawn and BEFORE the outline, the fill and a rate
 * card's leader dots. One line either side of where it sits produces a visible bug — a bar the user
 * set to 55% quietly dimming, or a solid outline ringing faded letters.
 */

/** A recording 2D context. Asserting the DRAW CALLS is what makes a claim about pixels checkable. */
function recorder(charWidth = 10) {
  const calls: Array<{ op: string; args: number[] | string[]; alpha: number; fill: string; stroke: string }> = [];
  const ctx = {
    font: '',
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 0,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    save() { calls.push({ op: 'save', args: [], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
    restore() { calls.push({ op: 'restore', args: [], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
    measureText(text: string) { return { width: text.length * charWidth }; },
    fillText(t: string, x: number, y: number) { calls.push({ op: 'fillText', args: [t, String(x), String(y)], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
    strokeText(t: string, x: number, y: number) { calls.push({ op: 'strokeText', args: [t, String(x), String(y)], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'fillRect', args: [x, y, w, h], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
    strokeRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'strokeRect', args: [x, y, w, h], alpha: this.globalAlpha, fill: String(this.fillStyle), stroke: String(this.strokeStyle) }); },
  };
  return { ctx: ctx as unknown as TextContext, calls, raw: ctx };
}

const layerWith = (o: Partial<TextLayer> = {}): TextLayer => ({ ...defaultLayer('a', 'HELLO'), ...o });

describe('the model carries a text opacity', () => {
  it('a new layer is SOLID — nobody asked for a faded first caption', () => {
    expect(defaultLayer('a', 'x').opacity).toBe(1);
  });

  it('🔴 a layer saved BEFORE this field existed draws solid, not invisible', () => {
    // The single most damaging way to get this wrong: `undefined` falling back to 0 would make every
    // stored banner open blank and read as "my text was deleted".
    const legacy = { ...defaultLayer('a', 'x') } as Partial<TextLayer>;
    delete legacy.opacity;
    expect(normalizeLayer(legacy as TextLayer).opacity).toBe(1);
  });

  it('an unreadable value also means solid, and the range is clamped', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'half' as never, null as never, undefined as never, '' as never]) {
      // 🔴 `null` and `''` are the dangerous two: `Number(null)` and `Number('')` are both 0, which
      // is FINITE, so a plain clamp would read an absent value as "fully transparent" and the
      // caption would disappear. A layer round-tripped through JSON carries null, not undefined.
      expect(normalizeLayer(layerWith({ opacity: bad })).opacity, String(bad)).toBe(1);
    }
    expect(normalizeLayer(layerWith({ opacity: 5 })).opacity).toBe(1);
    expect(normalizeLayer(layerWith({ opacity: -2 })).opacity).toBe(0);
    expect(normalizeLayer(layerWith({ opacity: 0.32 })).opacity).toBeCloseTo(0.32, 6);
  });

  it('🔒 it is its OWN field — the colour stays a hex', () => {
    // Folding the alpha into `color` would break the swatch row's `active.color === c` match and
    // `outlineFor`'s luminance read, which decides whether the outline is black or white.
    const l = normalizeLayer(layerWith({ opacity: 0.4 }));
    expect(l.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(l.color).not.toMatch(/rgba/);
  });
});

describe('🔒 what fades and what does not — asserted on the real draw calls', () => {
  const draw = (o: Partial<TextLayer>) => {
    const r = recorder();
    drawTextLayers(r.ctx, [layerWith({ band: 'rgba(0,0,0,0.55)', outline: true, ...o })], 1000, 1000);
    return r.calls;
  };

  it('the TEXT is drawn at the layer\'s opacity', () => {
    const calls = draw({ opacity: 0.32 });
    const fills = calls.filter((c) => c.op === 'fillText');
    expect(fills.length).toBeGreaterThan(0);
    for (const c of fills) expect(c.alpha).toBeCloseTo(0.32, 6);
  });

  it('🔴 the BACKGROUND BAR is drawn at FULL alpha — its own 55% is untouched', () => {
    // The bar's strength is the slider the user already had. If text opacity reached it, moving one
    // slider would move the other, and a 32% caption would take the bar down to 18% of the photo.
    const calls = draw({ opacity: 0.32 });
    const bar = calls.filter((c) => c.op === 'fillRect' && String(c.fill).includes('rgba'));
    expect(bar.length).toBe(1);
    expect(bar[0]!.alpha).toBe(1);
    expect(bar[0]!.fill).toContain('0.55');
  });

  it('🔴 the BORDER is drawn at FULL alpha — it frames the box, not the words', () => {
    const calls = draw({ opacity: 0.32, borderPct: 0.04 });
    const border = calls.filter((c) => c.op === 'strokeRect');
    expect(border.length).toBe(1);
    expect(border[0]!.alpha).toBe(1);
  });

  it('the OUTLINE fades with the text it rings', () => {
    // A solid outline around faded letters is the most visible way to get the ordering wrong.
    const calls = draw({ opacity: 0.32, outline: true });
    const strokes = calls.filter((c) => c.op === 'strokeText');
    expect(strokes.length).toBeGreaterThan(0);
    for (const c of strokes) expect(c.alpha).toBeCloseTo(0.32, 6);
  });

  it('a rate card\'s LEADER DOTS fade with the row — they belong to the words', () => {
    const r = recorder();
    drawTextLayers(r.ctx, [layerWith({ kind: 'list', text: 'Tea 10\nCoffee 20', band: '', opacity: 0.4 })], 1000, 1000);
    const dots = r.calls.filter((c) => c.op === 'fillRect');
    expect(dots.length).toBeGreaterThan(0);
    for (const c of dots) expect(c.alpha).toBeCloseTo(0.4, 6);
  });

  it('🔒 opacity 1 produces exactly today\'s drawing — alpha 1 on every call', () => {
    for (const c of draw({ opacity: 1, borderPct: 0.04 })) expect(c.alpha, c.op).toBe(1);
  });

  it('🔒 TWO LAYERS DO NOT BLEED — each is save()/restore()d', () => {
    // Without the bracket, a faded caption would silently fade every caption after it.
    const r = recorder();
    drawTextLayers(r.ctx, [
      layerWith({ id: 'a', text: 'FADED', band: '', opacity: 0.2 }),
      layerWith({ id: 'b', text: 'SOLID', band: '', opacity: 1 }),
    ], 1000, 1000);
    const faded = r.calls.find((c) => c.op === 'fillText' && c.args[0] === 'FADED');
    const solid = r.calls.find((c) => c.op === 'fillText' && c.args[0] === 'SOLID');
    expect(faded!.alpha).toBeCloseTo(0.2, 6);
    expect(solid!.alpha).toBe(1);
  });

  it('opacity 0 still draws the call, so the layer stays selectable rather than deleted', () => {
    const calls = draw({ opacity: 0 });
    const fills = calls.filter((c) => c.op === 'fillText');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills[0]!.alpha).toBe(0);
  });
});

/**
 * Source-level guards. `tsc` and `vitest` cannot see a slider that was never rendered, nor an
 * assignment that drifted one line up past the background — and the second of those is invisible in
 * every behavioural assertion above the moment the line moves, because the calls still happen.
 */
describe('the control the admin asked for', () => {
  const editor = readFileSync(join(process.cwd(), 'src/components/ide/TextOverlayEditor.tsx'), 'utf8');
  const model = readFileSync(join(process.cwd(), 'src/lib/textOverlay.ts'), 'utf8');

  it('🔴 the slider sits directly BELOW Size, which is where it was asked for', () => {
    const size = editor.indexOf('aria-label="Text size"');
    const text = editor.indexOf('aria-label="Text opacity"');
    const colour = editor.indexOf('>Colour<');
    expect(size).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(size);
    expect(text, 'it must come before Colour, i.e. immediately after Size').toBeLessThan(colour);
  });

  it('it is a range 0..100 wired to the layer, with a readout like the other one', () => {
    // Sliced from the visible LABEL, not the aria-label: `type="range"` is written above it, so a
    // window opened at the aria-label starts past the thing it means to assert.
    const row = editor.slice(editor.indexOf('>Text opacity<'));
    const block = row.slice(0, row.indexOf('</div>') + 6);
    expect(block).toMatch(/type="range"/);
    expect(block).toMatch(/min=\{0\}/);
    expect(block).toMatch(/max=\{100\}/);
    expect(block).toMatch(/patch\(active\.id, \{ opacity: Number\(e\.target\.value\) \/ 100 \}\)/);
    expect(block).toMatch(/\{Math\.round\(active\.opacity \* 100\)\}%/);
  });

  it('🔒 the two sliders are DISTINGUISHABLE to a sighted user, not only to a screen reader', () => {
    // Both fade something. A shopkeeper seeing two rows both labelled "Opacity" cannot tell which
    // moves the words, so the new one carries the word "Text" in its VISIBLE label.
    expect(editor).toContain('>Text opacity<');
    expect(editor).toContain('aria-label="Background opacity"');
  });

  it('🔴 the alpha is set AFTER the box and BEFORE the words — the ordering IS the feature', () => {
    const body = model.slice(model.indexOf('export function drawTextLayers'));
    const band = body.indexOf('ctx.fillStyle = layer.band');
    const border = body.indexOf('ctx.strokeRect(');
    const alpha = body.indexOf('ctx.globalAlpha = layer.opacity');
    const outline = body.indexOf('strokeStyle = outlineFor(layer.color)');
    const fill = body.indexOf('ctx.fillStyle = layer.color');
    for (const [name, at] of [['band', band], ['border', border], ['alpha', alpha], ['outline', outline], ['fill', fill]] as const) {
      expect(at, name).toBeGreaterThan(-1);
    }
    expect(alpha, 'after the background').toBeGreaterThan(band);
    expect(alpha, 'after the border').toBeGreaterThan(border);
    expect(alpha, 'before the outline').toBeLessThan(outline);
    expect(alpha, 'before the fill').toBeLessThan(fill);
  });
});
