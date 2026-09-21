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

/** Where a layer's box sits, as a fraction of the image. Percentages, so one layer fits every size. */
export interface TextLayer {
  id: string;
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
  /** A solid band behind the text — what a real banner does. Empty string = none. */
  band: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
}

/**
 * The font stack, ordered by what actually ships on the platforms NavBharatAI runs on.
 *
 * ⚠️ NAMED FAMILIES FIRST, AND THAT IS NOT DECORATION. A bare `sans-serif` DOES resolve Devanagari on
 * every OS below — but it picks the system's default UI face, which on Android is Roboto and falls
 * back per-glyph to Noto with a different vertical rhythm, so a line of mixed Hinglish and Hindi
 * ("Sharma जी") comes out on two visual baselines. Naming the Devanagari face first makes both halves
 * come from one family wherever that family exists.
 *
 * Android ships Noto Sans Devanagari (since 4.x), iOS/macOS Kohinoor and Devanagari Sangam MN,
 * Windows Nirmala UI. Desktop Linux is the one platform where none is guaranteed, which is exactly
 * what `devanagariRendersHere` is for.
 */
export const FONT_STACK =
  '"Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", "Devanagari Sangam MN", "Mangal", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

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

export const MAX_LAYERS = 6;
export const MAX_TEXT_CHARS = 120;
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
export function defaultLayer(id: string, text = ''): TextLayer {
  return {
    id,
    text,
    xPct: 0.5,
    yPct: 0.82,
    sizePct: 0.06,
    color: DEFAULT_TEXT_COLOR,
    outline: true,
    band: DEFAULT_BAND,
    align: 'center',
    bold: true,
  };
}

/** Force any stored/edited layer back inside its bounds. Applied on every draw, never only on input. */
export function normalizeLayer(layer: TextLayer): TextLayer {
  const align = layer.align === 'left' || layer.align === 'right' ? layer.align : 'center';
  return {
    ...layer,
    text: String(layer.text ?? '').slice(0, MAX_TEXT_CHARS),
    xPct: clamp(layer.xPct, 0, 1, 0.5),
    yPct: clamp(layer.yPct, 0, 1, 0.5),
    sizePct: clamp(layer.sizePct, MIN_SIZE_PCT, MAX_SIZE_PCT, 0.06),
    align,
    outline: !!layer.outline,
    bold: !!layer.bold,
    color: typeof layer.color === 'string' && layer.color ? layer.color : DEFAULT_TEXT_COLOR,
    band: typeof layer.band === 'string' ? layer.band : '',
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
  return `${layer.bold ? '700 ' : '400 '}${fontPx(layer, w, h)}px ${FONT_STACK}`;
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

export interface LineBox {
  text: string;
  /** Where `fillText` should be given the line, honouring the layer's alignment. */
  x: number;
  /** The BASELINE y for this line. */
  y: number;
}

/** Gap between baselines, as a multiple of the font size. */
const LINE_HEIGHT = 1.25;

/**
 * Where every line of a layer lands, in real pixels.
 *
 * The block is centred vertically on `yPct`, so growing a two-line caption to three does not shove it
 * off the bottom of the image — it grows from its middle, which is what "the text is HERE" means to
 * somebody who dragged it there.
 */
export function layoutLayer(layer: TextLayer, w: number, h: number): LineBox[] {
  const l = normalizeLayer(layer);
  const lines = textLines(l);
  if (lines.length === 0) return [];
  const size = fontPx(l, w, h);
  const step = size * LINE_HEIGHT;
  const blockHeight = step * lines.length;
  const cx = l.xPct * w;
  // `textBaseline` is 'alphabetic', so the first baseline sits one ascent below the block's top.
  // 0.78 of the size is a good approximation of ascent for the faces in FONT_STACK.
  const top = l.yPct * h - blockHeight / 2;
  // x is the same for all three alignments ON PURPOSE: `drawTextLayers` sets `ctx.textAlign` to the
  // layer's own value, so this point is the ANCHOR the context aligns against (left edge, centre, or
  // right edge) rather than always the left edge. `bandRect` reads it the same way.
  return lines.map((text, i) => ({ text, x: cx, y: top + step * i + size * 0.78 }));
}

/** The band behind a layer, in real pixels — or null when the layer has none. */
export function bandRect(
  layer: TextLayer,
  w: number,
  h: number,
  measure: (text: string, font: string) => number,
): { x: number; y: number; w: number; h: number } | null {
  const l = normalizeLayer(layer);
  if (!l.band) return null;
  const lines = textLines(l);
  if (lines.length === 0) return null;
  const size = fontPx(l, w, h);
  const font = fontString(l, w, h);
  const widest = lines.reduce((m, line) => Math.max(m, measure(line, font)), 0);
  const step = size * LINE_HEIGHT;
  const padX = size * 0.45;
  const padY = size * 0.28;
  const boxW = widest + padX * 2;
  const boxH = step * lines.length + padY * 2;
  const cx = l.xPct * w;
  const left = l.align === 'left' ? cx - padX : l.align === 'right' ? cx - boxW + padX : cx - boxW / 2;
  return { x: left, y: l.yPct * h - boxH / 2, w: boxW, h: boxH };
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
  for (const raw of layers) {
    const layer = normalizeLayer(raw);
    const lines = layoutLayer(layer, w, h);
    if (lines.length === 0) continue;
    ctx.save();
    const font = fontString(layer, w, h);
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = layer.align;

    const rect = bandRect(layer, w, h, (text, f) => {
      ctx.font = f;
      return ctx.measureText(text).width;
    });
    ctx.font = font; // measuring may have changed it; restore before anything is drawn
    if (rect) {
      ctx.fillStyle = layer.band;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    const size = fontPx(layer, w, h);
    if (layer.outline) {
      ctx.lineWidth = Math.max(1, size * 0.14);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outlineFor(layer.color);
      for (const line of lines) if (line.text) ctx.strokeText(line.text, line.x, line.y);
    }
    ctx.fillStyle = layer.color;
    for (const line of lines) if (line.text) ctx.fillText(line.text, line.x, line.y);
    ctx.restore();
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
    ctx.font = `64px ${FONT_STACK}`;
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
