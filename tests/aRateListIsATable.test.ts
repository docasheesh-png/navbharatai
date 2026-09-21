// A rate list is a TABLE, not a caption with spaces in it.
//
// Spaces cannot align a column — every glyph is a different width, so "चाय    10" and "समोसा   15"
// land their prices in different places and the card reads as a mistake. A menu therefore needs its
// own layer kind that sets labels against one edge and prices against the other.
//
// The same change adds the two things a long address needed: WRAPPING (so a line too wide for the
// box breaks instead of leaving the picture) and AUTO-FIT (so a block too tall for the picture
// shrinks instead of running off the bottom).
//
// Every rule here is driven by an INJECTED measure function, which is what lets a wrap be tested
// exactly. The first version of this module refused to wrap precisely because a guessing layout and a
// measuring canvas would disagree; handing both the same function is the answer to that, and these
// tests are what prove the two stay in step.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  MAX_LIST_ROWS,
  MAX_TEXT_CHARS,
  MIN_FIT_SCALE,
  bandRect,
  defaultLayer,
  drawTextLayers,
  fittedFontPx,
  fontPx,
  layerBox,
  layoutLayer,
  normalizeLayer,
  parseListRow,
  renderedLines,
  wrapLine,
  type Measure,
  type TextContext,
  type TextLayer,
} from '../src/lib/textOverlay';

type Call = { op: string; args: unknown[]; align: string; fill: unknown };

/** Every character is exactly 10px wide, so every expected width below is arithmetic, not a guess. */
function recorder(charWidth = 10) {
  const calls: Call[] = [];
  const ctx: TextContext & { calls: Call[] } = {
    calls,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '', textAlign: '', textBaseline: '',
    save() {}, restore() {},
    measureText(text: string) { return { width: text.length * charWidth }; },
    fillText(text: string, x: number, y: number) { calls.push({ op: 'fillText', args: [text, x, y], align: this.textAlign, fill: this.fillStyle }); },
    strokeText(text: string, x: number, y: number) { calls.push({ op: 'strokeText', args: [text, x, y], align: this.textAlign, fill: this.fillStyle }); },
    fillRect(x: number, y: number, w: number, h: number) { calls.push({ op: 'fillRect', args: [x, y, w, h], align: this.textAlign, fill: this.fillStyle }); },
  };
  return ctx;
}

const measure: Measure = (text) => text.length * 10;

const list = (text: string, over: Partial<TextLayer> = {}): TextLayer =>
  ({ ...defaultLayer('l', text, 'list'), band: '', outline: false, ...over });
const caption = (text: string, over: Partial<TextLayer> = {}): TextLayer =>
  ({ ...defaultLayer('c', text), band: '', outline: false, ...over });

describe('a price is read from the END of the line, never the first number', () => {
  it('reads an ordinary row', () => {
    expect(parseListRow('चाय 10')).toEqual({ label: 'चाय', value: '10' });
    expect(parseListRow('Masala Dosa 90')).toEqual({ label: 'Masala Dosa', value: '90' });
  });

  it('keeps a number that belongs to the ITEM — the bug that would sell samosa for ₹2', () => {
    expect(parseListRow('2 piece samosa 15')).toEqual({ label: '2 piece samosa', value: '15' });
    expect(parseListRow('500ml Coke 40')).toEqual({ label: '500ml Coke', value: '40' });
    expect(parseListRow('Thali No.1 120')).toEqual({ label: 'Thali No.1', value: '120' });
  });

  it('understands the shapes a real menu is written in', () => {
    expect(parseListRow('Masala Dosa ₹90').value).toBe('₹90');
    expect(parseListRow('Coffee Rs 45').value).toBe('Rs 45');
    expect(parseListRow('Paneer 120/-').value).toBe('120/-');
    expect(parseListRow('Chowmein 60-80').value).toBe('60-80');
    expect(parseListRow('Butter Naan 45.50').value).toBe('45.50');
    expect(parseListRow('Milk 25 kg').value).toBe('25 kg');
  });

  it('treats a line with no price as a HEADING, not a row with an empty price', () => {
    expect(parseListRow('Snacks')).toEqual({ label: 'Snacks', value: '' });
    expect(parseListRow('— नाश्ता —').value).toBe('');
  });

  it('survives an empty or whitespace line', () => {
    expect(parseListRow('')).toEqual({ label: '', value: '' });
    expect(parseListRow('   ')).toEqual({ label: '', value: '' });
  });
});

describe('the two columns are set against the box, not against each other', () => {
  const menu = 'चाय 10\nसमोसा 15\nकॉफ़ी 25';

  it('puts every label on one left edge and every price on one right edge', () => {
    const layer = list(menu, { xPct: 0.5, widthPct: 0.6 });
    const boxes = layoutLayer(layer, 1000, 1000, measure);
    const box = layerBox(layer, 1000);
    expect(boxes.map((b) => b.x)).toEqual([box.left, box.left, box.left]);
    expect(boxes.map((b) => b.valueX)).toEqual([box.right, box.right, box.right]);
  });

  it('carries the price separately from the label', () => {
    const boxes = layoutLayer(list(menu), 1000, 1000, measure);
    expect(boxes.map((b) => b.text)).toEqual(['चाय', 'समोसा', 'कॉफ़ी']);
    expect(boxes.map((b) => b.value)).toEqual(['10', '15', '25']);
  });

  it('draws the price right-aligned, and the label left-aligned, in the same row', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [list('Tea 10')], 1000, 1000);
    const fills = ctx.calls.filter((c) => c.op === 'fillText');
    expect(fills.map((c) => [c.args[0], c.align])).toEqual([['Tea', 'left'], ['10', 'right']]);
    expect(fills[0].args[2]).toBe(fills[1].args[2]); // same baseline — it is one row
  });

  it('a heading spans the row with no price and no leader', () => {
    const boxes = layoutLayer(list('Snacks\nSamosa 15'), 1000, 1000, measure);
    expect(boxes[0].value).toBeUndefined();
    expect(boxes[0].leader).toBeUndefined();
    expect(boxes[1].value).toBe('15');
  });

  it('drops rows past the cap rather than drawing them off the picture', () => {
    const many = Array.from({ length: MAX_LIST_ROWS + 6 }, (_, i) => `Item${i} ${i}`).join('\n');
    expect(renderedLines(list(many), 1000, 1000, measure)).toHaveLength(MAX_LIST_ROWS);
  });
});

describe('the dotted leader', () => {
  it('is drawn between the label and the price, inside the gap', () => {
    const ctx = recorder();
    const layer = list('Tea 10', { xPct: 0.5, widthPct: 0.6 });
    drawTextLayers(ctx, [layer], 1000, 1000);
    const box = layerBox(layer, 1000);
    const dots = ctx.calls.filter((c) => c.op === 'fillRect');
    expect(dots.length).toBeGreaterThan(3);
    for (const d of dots) {
      expect(d.args[0] as number).toBeGreaterThan(box.left);
      expect(d.args[0] as number).toBeLessThan(box.right);
    }
  });

  it('is skipped when the columns nearly touch — a two-dot leader reads as dirt', () => {
    const ctx = recorder();
    // A label that fills almost the whole box leaves no room for a leader.
    drawTextLayers(ctx, [list('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA 10', { widthPct: 0.45 })], 1000, 1000);
    expect(ctx.calls.filter((c) => c.op === 'fillRect')).toHaveLength(0);
  });

  it('is never drawn for a caption', () => {
    const ctx = recorder();
    drawTextLayers(ctx, [caption('Sharma Sweets')], 1000, 1000);
    expect(ctx.calls.filter((c) => c.op === 'fillRect')).toHaveLength(0);
  });
});

describe('a long line wraps instead of leaving the picture', () => {
  it('breaks an address at word boundaries', () => {
    const lines = wrapLine('Shop 12, Nehru Market, Civil Lines, Kanpur 208001', 200, '20px x', measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, '20px x')).toBeLessThanOrEqual(200);
    expect(lines.join(' ')).toBe('Shop 12, Nehru Market, Civil Lines, Kanpur 208001');
  });

  it('breaks a single over-long word rather than letting it run off', () => {
    const lines = wrapLine('AAAAAAAAAAAAAAAAAAAAAAAA', 100, '20px x', measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measure(l, '20px x')).toBeLessThanOrEqual(100);
    expect(lines.join('')).toBe('AAAAAAAAAAAAAAAAAAAAAAAA');
  });

  it('leaves a line that already fits exactly alone', () => {
    expect(wrapLine('abc', 1000, '20px x', measure)).toEqual(['abc']);
    expect(wrapLine('', 100, '20px x', measure)).toEqual(['']);
  });

  it('never wraps without a measure — the caller keeps the old behaviour by construction', () => {
    const long = caption('a very long single line that would certainly need wrapping at this size');
    expect(renderedLines(long, 300, 300)).toHaveLength(1);
    expect(renderedLines(long, 300, 300, measure).length).toBeGreaterThan(1);
  });

  it('still honours explicit newlines exactly — wrapping only ever ADDS breaks', () => {
    expect(renderedLines(caption('AB\nCD'), 10000, 10000, measure)).toEqual(['AB', 'CD']);
  });

  it('a list row is never word-wrapped — a broken row would break its column', () => {
    const long = list('A very long dish name indeed that is wider than the box 120', { widthPct: 0.2 });
    expect(renderedLines(long, 300, 300, measure)).toHaveLength(1);
  });
});

describe('auto-fit shrinks a block that is taller than the picture', () => {
  it('shrinks a tall rate card', () => {
    const many = Array.from({ length: 18 }, (_, i) => `Item ${i} ${i * 5}`).join('\n');
    const layer = list(many, { sizePct: 0.12 });
    expect(fittedFontPx(layer, 1000, 1000, measure)).toBeLessThan(fontPx(layer, 1000, 1000));
  });

  it('leaves a block that already fits completely alone', () => {
    const layer = list('Tea 10', { sizePct: 0.06 });
    expect(fittedFontPx(layer, 1000, 1000, measure)).toBe(fontPx(layer, 1000, 1000));
  });

  it('never shrinks past the floor — unreadable text is worse than a visible clip', () => {
    const many = Array.from({ length: MAX_LIST_ROWS }, (_, i) => `Item ${i} ${i}`).join('\n');
    const layer = list(many, { sizePct: 0.25 });
    const chosen = fontPx(layer, 1000, 1000);
    expect(fittedFontPx(layer, 1000, 1000, measure)).toBeGreaterThanOrEqual(Math.floor(chosen * MIN_FIT_SCALE));
  });

  it('does nothing without a measure, so no caller auto-fits behind its own back', () => {
    const many = Array.from({ length: 18 }, (_, i) => `Item ${i} ${i}`).join('\n');
    const layer = list(many, { sizePct: 0.12 });
    expect(fittedFontPx(layer, 1000, 1000)).toBe(fontPx(layer, 1000, 1000));
  });

  it('the size it draws with is the size it fitted', () => {
    const many = Array.from({ length: 18 }, (_, i) => `Item ${i} ${i * 5}`).join('\n');
    const layer = list(many, { sizePct: 0.12 });
    const ctx = recorder();
    drawTextLayers(ctx, [layer], 1000, 1000);
    const fitted = fittedFontPx(layer, 1000, 1000, measure);
    expect(ctx.font).toContain(`${fitted}px`);
  });
});

describe('the band covers what is actually drawn', () => {
  it("spans a list's whole box, so prices are never left on the bare photo", () => {
    const layer = list('Tea 10\nSamosa 15', { band: '#000', widthPct: 0.6, xPct: 0.5 });
    const rect = bandRect(layer, 1000, 1000, measure)!;
    const box = layerBox(layer, 1000);
    expect(rect.x).toBeLessThanOrEqual(box.left);
    expect(rect.x + rect.w).toBeGreaterThanOrEqual(box.right);
  });

  it('grows to cover every WRAPPED line of a caption, not just the typed ones', () => {
    const one = bandRect(caption('short', { band: '#000' }), 1000, 1000, measure)!;
    const wrapped = bandRect(caption('a much longer caption that will certainly wrap several times over', { band: '#000', widthPct: 0.3 }), 1000, 1000, measure)!;
    expect(wrapped.h).toBeGreaterThan(one.h);
  });
});

describe('the new limits are real, and bounded', () => {
  it('holds a whole rate card, where 120 characters could not', () => {
    // A real shop board, written the way shops actually write one. Note the length: the old 120-char
    // cap was sized for a caption and would have cut this menu off after the sixth item.
    const menu = [
      'Masala Chai 10', 'Samosa 15', 'Filter Coffee 25', 'Masala Dosa 90', 'Idli Sambar 40',
      'Medu Vada 35', 'Upma 45', 'Poha 30', 'Jalebi 60', 'Sweet Lassi 50',
    ].join('\n');
    expect(menu.length).toBeGreaterThan(120);
    expect(menu.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    expect(normalizeLayer(list(menu)).text).toBe(menu);
    // And it really lays out as ten rows with ten prices, not as one long caption.
    const boxes = layoutLayer(list(menu), 1000, 1400, measure);
    expect(boxes).toHaveLength(10);
    expect(boxes.every((b) => !!b.value)).toBe(true);
  });

  it('still truncates past the new cap', () => {
    expect(normalizeLayer(list('x'.repeat(MAX_TEXT_CHARS + 50))).text).toHaveLength(MAX_TEXT_CHARS);
  });

  it('clamps the box width, and never to zero — a zero box cannot be wrapped into', () => {
    expect(normalizeLayer({ ...caption('x'), widthPct: 0 }).widthPct).toBe(0.1);
    expect(normalizeLayer({ ...caption('x'), widthPct: 9 }).widthPct).toBe(1);
    expect(normalizeLayer({ ...caption('x'), widthPct: NaN as never }).widthPct).toBe(0.86);
  });

  it('an unknown kind falls back to a caption, never to a half-parsed table', () => {
    expect(normalizeLayer({ ...caption('x'), kind: 'table' as never }).kind).toBe('text');
  });
});

describe('dragging still means what it meant', () => {
  it('anchors a caption at the drag point for EVERY alignment, not at the box edge', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const boxes = layoutLayer(caption('HI', { align, xPct: 0.5 }), 1000, 1000, measure);
      expect(boxes[0].x).toBe(500);
    }
  });

  it('moves the whole card when a list is dragged', () => {
    const at = (xPct: number) => layoutLayer(list('Tea 10', { xPct }), 1000, 1000, measure)[0];
    expect(at(0.6).x - at(0.4).x).toBeCloseTo(200);
  });
});


describe('the rate list is reachable, not just implemented', () => {
  // Source-level: `tsc` and `vitest` cannot see a control that was never rendered, and a rate list
  // nobody can switch to is the "built but not really working" state the second absolute rule bans.
  const code = (path: string) =>
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');

  const EDITOR = 'src/components/ide/TextOverlayEditor.tsx';

  it('offers both kinds as a real control', () => {
    const src = code(EDITOR);
    expect(/KINDS\.map\(/.test(src)).toBe(true);
    expect(src).toContain("id: 'list'");
    expect(src).toContain("id: 'text'");
  });

  it('the kind button actually changes the layer, rather than only looking pressed', () => {
    expect(/patch\(active\.id,\s*\{\s*kind:/.test(code(EDITOR))).toBe(true);
  });

  it('the box width is adjustable — without it a list cannot be sized to the picture', () => {
    expect(/patch\(active\.id,\s*\{\s*widthPct:/.test(code(EDITOR))).toBe(true);
  });

  it('still has exactly ONE drawing path after all of this', () => {
    const src = code(EDITOR);
    expect(src.match(/composeImage\s*</g) ?? []).toHaveLength(1);
    expect(src).not.toContain('drawTextLayers(');
  });
});
