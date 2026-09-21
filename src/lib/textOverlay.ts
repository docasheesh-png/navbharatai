// Real text on a generated image — the half no image model can do (admin-asked 2026-09-21).
//
// WHY THIS EXISTS, in one measured sentence: Z-Image Turbo renders English of 1–5 words accurately
// and "longer strings — full sentences or paragraphs — remain unreliable: missing letters, reordered
// characters, distorted glyphs", and Devanagari is unverified for it and for every alternative that
// fits the ₹1 price. So the shop name can come from the model; the PHONE NUMBER cannot.
//
// 🔴 THE FAILURE THIS PREVENTS IS NOT AN UGLY IMAGE, IT IS A WRONG ONE. A model does not write text,
// it imitates the SHAPE of text — so it returns digits that look right and are not. A banner printed
// with a wrong phone number is a real loss to a real shopkeeper, and it is the app they will blame.
// `imagePromptCraft.ts` has been telling users this since it was written ("Image engines are
// unreliable at spelling … you will get a cleaner result adding the text yourself afterwards").
// This module is that "afterwards" — the first time the advice has had a button behind it.
//
// 🧬 AND IT IS WHY DEVANAGARI IS SOLVED HERE RATHER THAN BOUGHT. The script needs conjuncts (क्ष, त्र,
// ज्ञ), matras that are STORED after their consonant and DRAWN before it (कि), and a शिरोरेखा joining
// a whole word. That is glyph SHAPING, which a font engine does perfectly and a diffusion model
// cannot do at all. The browser's own text engine is therefore not a cheap substitute for a better
// model — it is strictly better than any model at this one job, and it costs ₹0.
//
// 🔒 PURE BY CONSTRUCTION. Nothing here touches the DOM, `window`, or a real canvas: `drawTextLayers`
// takes anything shaped like a 2D context, which is what lets the tests assert the EXACT draw calls
// — font string, x, y, colour, order — instead of asserting that a component rendered. This repo has
// been bitten four times by a test that passed while the call site was gutted; a recording fake is
// the answer to that, not a snapshot.

import { DEFAULT_FONT_ID, FONT_STACK as DEFAULT_FONT_STACK, fontChoice, fontFamilyStack } from './imageFonts';

// ⚠️ THE COLOURS BELOW ARE THE USER'S PICTURE, NOT OUR UI — so they are literals on purpose, and
// the theme-token rule does not reach them. This is the precedent `inlineThemeColours.test.ts`
// already sets for `MultiPageBuilder` and `DarkModeGenerator` ("the user's colours are not ours"):
// a caption painted with `--text-ink` would turn black on the Light theme and vanish into a dark
// photo, because the photo has no theme. They are named constants rather than inline strings so the
// reason is attached to the value instead of living only here.

/** Default caption colour: white reads on the widest range of photographs. */
const DEFAULT_TEXT_COLOR = '#ffffff';
/** Default band: a translucent black bar, which is what a real banner puts behind a headline. */
const DEFAULT_BAND = 'rgba(0,0,0,0.55)';
/** The two outline colours — one for light text, one for dark. Not themeable, for the reason above. */
const OUTLINE_DARK = '#000000';
const OUTLINE_LIGHT = '#ffffff';
/** The default border, drawn only when a width is chosen — white reads against most photographs. */
const DEFAULT_BORDER_COLOR = '#ffffff';
/** The widest border we will draw, as a fraction of the font size. Past this it eats the letters. */
export const MAX_BORDER_PCT = 0.2;

/** Where a layer's box sits, as a fraction of the image. Percentages, so one layer fits every size. */
/**
 * What a layer IS.
 *
 * `text` is a caption — words laid out as lines. `list` is a rate card: every line is split into a
 * LABEL and a VALUE, the label set against the left edge of the box and the value against the right,
 * with a dotted leader between them. A menu is not a caption with spaces in it — spaces cannot align
 * a column, because every glyph is a different width — so it needs its own kind rather than a
 * convention users have to get right.
 */
export type LayerKind = 'text' | 'list';

export interface TextLayer {
  id: string;
  kind: LayerKind;
  text: string;
  /** Centre of the text box, 0..1 across the image. */
  xPct: number;
  /** Centre of the text box, 0..1 down the image. */
  yPct: number;
  /** Font size as a fraction of the image's SHORTER side (see `fontPx` for why). */
  sizePct: number;
  color: string;
  /** A contrasting outline, so light text stays readable on a light photo. */
  outline: boolean;
  /**
   * The BACKGROUND behind the text, as a finished CSS colour. Empty string = none.
   *
   * 🔒 ONE REPRESENTATION, DELIBERATELY. The editor shows it as a colour plus an opacity slider, but
   * it is STORED as the single string that gets filled — `rgbaFrom` composes the two into it and
   * `splitFill` reads them back out. Keeping a separate `bandColor` and `bandOpacity` beside this
   * would be two sources for one fact, which is the drifted-copy class this repo has paid for four
   * times; the pair that the UI needs is derived on demand instead.
   */
  band: string;
  /**
   * Which face draws this layer — an id from `imageFonts.ts`, never a raw family name.
   *
   * An id rather than a family string because the family alone cannot say whether the face has to be
   * FETCHED before the canvas can measure it, and a canvas that measures an unloaded font silently
   * lays out in the fallback and then repaints in the real one — so the preview the user positioned
   * is not the file they save.
   */
  fontId: string;
  /**
   * A border around the background box, as a fraction of the font size. 0 = none.
   *
   * Relative to the FONT rather than to the image, so a 2px-looking edge on a 1024 square is still a
   * 2px-looking edge on a 1280 banner. An absolute pixel width would be a hairline on one and a slab
   * on the other, and the user only ever sees one of them while choosing.
   */
  borderPct: number;
  /** The border's colour. Kept separate from the text's: a border is most useful when it contrasts. */
  borderColor: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  /**
   * What this layer is FOR, when a template placed it — "Shop name", "Phone".
   *
   * ⚠️ UI ONLY, AND IT MUST STAY THAT WAY. It is never drawn, never measured and never exported; it
   * exists so an empty slot from a template reads as "Phone" in the layer chips instead of as
   * "Text 3". A label that could reach the canvas would be a caption nobody typed.
   */
  label?: string;
  /**
   * The box's width, as a fraction of the image's width.
   *
   * Needed for two things that did not exist before: it is the width a long line WRAPS at, and it is
   * the span a list's two columns are set against. A caption anchored at a point has no width, which
   * is exactly why the first version could do neither.
   */
  widthPct: number;
}

/**
 * The default stack and the catalogue behind the font picker.
 *
 * ⚠️ NAMED FAMILIES FIRST, AND THAT IS NOT DECORATION. A bare `sans-serif` DOES resolve Devanagari on
 * every OS — but it picks the system's default UI face, which on Android is Roboto and falls back
 * per-glyph to Noto with a different vertical rhythm, so a line of mixed Hinglish and Hindi
 * ("Sharma जी") comes out on two visual baselines. Naming the Devanagari face first makes both halves
 * come from one family wherever that family exists. `imageFonts.ts` holds the reasoning in full.
 *
 * Re-exported here because this module was the stack's home before the picker existed, and a caller
 * that imports it from here is not wrong — it is just one hop from the list that owns it.
 */
export { FONT_STACK } from './imageFonts';

/** Devanagari, including the Extended block — a range check, never a language guess. */
const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;

/**
 * Does this text contain Devanagari at all?
 *
 * Deliberately NOT `devanagariLanguage()` from `IndicLanguage.ts`, which answers a different question
 * ("Hindi or Marathi?") and answers Hindi for a string with no Indic characters in it. Asking the
 * wrong helper because its name matched is how a wrong answer gets a confident source.
 */
export function hasDevanagari(text: string): boolean {
  return DEVANAGARI.test(String(text ?? ''));
}

export const MAX_LAYERS = 10;
/**
 * 400, not 120.
 *
 * 120 was sized for a caption and made a rate card impossible: ten items with prices is ~150–250
 * characters before anybody has typed an address. The cap exists to bound what reaches the canvas,
 * not to bound what a shop sells.
 */
export const MAX_TEXT_CHARS = 400;
/** A list's rows, past which extra lines are dropped rather than drawn off the bottom. */
export const MAX_LIST_ROWS = 20;
/** How far auto-fit may shrink the chosen size before it gives up and lets the text be clipped. */
export const MIN_FIT_SCALE = 0.5;
/** Gap between baselines, as a multiple of the font size. */
const LINE_HEIGHT = 1.25;
/** Size bounds as a fraction of the shorter side: readable on a phone, never taller than the image. */
export const MIN_SIZE_PCT = 0.02;
export const MAX_SIZE_PCT = 0.30;

/** Clamp to [lo, hi], and send anything unreadable (NaN, Infinity, a string) to `fallback`. */
function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * A new layer, centred, sized to read on a phone.
 *
 * 0.06 of the shorter side is ~61px on a 1024 square — about what a banner headline wants. The
 * default is a white word on a dark band because that is legible on ANY photo, which a bare colour
 * is not: the one thing a default must never do is produce text nobody can read on the first try.
 */
export function defaultLayer(id: string, text = '', kind: LayerKind = 'text'): TextLayer {
  return {
    id,
    kind,
    text,
    xPct: 0.5,
    yPct: 0.82,
    sizePct: 0.06,
    color: DEFAULT_TEXT_COLOR,
    outline: true,
    band: DEFAULT_BAND,
    // A list reads left-to-right against its own box, so centring its labels would undo the column.
    align: kind === 'list' ? 'left' : 'center',
    bold: true,
    widthPct: kind === 'list' ? 0.7 : 0.86,
    fontId: DEFAULT_FONT_ID,
    borderPct: 0,
    borderColor: DEFAULT_BORDER_COLOR,
  };
}

/** Force any stored/edited layer back inside its bounds. Applied on every draw, never only on input. */
export function normalizeLayer(layer: TextLayer): TextLayer {
  const align = layer.align === 'left' || layer.align === 'right' ? layer.align : 'center';
  return {
    ...layer,
    kind: layer.kind === 'list' ? 'list' : 'text',
    text: String(layer.text ?? '').slice(0, MAX_TEXT_CHARS),
    xPct: clamp(layer.xPct, 0, 1, 0.5),
    yPct: clamp(layer.yPct, 0, 1, 0.5),
    sizePct: clamp(layer.sizePct, MIN_SIZE_PCT, MAX_SIZE_PCT, 0.06),
    align,
    outline: !!layer.outline,
    bold: !!layer.bold,
    color: typeof layer.color === 'string' && layer.color ? layer.color : DEFAULT_TEXT_COLOR,
    band: typeof layer.band === 'string' ? layer.band : '',
    // Never 0 — a zero-width box would divide by nothing in the wrap and produce an endless loop of
    // one-character lines. 0.1 is narrow enough to be a deliberate choice and wide enough to draw.
    widthPct: clamp(layer.widthPct, 0.1, 1, 0.86),
    // An id nothing matches falls back to the default face rather than to an empty family: a layer
    // saved on a build that knew a font this build does not must still draw.
    fontId: fontChoice(String(layer.fontId ?? '')).id,
    borderPct: clamp(layer.borderPct, 0, MAX_BORDER_PCT, 0),
    borderColor: typeof layer.borderColor === 'string' && layer.borderColor ? layer.borderColor : DEFAULT_BORDER_COLOR,
  };
}

/**
 * Font size in real pixels.
 *
 * 🔑 MEASURED AGAINST THE SHORTER SIDE, and this is the whole reason the editor's preview can be
 * trusted. Scale by WIDTH and the same layer is a headline on a 1280×720 banner and a whisper on an
 * 864×1152 portrait — the preview box and the exported file have different aspect ratios in practice,
 * so a width-relative size would export at a size the user never saw. The shorter side is the one
 * dimension both share a feel for.
 */
export function fontPx(layer: TextLayer, w: number, h: number): number {
  const shorter = Math.min(Math.max(1, w), Math.max(1, h));
  return Math.max(1, Math.round(normalizeLayer(layer).sizePct * shorter));
}

/** The CSS font shorthand a 2D context wants. Line-height is omitted; we place lines ourselves. */
export function fontString(layer: TextLayer, w: number, h: number): string {
  return fontStringAt(layer, fontPx(layer, w, h));
}

/**
 * The same shorthand at an explicit size — what auto-fit needs while it is still choosing one.
 *
 * ⚠️ THE FAMILY COMES FROM THE LAYER, AND THE SAME STRING IS USED TO MEASURE AND TO DRAW. That is
 * what keeps wrapping honest under a chosen font: `wrapLine` breaks where `measureText` says the box
 * ends, so measuring in one face and drawing in another would put the break in the wrong place. One
 * function, both jobs — which is also why the editor waits for a font to load before repainting.
 */
export function fontStringAt(layer: TextLayer, size: number): string {
  const family = fontFamilyStack(fontChoice(String(layer.fontId ?? '')).id);
  return `${layer.bold ? '700 ' : '400 '}${Math.max(1, Math.round(size))}px ${family}`;
}

/**
 * Compose a background fill from a colour and an opacity. Opacity at or below 0 means NO background,
 * which is how "remove the background" is expressed — a separate on/off flag beside the slider would
 * be a second way to say the same thing, and the two would drift.
 *
 * PURE.
 */
export function rgbaFrom(hex: string, alpha: number): string {
  const a = Number(alpha);
  if (!Number.isFinite(a) || a <= 0) return '';
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const clamped = Math.min(1, a);
  if (clamped >= 1) return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${Math.round(clamped * 100) / 100})`;
}

/**
 * Read a stored fill back into the colour and opacity the editor's two controls show.
 *
 * The inverse of `rgbaFrom`, and it must also read what earlier code wrote by hand
 * (`rgba(0,0,0,0.55)`, `#000`), because those strings are on layers real users already have and in
 * every template. Anything unreadable comes back as "no background" rather than as a guess.
 *
 * PURE.
 */
export function splitFill(css: string): { hex: string; alpha: number } {
  const raw = String(css ?? '').trim();
  if (!raw) return { hex: '#000000', alpha: 0 };
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(raw);
  if (rgba) {
    const a = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return { hex: toHex(Number(rgba[1]), Number(rgba[2]), Number(rgba[3])), alpha: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1 };
  }
  const rgb = hexToRgb(raw);
  if (rgb) return { hex: toHex(rgb.r, rgb.g, rgb.b), alpha: 1 };
  return { hex: '#000000', alpha: 0 };
}

function hexToRgb(value: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  return { r: parseInt(body.slice(0, 2), 16), g: parseInt(body.slice(2, 4), 16), b: parseInt(body.slice(4, 6), 16) };
}

function toHex(r: number, g: number, b: number): string {
  const part = (n: number) => Math.min(255, Math.max(0, Math.round(Number(n) || 0))).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Split a layer's text into drawable lines.
 *
 * Only on EXPLICIT newlines — there is deliberately no automatic word wrap. Wrapping needs
 * `measureText`, which means the pure layout and the real canvas would each have their own idea of
 * where a line breaks, and they would disagree the moment a font is substituted. The user presses
 * Enter where they want the break, and what they see is what is exported. A blank line is kept: it
 * is spacing somebody typed on purpose.
 */
export function textLines(layer: TextLayer): string[] {
  const raw = String(layer.text ?? '').replace(/\r\n?/g, '\n');
  if (!raw) return [];
  const lines = raw.split('\n');
  // Trailing blank lines are an artefact of typing, not spacing anyone asked for.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines;
}

/** How wide a string is, in the given font. Injected so every layout rule stays pure and testable. */
export type Measure = (text: string, font: string) => number;

/** One row of a rate card: what is being sold, and for how much. */
export interface ListRow { label: string; value: string }

/**
 * Split a rate-card line into its label and its value.
 *
 * The value is the PRICE at the END of the line — a trailing run of digits, optionally carrying a
 * currency mark, a decimal part, or a range/unit ("10", "₹10", "10.50", "10/-", "10-15", "₹10 kg").
 * Everything before it is the label.
 *
 * ⚠️ IT ANCHORS AT THE END, NOT AT THE FIRST NUMBER, and that is the whole correctness of it: a real
 * menu is full of labels containing digits — "2 piece samosa 15", "500ml Coke 40", "Thali No.1 120".
 * Taking the first number would sell "piece samosa 15" for ₹2. A line with no trailing number is not
 * a row with an empty price; it is a HEADING ("Snacks"), and it is returned with an empty value so
 * the caller can set it across the full width instead of squeezing it into a column.
 */
export function parseListRow(line: string): ListRow {
  const raw = String(line ?? '').trim();
  if (!raw) return { label: '', value: '' };
  const m = /^(.*?)[\s.\u00b7]*((?:₹|rs\.?|inr)?\s*\d+(?:[.,]\d+)?(?:\s*[-\u2013]\s*\d+(?:[.,]\d+)?)?(?:\s*\/?-)?(?:\s*(?:\/|per\s)?\s*[a-z]{1,4})?)$/i.exec(raw);
  if (!m || !m[1].trim()) return { label: raw, value: '' };
  return { label: m[1].trim(), value: m[2].trim() };
}

/**
 * Break one line so that no piece is wider than `maxPx`.
 *
 * 🔴 THE FIRST VERSION OF THIS MODULE REFUSED TO WRAP, and the reason it gave was right: wrapping
 * needs `measureText`, so a layout that guessed and a canvas that measured would disagree the moment
 * a font was substituted. The fix is not to guess — it is to hand the SAME measuring function to
 * both, which is what `Measure` is. The preview and the export therefore wrap identically because
 * they are asking the same context the same question.
 *
 * A single word longer than the box is broken mid-word rather than allowed to run off the picture: a
 * clipped word is a bug the user can see and fix, and a word that leaves the frame is one they
 * cannot. Explicit newlines are still honoured exactly — this only ever adds breaks.
 */
export function wrapLine(line: string, maxPx: number, font: string, measure: Measure): string[] {
  const text = String(line ?? '');
  if (!text) return [''];
  if (!(maxPx > 0) || measure(text, font) <= maxPx) return [text];

  const out: string[] = [];
  let current = '';
  for (const word of text.split(/(\s+)/)) {
    if (!word) continue;
    const candidate = current + word;
    if (current && measure(candidate.trim(), font) > maxPx) {
      out.push(current.trim());
      current = word.trim() ? word : '';
    } else {
      current = candidate;
    }
    // One word on its own is still too wide — break it by characters so nothing leaves the frame.
    while (measure(current.trim(), font) > maxPx && current.trim().length > 1) {
      let cut = current.trim();
      while (cut.length > 1 && measure(cut, font) > maxPx) cut = cut.slice(0, -1);
      out.push(cut);
      current = current.trim().slice(cut.length);
    }
  }
  if (current.trim()) out.push(current.trim());
  return out.length > 0 ? out : [''];
}

export interface LineBox {
  text: string;
  /** Where `fillText` should be given the line, honouring the layer's alignment. */
  x: number;
  /** The BASELINE y for this line. */
  y: number;
  /** A list row's price. Absent on a caption, and on a list HEADING (a line with no price). */
  value?: string;
  /** The right edge a row's price is set against. */
  valueX?: number;
  /** The span a dotted leader fills between a row's label and its price. */
  leader?: { from: number; to: number };
}

/** The box a layer is laid out inside, in real pixels: centred on xPct, `widthPct` wide. */
export function layerBox(layer: TextLayer, w: number): { left: number; right: number; width: number; centre: number } {
  const l = normalizeLayer(layer);
  const width = l.widthPct * w;
  const centre = l.xPct * w;
  return { left: centre - width / 2, right: centre + width / 2, width, centre };
}

/**
 * The lines a layer will really draw, AFTER wrapping — the count auto-fit and the band both need.
 *
 * Without a `measure` nothing wraps, which is exactly the pre-wrap behaviour and is what keeps the
 * older callers (and their tests) meaning what they meant.
 */
export function renderedLines(layer: TextLayer, w: number, h: number, measure?: Measure, sizeOverride?: number): string[] {
  const l = normalizeLayer(layer);
  const raw = textLines(l);
  if (raw.length === 0) return [];
  if (l.kind === 'list') return raw.slice(0, MAX_LIST_ROWS);
  if (!measure) return raw;
  const size = sizeOverride ?? fontPx(l, w, h);
  const font = fontStringAt(l, size);
  const max = layerBox(l, w).width;
  const out: string[] = [];
  for (const line of raw) out.push(...wrapLine(line, max, font, measure));
  return out;
}

/**
 * The font size actually used, after shrinking to fit the picture.
 *
 * ⚠️ IT SHRINKS ON HEIGHT, NOT WIDTH — width is already handled, because wrapping makes any line fit
 * the box by construction. What wrapping CANNOT prevent is the block growing downward past the
 * bottom of the image, and a rate card is precisely the layer that does that. Bounded by
 * `MIN_FIT_SCALE`: past a point, shrinking to fit stops producing something anybody can read, and an
 * honest clip the user can see and fix beats text too small to be text.
 *
 * Without a `measure` it returns the chosen size unchanged, so nothing auto-fits behind a caller's
 * back — the behaviour only appears where a real context is doing the measuring.
 */
export function fittedFontPx(layer: TextLayer, w: number, h: number, measure?: Measure): number {
  const l = normalizeLayer(layer);
  const chosen = fontPx(l, w, h);
  if (!measure || textLines(l).length === 0) return chosen;
  const limit = h * 0.94;
  let size = chosen;
  // A handful of steps, each 8% smaller. A loop that solved it exactly would re-wrap every
  // iteration for a difference nobody can see.
  for (let i = 0; i < 9; i++) {
    const count = renderedLines(l, w, h, measure, size).length;
    if (count * size * LINE_HEIGHT <= limit) break;
    const next = Math.round(size * 0.92);
    if (next < chosen * MIN_FIT_SCALE || next < 1) break;
    size = next;
  }
  return Math.max(1, size);
}

/**
 * Where every line of a layer lands, in real pixels.
 *
 * The block is centred vertically on `yPct`, so growing a two-line caption to three does not shove it
 * off the bottom of the image — it grows from its middle, which is what "the text is HERE" means to
 * somebody who dragged it there.
 *
 * For a `list`, each line also carries its price and the leader span between the two columns. A row
 * with no price is a HEADING and is returned as a plain line, so a section title is not squeezed into
 * a label column it does not belong in.
 */
export function layoutLayer(layer: TextLayer, w: number, h: number, measure?: Measure): LineBox[] {
  const l = normalizeLayer(layer);
  if (textLines(l).length === 0) return [];
  const size = fittedFontPx(l, w, h, measure);
  const lines = renderedLines(l, w, h, measure, size);
  if (lines.length === 0) return [];
  const font = fontStringAt(l, size);
  const step = size * LINE_HEIGHT;
  const top = l.yPct * h - (step * lines.length) / 2;
  const box = layerBox(l, w);
  const baseline = (i: number) => top + step * i + size * 0.78;

  if (l.kind !== 'list') {
    // x is the same for all three alignments ON PURPOSE: `drawTextLayers` sets `ctx.textAlign` to the
    // layer's own value, so this point is the ANCHOR the context aligns against (left edge, centre, or
    // right edge) rather than always the left edge. `bandRect` reads it the same way.
    //
    // 🔴 AND THE ANCHOR IS THE DRAG POINT, NOT THE BOX EDGE. An earlier draft anchored a left-aligned
    // caption at `box.left`, which moved it 430px away from where the user had just dropped it —
    // dragging would have read as broken for every alignment but centre. The box governs WRAPPING,
    // which is a width question; it must never govern WHERE, which is the user's answer.
    return lines.map((text, i) => ({ text, x: box.centre, y: baseline(i) }));
  }

  const gap = size * 0.5;
  return lines.map((line, i) => {
    const { label, value } = parseListRow(line);
    const y = baseline(i);
    if (!value) return { text: label, x: box.left, y };
    const labelWidth = measure ? measure(label, font) : 0;
    const valueWidth = measure ? measure(value, font) : 0;
    return {
      text: label,
      x: box.left,
      y,
      value,
      valueX: box.right,
      leader: { from: box.left + labelWidth + gap, to: box.right - valueWidth - gap },
    };
  });
}

/**
 * The band behind a layer, in real pixels — or null when the layer has none.
 *
 * ⚠️ A LIST'S BAND SPANS ITS WHOLE BOX, not the widest label. A rate card's right column is set
 * against the box's right edge, so a band sized to the text would stop short of the prices and leave
 * them sitting on the bare photograph — unreadable, and obviously wrong the first time anyone looks.
 *
 * 🔑 IT IS THE BORDER'S RECTANGLE TOO, which is why a layer with a border but NO fill still gets one.
 * A border computed from its own geometry would be a second answer to "where is this text's box?",
 * and the day the two disagreed the outline would sit a few pixels off the bar it is meant to frame.
 * One rect, both jobs — the FILL is what is conditional, never the measurement.
 */
export function bandRect(
  layer: TextLayer,
  w: number,
  h: number,
  measure: Measure,
): { x: number; y: number; w: number; h: number } | null {
  const l = normalizeLayer(layer);
  if (!l.band && !(l.borderPct > 0)) return null;
  const size = fittedFontPx(l, w, h, measure);
  const lines = renderedLines(l, w, h, measure, size);
  if (lines.length === 0) return null;
  const font = fontStringAt(l, size);
  const box = layerBox(l, w);
  const step = size * LINE_HEIGHT;
  const padX = size * 0.45;
  const padY = size * 0.28;
  const boxH = step * lines.length + padY * 2;
  const top = l.yPct * h - boxH / 2;

  if (l.kind === 'list') {
    return { x: box.left - padX, y: top, w: box.width + padX * 2, h: boxH };
  }
  const widest = lines.reduce((m, line) => Math.max(m, measure(line, font)), 0);
  const boxW = widest + padX * 2;
  const anchor = box.centre; // the drag point — see the note in `layoutLayer`
  const left = l.align === 'left' ? anchor - padX : l.align === 'right' ? anchor - boxW + padX : anchor - boxW / 2;
  return { x: left, y: top, w: boxW, h: boxH };
}

/** The small, honest subset of a 2D context this module uses. Keeps the tests free of a real canvas. */
export interface TextContext {
  font: string;
  // The real context's own union, not a narrowed `string`: narrowing it would make a genuine
  // CanvasRenderingContext2D fail to satisfy this interface, and the whole point is that the same
  // function serves the real canvas and the test's recorder.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineJoin: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  measureText(text: string): { width: number };
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Draw every layer onto a context already holding the image.
 *
 * ⚠️ ORDER IS LOAD-BEARING: band, then outline, then fill. Stroking AFTER filling would eat into the
 * letterforms from the outside in, which at a banner's font weight visibly thins the text — the
 * outline exists to make text readable, so an outline that damages legibility is worse than none.
 *
 * ⚠️ AND EVERY LAYER IS save()/restore()'d. Without it a layer with no band inherits the previous
 * layer's `fillStyle`, so deleting one caption silently recolours the next — a bug that only appears
 * with two layers and therefore only in front of a user.
 */
export function drawTextLayers(ctx: TextContext, layers: TextLayer[], w: number, h: number): void {
  const measure: Measure = (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  for (const raw of layers) {
    const layer = normalizeLayer(raw);
    const lines = layoutLayer(layer, w, h, measure);
    if (lines.length === 0) continue;
    ctx.save();
    const size = fittedFontPx(layer, w, h, measure);
    const font = fontStringAt(layer, size);

    const rect = bandRect(layer, w, h, measure);
    ctx.font = font; // measuring may have changed it; restore before anything is drawn
    ctx.textBaseline = 'alphabetic';
    // A list sets its own two edges, so the context must not re-align underneath it.
    ctx.textAlign = layer.kind === 'list' ? 'left' : layer.align;
    if (rect) {
      if (layer.band) {
        ctx.fillStyle = layer.band;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      }
      if (layer.borderPct > 0) {
        // Inset by half the stroke so the border sits INSIDE the rect. A canvas stroke straddles the
        // path, so without this a thick border spills half its weight outside the bar it frames and
        // reads as misaligned against the fill it is drawn on.
        const lw = Math.max(1, size * layer.borderPct);
        ctx.lineWidth = lw;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = layer.borderColor;
        ctx.strokeRect(rect.x + lw / 2, rect.y + lw / 2, Math.max(0, rect.w - lw), Math.max(0, rect.h - lw));
      }
    }

    const paint = (draw: (text: string, x: number, y: number) => void) => {
      for (const line of lines) {
        if (line.text) draw(line.text, line.x, line.y);
        if (line.value && typeof line.valueX === 'number') {
          ctx.textAlign = 'right';
          draw(line.value, line.valueX, line.y);
          ctx.textAlign = 'left';
        }
      }
    };

    if (layer.outline) {
      ctx.lineWidth = Math.max(1, size * 0.14);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outlineFor(layer.color);
      paint((t, x, y) => ctx.strokeText(t, x, y));
    }
    ctx.fillStyle = layer.color;
    paint((t, x, y) => ctx.fillText(t, x, y));
    drawLeaders(ctx, lines, size);
    ctx.restore();
  }
}

/**
 * The dotted run between a rate card's two columns.
 *
 * Drawn as small squares rather than as a row of '\u00b7' characters: a character leader's spacing is
 * a property of whichever font the device substituted, so the same menu would come out differently on
 * two phones. Squares are the same everywhere, which is the point of doing this on our side at all.
 * Skipped when the columns nearly touch — a leader shorter than a couple of dots reads as dirt.
 */
function drawLeaders(ctx: TextContext, lines: LineBox[], size: number): void {
  const dot = Math.max(1, size * 0.07);
  const gap = size * 0.42;
  for (const line of lines) {
    if (!line.leader) continue;
    const { from, to } = line.leader;
    if (!(to - from > gap * 2)) continue;
    const y = line.y - size * 0.22;
    for (let x = from; x <= to - dot; x += gap) ctx.fillRect(x, y, dot, dot);
  }
}

/** Anything that can be drawn as a picture — the real `HTMLImageElement`, or a test's stand-in. */
export interface DrawableImage { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }

/**
 * A context that can also draw a picture. Kept separate so `drawTextLayers` stays text-only.
 *
 * Generic in the image type so a REAL `CanvasRenderingContext2D` satisfies it: that context's
 * `drawImage` takes the wide `CanvasImageSource`, which a narrower `DrawableImage` parameter cannot
 * accept. Widening our own parameter instead would drag the whole DOM image type into the tests.
 */
export interface ComposeContext<I = DrawableImage> extends TextContext {
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: I, x: number, y: number, w: number, h: number): void;
}

/** The picture's real pixel size, preferring its natural dimensions over its displayed ones. */
export function imagePixels(img: DrawableImage): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(Number(img.naturalWidth || img.width || 0)) || 1),
    h: Math.max(1, Math.round(Number(img.naturalHeight || img.height || 0)) || 1),
  };
}

/**
 * The WHOLE picture: clear, draw the image, then draw the text on top.
 *
 * 🔑 THIS IS THE FUNCTION THE PREVIEW AND THE EXPORT BOTH CALL, and it lives here rather than in the
 * component for exactly that reason — a component-local renderer is one somebody can quietly add a
 * second of, and the day the preview and the saved file disagree, nothing fails and the user finds
 * out after they have printed it.
 *
 * ⚠️ THE ORDER IS THE POINT. The image is drawn FIRST and the text after; reverse them and the
 * picture paints over the words, which produces a plain image that looks exactly like a user who
 * typed nothing. The clear comes first so a repaint at a smaller size cannot leave the previous
 * frame's edges showing around the new one.
 */
export function composeImage<I extends DrawableImage>(ctx: ComposeContext<I>, img: I, layers: TextLayer[]): { w: number; h: number } {
  const { w, h } = imagePixels(img);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  drawTextLayers(ctx, layers, w, h);
  return { w, h };
}

/**
 * The outline colour for a given text colour: black behind light text, white behind dark.
 *
 * Uses the standard relative-luminance weights (0.2126 / 0.7152 / 0.0722) rather than a plain
 * average, because green reads far brighter to the eye than blue — an average calls `#0000ff` light
 * and gives it a black outline it disappears into. Anything unparseable gets a black outline, which
 * is the safe direction: the default text colour is white.
 */
export function outlineFor(color: string): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color ?? '').trim());
  if (!hex) return OUTLINE_DARK;
  let body = hex[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  const r = parseInt(body.slice(0, 2), 16);
  const g = parseInt(body.slice(2, 4), 16);
  const b = parseInt(body.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? OUTLINE_DARK : OUTLINE_LIGHT;
}

/**
 * Can this device actually draw Devanagari?
 *
 * The technique is the standard font-detection one: a glyph the system cannot render comes out as the
 * font's "notdef" box, and every notdef box in a given face has the SAME width. So if `क` measures
 * exactly as wide as an unassigned code point, both are boxes and the script is missing.
 *
 * ⚠️ IT IS A HEURISTIC AND IS LABELLED ONE. It can be wrong in a face whose real `क` happens to match
 * the box width. Both failure directions are mild and neither is silent: a false "missing" shows a
 * warning on a device that would have worked, and a false "available" shows □□□ the user can see for
 * themselves. It is NOT wired to block anything — no button is disabled by this answer. Guessing
 * would be worse than either, which is why it measures rather than sniffing the user agent.
 */
export function devanagariRendersHere(ctx: Pick<TextContext, 'font' | 'measureText'>): boolean {
  try {
    ctx.font = `64px ${DEFAULT_FONT_STACK}`;
    const glyph = ctx.measureText('क').width;
    // U+FFFF is permanently unassigned, so it is a notdef box in every font that exists.
    const notdef = ctx.measureText('￿').width;
    if (!Number.isFinite(glyph) || glyph <= 0) return false;
    return Math.abs(glyph - notdef) > 0.5;
  } catch {
    // A context that cannot measure cannot answer, and "cannot answer" is not "broken".
    return true;
  }
}

/**
 * The one-line warning to show beside the editor, or null when there is nothing to say.
 *
 * Says what is wrong and what to do — never just "unsupported". A user whose device lacks the font
 * can still type Hinglish and get a perfect result, so the message offers that instead of stopping.
 */
export function devanagariWarning(layers: TextLayer[], available: boolean): string | null {
  if (available) return null;
  if (!layers.some((l) => hasDevanagari(l.text))) return null;
  return 'This device does not have a Hindi font, so Devanagari may show as empty boxes. Type in English or Hinglish here, or add the text on your phone instead.';
}
