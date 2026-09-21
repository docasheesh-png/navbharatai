// A size the user chose themselves (admin-asked 2026-09-21: "sath ek extra custom size bhi add karna").
//
// 🔑 WHY THIS IS A SHARED MODULE AND NOT TWO COPIES. The picker's +/− buttons and the server's
// generator must agree on what a custom size IS — the rounding, the bounds, and what happens to a
// request that is too big. Two implementations of that is a picker that offers 1600×1600 and a
// server that quietly makes something else, which is the class of lie `IMAGE_SIZE_PIXELS` already
// carries a warning about ("the picker advertised 512×512 while the server generated 1024 … every
// number a user read there was wrong"). One function, both sides.
//
// 🔒 PURE. No DOM, no env, no I/O — which is what lets the client import it from `src/lib` and the
// server import it from `src/server/lib`, the same way `hostingTiers` and `envFlag` are shared.

/** The id that means "not one of the presets". Stored on the request like any other size. */
export const CUSTOM_SIZE_ID = 'custom';

/**
 * Sides are rounded to a multiple of 64.
 *
 * Not tidiness: diffusion models are trained on tiles and produce visibly worse edges at sizes that
 * are not a multiple of 8, with 64 the safe common denominator across the models this app routes to.
 * It also makes the +/− buttons mean something — a step of 1px would be a button the user has to
 * press a hundred times to see a difference.
 */
export const CUSTOM_STEP = 64;

/** The smallest useful side. Below this the picture is a thumbnail whatever it was asked to be. */
export const MIN_CUSTOM_PX = 256;
/** The largest side. Past this the provider slows sharply and some refuse outright. */
export const MAX_CUSTOM_PX = 1536;
/**
 * The most pixels one image may be, whatever shape it is.
 *
 * A side cap alone is not enough: 1536×1536 passes every per-side check and is 2.4 MP — more than
 * twice the 1.05 MP square, slow on every provider and the commonest way an image request times
 * out. When a shape exceeds this the sides are scaled down TOGETHER, so the user gets the aspect
 * ratio they asked for at a size that actually arrives.
 */
export const MAX_CUSTOM_PIXELS = 1_600_000;

/** What the custom fields start at — the same square the presets default to, so nothing jumps. */
export const DEFAULT_CUSTOM_SIZE = { w: 1024, h: 1024 };

/**
 * Round to the nearest step and clamp to the per-side bounds. Anything unreadable → the default.
 *
 * ⚠️ `Number(null)` and `Number('')` are both **0**, not NaN — so a side that was never filled in
 * would read as a deliberate zero, clamp to the 256px minimum, and hand back a thumbnail for a
 * request that simply omitted it. That is the same trap this repo has already paid for on a Cloud
 * Run tunable (a cleared field reading as "nobody may earn anything, for ever"). A real number, or
 * a string that spells one, is the only thing that counts as a value; everything else is a miss.
 */
export function clampCustomSide(value: unknown, fallback = DEFAULT_CUSTOM_SIZE.w): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  const stepped = Math.round(n / CUSTOM_STEP) * CUSTOM_STEP;
  return Math.min(MAX_CUSTOM_PX, Math.max(MIN_CUSTOM_PX, stepped));
}

/**
 * Round DOWN to the step, then clamp — the shrinking half of the rule above.
 *
 * 🔑 DOWN, not to the nearest, and that single word is what makes the area cap honest. Rounding to
 * the NEAREST can push a scaled side back UP (1265 → 1280), so a pair that had just been scaled to
 * fit lands back over the cap — and the only way out of that is to step ONE side down, which hands
 * the user a different shape from the one they typed. Flooring can only ever reduce, so a scaled
 * pair is under the cap by construction and both sides keep their proportion.
 */
function floorToStep(value: number): number {
  const stepped = Math.floor(value / CUSTOM_STEP) * CUSTOM_STEP;
  return Math.min(MAX_CUSTOM_PX, Math.max(MIN_CUSTOM_PX, stepped));
}

/**
 * The real pixel size a custom request becomes.
 *
 * ⚠️ THE AREA CAP SCALES BOTH SIDES, it never crops one. Clamping only the larger side would hand
 * back a different SHAPE from the one asked for — somebody who typed a 3:1 banner would get a
 * square — and the shape is the whole reason to choose a custom size in the first place.
 *
 * Both sides are multiplied by the SAME factor and then floored to the step, so the result is under
 * the cap without any second pass: `floor(w·s)·floor(h·s) ≤ w·h·s² = the cap`. (The MIN clamp inside
 * `floorToStep` cannot re-break that here — a side would have to scale below 256px, which needs the
 * other side to exceed 6,250px, and no side may be above 1,536.)
 *
 * PURE.
 */
export function resolveCustomSize(width: unknown, height: unknown): { w: number; h: number } {
  const w = clampCustomSide(width, DEFAULT_CUSTOM_SIZE.w);
  const h = clampCustomSide(height, DEFAULT_CUSTOM_SIZE.h);
  if (w * h <= MAX_CUSTOM_PIXELS) return { w, h };
  const scale = Math.sqrt(MAX_CUSTOM_PIXELS / (w * h));
  return { w: floorToStep(w * scale), h: floorToStep(h * scale) };
}

/** One step bigger or smaller, already clamped — what a +/− button hands back. */
export function stepCustomSide(value: number, direction: 1 | -1): number {
  return clampCustomSide(value + direction * CUSTOM_STEP, value);
}

/** "1024 × 1024" — the one place that string is built, so the picker and the note cannot differ. */
export function describeSize(w: number, h: number): string {
  return `${Math.round(w)} × ${Math.round(h)}`;
}

/**
 * The PRESET sizes, in pixels — the one table, read by the server generator and by both pickers.
 *
 * 🔑 IT MOVED HERE so a second screen could ask "what shape is this?" without typing the numbers a
 * third time. The free picker still spells its own rows out, and `imageRealism.test.ts` reads them
 * out of that file and compares them with this table — so the guard that caught "the picker
 * advertised 512×512 while the server generated 1024" still bites, against a single source.
 *
 * Every entry is at or just under ~1 MP on an exact aspect ratio with both sides a multiple of 16 —
 * the native band of the diffusion family this app routes to. `imageRealism.test.ts` pins all three
 * properties; the reasoning behind them lives with `IMAGE_SIZE_PIXELS` in the server module that
 * re-exports this.
 */
export const PRESET_PIXELS: Record<string, { w: number; h: number }> = {
  square: { w: 1024, h: 1024 },   // 1.05 MP — native
  wide: { w: 1280, h: 720 },      // exactly 16:9, 0.92 MP
  portrait: { w: 864, h: 1152 },  // exactly 3:4, 1.00 MP
  icon: { w: 1024, h: 1024 },     // native, and exactly what Play/App Store require
};

/**
 * The pixels ANY size id becomes — a preset, or the user's own pair. The CLIENT half of the server's
 * `imagePixelsFor`, which delegates to this, so a picker and a generator cannot disagree.
 *
 * PURE.
 */
export function pixelsForSize(size: string | undefined, width?: unknown, height?: unknown): { w: number; h: number } {
  if (String(size || '') === CUSTOM_SIZE_ID) return resolveCustomSize(width, height);
  return PRESET_PIXELS[size || ''] || PRESET_PIXELS.square;
}
