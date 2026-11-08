/**
 * THE EDITOR'S "HIDE KEYBOARD" CONTROL — one rule, stated once (admin 2026-11-05).
 *
 * 🔴 WHAT WAS THERE BEFORE, AND WHY IT WENT. Monaco ships its own iOS-only overlay widget,
 * `.iPadShowKeyboard`: a 58×36 box in the editor's bottom-right corner whose single job is to
 * OPEN the keyboard (it calls `editor.focus()`). The admin's report, verbatim:
 *
 *     "keyboard open to kahi bhi touch karo, keyboard open ho jata hai. band nahi hota,
 *      is button se keyboard band ho jaye, bas itna karo!!"
 *
 * That is exactly right, and it is a design fault in the widget rather than in our wiring: on a
 * touch device ANY tap in the code area already focuses the editor and raises the keyboard, so a
 * large permanent button that only repeats what a tap does is screen taken away from the code —
 * while the action the user genuinely cannot reach (closing the keyboard again, with no iOS
 * accessory bar because `installKeyboardBehaviour` removes it) had no control at all. So the
 * widget is hidden in `index.css` and this module replaces it with its inverse.
 *
 * THE SIGNAL IS FOCUS, NOT THE VIEWPORT, and that is a deliberate correction of the obvious
 * implementation. `useKeyboardHeight()` measures `window.innerHeight - visualViewport.height`,
 * which is correct on the web and structurally BLIND inside our own app: `capacitor.config.ts`
 * sets `Keyboard.resize: 'native'`, so the WebView itself shrinks with the keyboard and that
 * difference stays 0. A button that never appears in the shipped Android/iOS app would have met
 * the letter of the request and none of it. A coarse pointer plus focus inside the editor is true
 * in both environments, and it is also the precise condition under which the button has work to
 * do — the blur it performs is the exact inverse of the focus it keys on.
 */

/** Everything the decision depends on. No DOM, no viewport, no screen width. */
export interface KeyboardDismissInputs {
  /** A touchscreen — the only kind of device that has a soft keyboard to close. */
  coarsePointer: boolean;
  /** Focus is inside the editor surface (Monaco's hidden textarea, or the lite `<textarea>`). */
  editorFocused: boolean;
}

/**
 * Should the hide-keyboard button be on screen right now?
 *
 * Both conditions, always: a desktop has no keyboard to dismiss, and an unfocused editor has no
 * keyboard open. A button shown in either case is the fake-control the second absolute rule bans.
 */
export function shouldShowKeyboardDismiss({ coarsePointer, editorFocused }: KeyboardDismissInputs): boolean {
  return coarsePointer && editorFocused;
}

/**
 * Is focus still inside the editor after a `focusout`?
 *
 * `focusout` fires on every move WITHIN the subtree too (Monaco swaps focus between its hidden
 * textarea and its find widget while the keyboard stays up), so treating every one of them as
 * "blurred" makes the button flicker out and back on an ordinary Find. The element focus is moving
 * TO decides it: still inside ⇒ still focused.
 */
export function stillFocusedAfterFocusOut(container: Node | null, next: Node | null): boolean {
  if (!container || !next) return false;
  return container.contains(next);
}
