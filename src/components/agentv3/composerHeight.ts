// Auto-grow height math for the Pro chat composer, extracted pure so the behavior is unit-testable and
// locked against regression — this height has been re-tuned many times (82→44→2 lines→6 lines) and each
// change risked breaking either "rest at one line" or "grow while typing".
//
// Contract (admin 2026-07-21): the composer RESTS at exactly one line and GROWS with the content up to
// ~6 lines, then scrolls internally. All measurements come from the element's REAL computed line-height +
// vertical padding, so it stays a true single line on mobile too (where CSS forces font-size:16px).

/** Lines the composer may grow to before it scrolls internally (very long prompts use the Expand button). */
export const COMPOSER_MAX_LINES = 6;

/**
 * The pixel height the composer textarea should be set to. `scrollHeight` is the textarea's content
 * height; `lineH` its computed line-height; `padY` its total vertical padding. Rests at one line, grows
 * with content, and is capped at COMPOSER_MAX_LINES (then the textarea scrolls). PURE.
 */
export function clampComposerHeight(scrollHeight: number, lineH: number, padY: number): number {
  const line = lineH > 0 ? lineH : 20; // defensive: a 0/NaN computed line-height falls back to 20px
  const pad = padY > 0 ? padY : 0;
  const minHeight = Math.ceil(line + pad);                       // 1 line — the resting height (1x)
  const maxHeight = Math.ceil(line * COMPOSER_MAX_LINES + pad);  // grow up to ~6 lines, then scroll
  const content = Number.isFinite(scrollHeight) ? scrollHeight : minHeight;
  return Math.min(Math.max(content, minHeight), maxHeight);
}
