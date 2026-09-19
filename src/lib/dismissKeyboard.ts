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
 * Would focusing something right now raise an ON-SCREEN keyboard?
 *
 * 🔑 THE OTHER HALF OF THIS MODULE (admin 2026-09-19: *"jab tak typing ke liye inputbox me click na
 * kiya jaye, automatic keyboard open na ho"*). Dismissing the keyboard after Send was only ever half
 * the problem; the other half is code that OPENS it without being asked — a `.focus()` in a mount
 * effect, or an `autoFocus` on a panel the user merely navigated to. Tapping TERMINAL in Code Studio
 * raised the keyboard over the transcript the user had gone there to read.
 *
 * The test is the pointer, never the width: a coarse pointer is what has a soft keyboard, and a wide
 * touch tablet has one while a narrow desktop window does not. Same query this module already used
 * to decide whether to blur — stated once, so the two halves can never disagree.
 *
 * ⚠️ This answers a FACT, not a policy. A control the user opened IN ORDER to type (a rename field, a
 * password prompt, "add key") should still focus itself: that tap already said "I want to type". Only
 * focus the user did not ask for needs to consult this.
 */
export function softKeyboardWouldOpen(): boolean {
  if (typeof window === 'undefined') return false;
  // matchMedia may be absent in a test/jsdom environment — treat that as "no soft keyboard".
  return !!window.matchMedia?.('(pointer: coarse)').matches;
}

/**
 * Blur the given composer element (or the focused element) so a mobile keyboard closes after sending.
 * No-op on a desktop / mouse pointer, in a non-browser environment, or if nothing is focusable.
 */
export function dismissKeyboardOnMobile(el?: HTMLElement | null): void {
  if (typeof document === 'undefined') return;
  if (!softKeyboardWouldOpen()) return;
  const target = el ?? (document.activeElement as HTMLElement | null);
  target?.blur?.();
}
