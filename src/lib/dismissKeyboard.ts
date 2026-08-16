// Close the on-screen keyboard after a message is sent — touch devices only.
//
// WHY (admin 2026-08-16): on a phone, every AI chat left the keyboard open after Send with no way to
// close it — it covered half the screen while the user was trying to read the reply. Blurring the
// composer dismisses the keyboard. This is shared by every chat composer (General Assistant, Doctor AI,
// Professionals) so the behaviour is identical and defined in ONE place — no per-screen drift.
//
// Guarded to a COARSE pointer (a touchscreen) so a DESKTOP keeps focus and the next message flows without
// having to click back into the box. Pure DOM, no React — safe to call from any event handler.

/**
 * Blur the given composer element (or the focused element) so a mobile keyboard closes after sending.
 * No-op on a desktop / mouse pointer, in a non-browser environment, or if nothing is focusable.
 */
export function dismissKeyboardOnMobile(el?: HTMLElement | null): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // matchMedia may be absent in a test/jsdom environment — treat that as "not mobile" and do nothing.
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
  const target = el ?? (document.activeElement as HTMLElement | null);
  target?.blur?.();
}
