// Shared chat-composer auto-grow (admin 2026-07-20: "sab AI input boxes 1x height + typing par
// badhe"). ROOT CAUSE this centralizes: every chat surface hand-rolled its own composer sizing,
// and two of them (Professionals, Offline AI) shipped rows={1} with a max-height but NO grow
// logic — the box stayed one line forever and long prompts scrolled inside it. One shared helper
// means a new composer can't silently repeat the miss.
//
// Contract: the textarea starts at its natural 1-line height (rows={1}); on every input change
// call autoGrow(el, maxPx) to fit the content up to maxPx; when the value is cleared (send),
// call resetGrow(el) so the box returns to exactly 1 line.

/** The height a growing composer should take for a given content scrollHeight. Pure. */
export function growHeightPx(scrollHeight: number, maxPx: number): number {
  const h = Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : 0;
  const max = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 0;
  return Math.min(h, max);
}

/** Apply the compact phone sizing only to shared chat editors, never unrelated textareas. */
export function resizeMobileComposer(el: HTMLTextAreaElement): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    || !window.matchMedia('(max-width: 639px)').matches
    || !el.classList?.contains('nb-composer-text')) return false;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const maxHeight = Math.max(44, Math.min(160, viewportHeight * 0.3));
  // Collapse before measuring so deleting or replacing a long draft can shrink it too.
  // Empty placeholders may wrap, but must not enlarge the initial editor.
  el.style.height = '0px';
  const contentHeight = el.value ? el.scrollHeight : 44;
  const height = Math.max(44, Math.min(contentHeight, maxHeight));
  el.style.height = `${height}px`;
  return true;
}

/** Fit the textarea to its content, bounded at maxPx (beyond that it scrolls internally). */
export function autoGrow(el: HTMLTextAreaElement, maxPx: number): void {
  if (resizeMobileComposer(el)) return;
  el.style.height = 'auto';
  const h = growHeightPx(el.scrollHeight, maxPx);
  el.style.height = h > 0 ? `${h}px` : '';
}

/** Return the textarea to its natural 1-line height (used when the value is cleared on send). */
export function resetGrow(el: HTMLTextAreaElement): void {
  if (resizeMobileComposer(el)) return;
  el.style.height = '';
}
