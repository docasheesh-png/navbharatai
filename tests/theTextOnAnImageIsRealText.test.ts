// The text a user adds to a generated image must be REAL text, drawn by a font engine — never
// something a model imitated the shape of.
//
// These tests drive `drawTextLayers` with a RECORDING fake context and assert the exact calls: the
// font string, the coordinates, the colours and the ORDER. That matters more than usual here: this
// repo has four recorded incidents of a test passing while the call site it was meant to protect was
// gutted, always because the test asserted a NAME rather than a BEHAVIOUR. A recorder cannot be
// fooled that way — delete the stroke pass and the outline assertions fail.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  FONT_STACK,
  MAX_SIZE_PCT,
  MAX_TEXT_CHARS,
  MIN_SIZE_PCT,
  bandRect,
  composeImage,
  defaultLayer,
  devanagariRendersHere,
  devanagariWarning,
  drawTextLayers,
  fontPx,
  fontString,
  hasDevanagari,
  imagePixels,
  layoutLayer,
  normalizeLayer,
  outlineFor,
  textLines,
  type ComposeContext,
  type TextContext,
  type TextLayer,
} from '../src/lib/textOverlay';

type Call = { op: string; args: unknown[]; font: string; fill: unknown; stroke: unknown; align: string };

/** A context that records everything, and measures a character as a flat 10px so widths are exact. */
function recorder(charWidth = 10) {
  const calls: Call[] = [];
  const ctx: TextContext & { calls: Call[] } = {
    calls,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
    save() { calls.push({ op: 'save', args: [], font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, align: this.textAlign }); },
    restore() { calls.push({ op: 'restore', args: [], font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, align: this.textAlign }); },
    measureText(text: string) { return { width: text.length * charWidth }; },
    fillText(text: string, x: number, y: number) { calls.push({ op: 'fillText', args: [text, x, y], font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, align: this.textAlign }); },
    strokeText(text: string, x: number, y: number) { calls.push({ op: 'strokeText', args: [text, x, y], font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, align: this.textAlign }); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'fillRect', args: [x, y, w, h], font: this.font, fill: this.fillStyle, stroke: this.strokeStyle, align: this.textAlign }); },
  };
  return ctx;
}

/** The recorder, extended with the two calls `composeImage` adds. */
function composer(charWidth = 10) {
  const base = recorder(charWidth);
  const ctx = base as typeof base & ComposeContext;
  ctx.clearRect = (x: number, y: number, w: number, h: number) => { base.calls.push({ op: 'clearRect', args: [x, y, w, h], font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle, align: ctx.textAlign }); };
  ctx.drawImage = (_img: unknown, x: number, y: number, w: number, h: number) => { base.calls.push({ op: 'drawImage', args: [x, y, w, h], font: ctx.font, fill: ctx.fillStyle, stroke: ctx.strokeStyle, align: ctx.textAlign }); };
  return ctx;
}

const plain = (over: Partial<TextLayer> = {}): TextLayer => ({ ...defaultLayer('a', 'HELLO'), band: '', outline: false, ...over });

describe('the text is drawn by a font engine, not imitated', () => {
  it('draws each line with fillText, at the laid-out coordinates', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ text: 'LINE ONE\nLINE TWO', xPct: 0.5, yPct: 0.5 })], 1000, 1000);
    const fills = ctx.calls.filter((c) => c.op === 'fillText');
    expect(fills.map((c) => c.args[0])).toEqual(['LINE ONE', 'LINE TWO']);
    const boxes = layoutLayer(plain({ text: 'LINE ONE\nLINE TWO', xPct: 0.5, yPct: 0.5 }), 1000, 1000);
    expect(fills.map((c) => [c.args[1], c.args[2]])).toEqual(boxes.map((b) => [b.x, b.y]));
  });

  it('names a real Devanagari font family in the font it draws with', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ text: 'शर्मा' })], 1000, 1000);
    const fill = ctx.calls.find((c) => c.op === 'fillText');
    expect(fill?.font).toContain('Noto Sans Devanagari');
    expect(fill?.font).toBe(fontString(plain({ text: 'शर्मा' }), 1000, 1000));
  });

  it('a Devanagari conjunct is handed to the engine WHOLE — never split into pieces', () => {
    // क्ष is three code points that shape into one glyph. Splitting it anywhere (to wrap, to measure
    // per character, to "fix" spacing) destroys the conjunct. The engine must receive the string.
    const ctx = recorder();
    const text = 'क्षत्रिय ज्ञान';
    drawTextLayers(ctx, [plain({ text })], 1000, 1000);
    expect(ctx.calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toEqual([text]);
  });

  it('skips a layer with no text instead of drawing an empty string', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ text: '' }), plain({ text: '   \n  ' })], 1000, 1000);
    expect(ctx.calls.filter((c) => c.op === 'fillText')).toHaveLength(0);
  });

  it('never draws a blank line inside a block, but keeps its spacing', () => {
    const ctx = recorder();
    const layer = plain({ text: 'TOP\n\nBOTTOM' });
    drawTextLayers(ctx, [layer], 1000, 1000);
    const fills = ctx.calls.filter((c) => c.op === 'fillText');
    expect(fills.map((c) => c.args[0])).toEqual(['TOP', 'BOTTOM']);
    // Three lines of space, so the gap between the two drawn baselines is TWO steps, not one.
    const boxes = layoutLayer(layer, 1000, 1000);
    expect(boxes).toHaveLength(3);
    expect((fills[1].args[2] as number) - (fills[0].args[2] as number)).toBeCloseTo(boxes[2].y - boxes[0].y);
  });
});

describe('the outline is drawn before the fill, and only when asked', () => {
  it('strokes every line BEFORE filling it, so the outline cannot thin the letters', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ text: 'A\nB', outline: true })], 1000, 1000);
    const ops = ctx.calls.filter((c) => c.op === 'fillText' || c.op === 'strokeText').map((c) => `${c.op}:${c.args[0]}`);
    expect(ops).toEqual(['strokeText:A', 'strokeText:B', 'fillText:A', 'fillText:B']);
  });

  it('draws no stroke at all when the outline is off', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ outline: false })], 1000, 1000);
    expect(ctx.calls.some((c) => c.op === 'strokeText')).toBe(false);
  });

  it('picks the outline by real luminance, not by an average of the channels', () => {
    expect(outlineFor('#ffffff')).toBe('#000000');
    expect(outlineFor('#000000')).toBe('#ffffff');
    // Pure blue averages to 85/255 — "dark" — but is genuinely dark to the eye too, so white.
    expect(outlineFor('#0000ff')).toBe('#ffffff');
    // Pure green averages to the SAME 85/255 and is genuinely LIGHT. An average gets this wrong.
    expect(outlineFor('#00ff00')).toBe('#000000');
    expect(outlineFor('#fff')).toBe('#000000');
    expect(outlineFor('not a colour')).toBe('#000000');
  });
});

describe('the band sits behind the text, not over it', () => {
  it('fills the band rect before any glyph is drawn', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ band: 'rgba(0,0,0,0.5)', text: 'HI' })], 1000, 1000);
    const order = ctx.calls.filter((c) => ['fillRect', 'fillText'].includes(c.op)).map((c) => c.op);
    expect(order).toEqual(['fillRect', 'fillText']);
  });

  it('restores the drawing font after measuring, so the band cannot change the text size', () => {
    const ctx = recorder();
    const layer = plain({ band: '#000000', text: 'HI' });
    drawTextLayers(ctx, [layer], 1000, 1000);
    expect(ctx.calls.find((c) => c.op === 'fillText')?.font).toBe(fontString(layer, 1000, 1000));
  });

  it('sizes the band to the WIDEST line', () => {
    const layer = plain({ band: '#000', text: 'SHORT\nA MUCH LONGER LINE' });
    const rect = bandRect(layer, 1000, 1000, (t) => t.length * 10);
    expect(rect).not.toBeNull();
    expect(rect!.w).toBeGreaterThan('A MUCH LONGER LINE'.length * 10);
  });

  it('anchors the band the same way the context anchors the text, for each alignment', () => {
    const measure = (t: string) => t.length * 10;
    const at = (align: TextLayer['align']) => bandRect(plain({ band: '#000', text: 'HI', align, xPct: 0.5 }), 1000, 1000, measure)!;
    // centre: the anchor is the middle of the band; left: near its left edge; right: near its right.
    expect(at('center').x + at('center').w / 2).toBeCloseTo(500);
    expect(at('left').x).toBeLessThan(500);
    expect(at('left').x + at('left').w).toBeGreaterThan(500);
    expect(at('right').x + at('right').w).toBeGreaterThan(500);
    expect(at('right').x).toBeLessThan(500);
  });

  it('returns no rect when the layer has no band or no text', () => {
    expect(bandRect(plain({ band: '' }), 100, 100, () => 10)).toBeNull();
    expect(bandRect(plain({ band: '#000', text: '' }), 100, 100, () => 10)).toBeNull();
  });
});

describe('one layer can never bleed into the next', () => {
  it('wraps every layer in save/restore', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [plain({ text: 'A' }), plain({ text: 'B' })], 1000, 1000);
    const ops = ctx.calls.map((c) => c.op);
    expect(ops.filter((o) => o === 'save')).toHaveLength(2);
    expect(ops.filter((o) => o === 'restore')).toHaveLength(2);
    expect(ops[0]).toBe('save');
    expect(ops[ops.length - 1]).toBe('restore');
  });

  it('gives each layer its own colour and alignment', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [
      plain({ text: 'A', color: '#ff0000', align: 'left' }),
      plain({ text: 'B', color: '#00ff00', align: 'right' }),
    ], 1000, 1000);
    const fills = ctx.calls.filter((c) => c.op === 'fillText');
    expect(fills.map((c) => c.fill)).toEqual(['#ff0000', '#00ff00']);
    expect(fills.map((c) => c.align)).toEqual(['left', 'right']);
  });
});

describe('size is measured against the shorter side, so the preview does not lie', () => {
  it('gives a landscape and a portrait of the same shorter side the SAME font size', () => {
    const layer = plain({ sizePct: 0.06 });
    expect(fontPx(layer, 1280, 720)).toBe(fontPx(layer, 720, 1280));
  });

  it('would have differed had it scaled by width — the bug this prevents', () => {
    const layer = plain({ sizePct: 0.06 });
    expect(Math.round(0.06 * 1280)).not.toBe(Math.round(0.06 * 720));
    expect(fontPx(layer, 1280, 720)).toBe(Math.round(0.06 * 720));
  });

  it('never returns a zero or negative size, whatever it is handed', () => {
    expect(fontPx(plain(), 0, 0)).toBeGreaterThan(0);
    expect(fontPx(plain(), -100, -100)).toBeGreaterThan(0);
  });
});

describe('a block grows from its middle', () => {
  it('keeps the block centred on yPct as lines are added', () => {
    const mid = (n: number) => {
      const boxes = layoutLayer(plain({ text: Array(n).fill('X').join('\n'), yPct: 0.5 }), 1000, 1000);
      return (boxes[0].y + boxes[boxes.length - 1].y) / 2;
    };
    expect(mid(3)).toBeCloseTo(mid(1), 0);
    expect(mid(5)).toBeCloseTo(mid(1), 0);
  });
});

describe('a bad value can never reach the canvas', () => {
  it('clamps size, position and alignment', () => {
    const bad = normalizeLayer({ ...defaultLayer('x', 'hi'), xPct: 9, yPct: -4, sizePct: 99, align: 'middle' as never });
    expect(bad.xPct).toBe(1);
    expect(bad.yPct).toBe(0);
    expect(bad.sizePct).toBe(MAX_SIZE_PCT);
    expect(bad.align).toBe('center');
  });

  // ⚠️ A FINITE out-of-range value and a BROKEN one are treated differently, on purpose. `xPct: 9`
  // is a drag past the edge, so it clamps TO the edge; `NaN`/`Infinity` is not a position at all, so
  // it falls back to the default. Clamping Infinity to 1 would silently move a layer to the corner
  // and look deliberate. This test asserted the wrong half first — recorded so it is not "fixed" back.
  it('sends NaN and Infinity to a usable default rather than to NaN coordinates', () => {
    const bad = normalizeLayer({ ...defaultLayer('x', 'hi'), xPct: NaN, yPct: Infinity, sizePct: 'big' as never });
    expect(bad.xPct).toBe(0.5);
    expect(bad.yPct).toBe(0.5);
    expect(bad.sizePct).toBe(0.06);
    const ctx = recorder();
    drawTextLayers(ctx, [bad], 1000, 1000);
    for (const c of ctx.calls.filter((x) => x.op === 'fillText')) {
      expect(Number.isFinite(c.args[1] as number)).toBe(true);
      expect(Number.isFinite(c.args[2] as number)).toBe(true);
    }
  });

  it('clamps the size floor as well as the ceiling', () => {
    expect(normalizeLayer({ ...defaultLayer('x', 'hi'), sizePct: 0 }).sizePct).toBe(MIN_SIZE_PCT);
  });

  it('truncates text rather than letting an unbounded string reach the canvas', () => {
    const long = 'क'.repeat(MAX_TEXT_CHARS + 50);
    expect(normalizeLayer({ ...defaultLayer('x', long) }).text).toHaveLength(MAX_TEXT_CHARS);
  });

  it('normalizes on DRAW, not only on input — a stored bad layer is still safe', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [{ ...defaultLayer('x', 'HI'), sizePct: 500, xPct: 12 }], 1000, 1000);
    const fill = ctx.calls.find((c) => c.op === 'fillText')!;
    expect(fill.args[1]).toBe(1000);
    expect(fill.font).toContain(`${Math.round(MAX_SIZE_PCT * 1000)}px`);
  });
});

describe('lines come only from what the user typed', () => {
  it('splits on explicit newlines and normalizes CRLF', () => {
    expect(textLines(plain({ text: 'A\r\nB\rC' }))).toEqual(['A', 'B', 'C']);
  });

  it('does NOT auto-wrap a long line — what is typed is what is exported', () => {
    const long = 'THIS IS A VERY LONG SINGLE LINE THAT WOULD OVERFLOW A NARROW IMAGE';
    expect(textLines(plain({ text: long }))).toEqual([long]);
  });

  it('drops trailing blank lines so the block is not pushed off-centre by stray Enters', () => {
    expect(textLines(plain({ text: 'A\n\n\n' }))).toEqual(['A']);
  });
});

describe('Devanagari detection answers the question actually asked', () => {
  it('is true for Devanagari and false for Latin, digits and emoji', () => {
    expect(hasDevanagari('शर्मा स्वीट्स')).toBe(true);
    expect(hasDevanagari('Sharma Sweets')).toBe(false);
    expect(hasDevanagari('98765 43210')).toBe(false);
    expect(hasDevanagari('🎉')).toBe(false);
    expect(hasDevanagari('')).toBe(false);
  });

  it('is true for mixed Hinglish and Hindi', () => {
    expect(hasDevanagari('Sharma जी')).toBe(true);
  });

  it('measures the glyph rather than trusting the device', () => {
    // A device WITH the font: क has its own width, different from the notdef box.
    const present = { font: '', measureText: (t: string) => ({ width: t === 'क' ? 42 : 30 }) };
    expect(devanagariRendersHere(present)).toBe(true);
    // A device WITHOUT it: both render as the same notdef box, so the widths match exactly.
    const missing = { font: '', measureText: () => ({ width: 30 }) };
    expect(devanagariRendersHere(missing)).toBe(false);
  });

  it('asks using the same font stack it will draw with', () => {
    let asked = '';
    devanagariRendersHere({ get font() { return asked; }, set font(v: string) { asked = v; }, measureText: () => ({ width: 5 }) });
    expect(asked).toContain(FONT_STACK);
  });

  it('does not call a device broken when it cannot measure at all', () => {
    expect(devanagariRendersHere({ font: '', measureText: () => { throw new Error('no canvas'); } })).toBe(true);
  });
});

describe('the warning is shown only when it is true and useful', () => {
  it('says nothing when the font is present', () => {
    expect(devanagariWarning([plain({ text: 'शर्मा' })], true)).toBeNull();
  });

  it('says nothing when the font is missing but nobody typed Devanagari', () => {
    expect(devanagariWarning([plain({ text: 'SHARMA' })], false)).toBeNull();
  });

  it('warns, and offers Hinglish, when the font is missing and Devanagari was typed', () => {
    const msg = devanagariWarning([plain({ text: 'SHARMA' }), plain({ text: 'शर्मा' })], false);
    expect(msg).toContain('Hinglish');
  });
});

describe('the default layer is readable on the first try', () => {
  it('is white on a dark band with an outline — legible on any photo', () => {
    const d = defaultLayer('a', 'X');
    expect(d.color).toBe('#ffffff');
    expect(d.band).not.toBe('');
    expect(d.outline).toBe(true);
  });

  it('sits inside the image, low down where a caption belongs', () => {
    const d = defaultLayer('a', 'X');
    expect(d.xPct).toBeGreaterThan(0);
    expect(d.xPct).toBeLessThan(1);
    expect(d.yPct).toBeGreaterThan(0.5);
    expect(d.yPct).toBeLessThan(1);
  });
});


describe('the whole picture: image first, then the words on top', () => {
  it('clears, draws the image, THEN draws the text', () => {
    const ctx = composer();
    composeImage(ctx, { naturalWidth: 800, naturalHeight: 600 }, [plain({ text: 'HI' })]);
    const ops = ctx.calls.filter((c) => ['clearRect', 'drawImage', 'fillText'].includes(c.op)).map((c) => c.op);
    expect(ops).toEqual(['clearRect', 'drawImage', 'fillText']);
  });

  it('would hide the text if the order were reversed — the bug this order prevents', () => {
    // Stated as a test so the invariant is not merely a comment: the LAST thing drawn is the text.
    const ctx = composer();
    composeImage(ctx, { naturalWidth: 800, naturalHeight: 600 }, [plain({ text: 'HI' })]);
    const drawn = ctx.calls.filter((c) => ['drawImage', 'fillText'].includes(c.op));
    expect(drawn[drawn.length - 1].op).toBe('fillText');
  });

  it('draws the image at its full natural size, not its displayed size', () => {
    const ctx = composer();
    const size = composeImage(ctx, { naturalWidth: 1280, naturalHeight: 720, width: 320, height: 180 }, []);
    expect(size).toEqual({ w: 1280, h: 720 });
    expect(ctx.calls.find((c) => c.op === 'drawImage')?.args).toEqual([0, 0, 1280, 720]);
  });

  it('falls back to the displayed size when there is no natural size', () => {
    expect(imagePixels({ width: 500, height: 400 })).toEqual({ w: 500, h: 400 });
  });

  it('never produces a zero-sized canvas from a broken image', () => {
    expect(imagePixels({})).toEqual({ w: 1, h: 1 });
    expect(imagePixels({ naturalWidth: NaN, naturalHeight: -5 })).toEqual({ w: 1, h: 1 });
  });

  it('still draws the picture when no text was typed, so Done is never destructive', () => {
    const ctx = composer();
    composeImage(ctx, { naturalWidth: 100, naturalHeight: 100 }, [plain({ text: '' })]);
    expect(ctx.calls.some((c) => c.op === 'drawImage')).toBe(true);
    expect(ctx.calls.some((c) => c.op === 'fillText')).toBe(false);
  });

  it('sizes the text against the composed image, so the preview matches the export exactly', () => {
    // The preview canvas and the exported file are the SAME canvas at the SAME pixel size, so this
    // is really asserting that `composeImage` derives its dimensions from the image and nothing else.
    const layer = plain({ text: 'HI', sizePct: 0.1 });
    const ctx = composer();
    composeImage(ctx, { naturalWidth: 1280, naturalHeight: 720 }, [layer]);
    expect(ctx.calls.find((c) => c.op === 'fillText')?.font).toBe(fontString(layer, 1280, 720));
  });
});

describe('the feature is actually wired to both tiers', () => {
  // ⚠️ SOURCE-LEVEL ON PURPOSE. `tsc` and `vitest` cannot see a deleted JSX element or a second
  // renderer quietly added beside the first — this repo has four recorded incidents of a test
  // passing while the call site it guarded was gutted. Comment lines are dropped so a mention in
  // prose can never satisfy an assertion.
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  const FREE = 'src/components/ide/AIImageGenerator.tsx';
  const PRO = 'src/components/ide/ImageStudioPro.tsx';
  const EDITOR = 'src/components/ide/TextOverlayEditor.tsx';

  it('the free image generator renders the editor', () => {
    expect(code(FREE)).toContain('<TextOverlayEditor');
  });

  it('the Pro studio renders the editor too — a paying user never loses a capability', () => {
    expect(code(PRO)).toContain('<TextOverlayEditor');
  });

  it('both tiers apply the result, so Done is not a button that does nothing', () => {
    expect(code(FREE)).toContain('onApply=');
    expect(code(PRO)).toContain('onApply=');
  });

  it('the editor has exactly ONE drawing path — preview and export cannot diverge', () => {
    const src = code(EDITOR);
    // One call to composeImage, and no direct drawTextLayers/drawImage beside it. A second renderer
    // is the failure this guards: it would look right on screen and export something else.
    expect(src.match(/composeImage\s*</g) ?? []).toHaveLength(1);
    expect(src).not.toContain('drawTextLayers(');
    expect(src).not.toContain('.drawImage(');
  });

  it('the export reads the canvas only AFTER repainting it', () => {
    const src = code(EDITOR);
    const painted = src.indexOf('if (!paint(canvas, image))');
    const read = src.indexOf('toDataURL');
    expect(painted).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(painted);
  });

  it('crossOrigin is set BEFORE src, or a remote image taints the canvas and Done fails at the end', () => {
    const src = code(EDITOR);
    expect(src.indexOf('img.crossOrigin')).toBeLessThan(src.indexOf('img.src ='));
  });

  it('the spelling advice names the button that now exists', () => {
    expect(code('src/server/lib/imagePromptCraft.ts')).toContain('"Add text"');
  });
});
