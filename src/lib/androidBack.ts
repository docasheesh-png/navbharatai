// WHAT THE ANDROID HARDWARE BACK BUTTON DOES — the whole decision, in one pure function.
//
// 🔴 THE REPORTED BUG (admin 2026-09-17): *"jab bhi koi user kisi bhi page par apne android mobile se
// back button press karta hai, app band ho jati hai"* — Back closed the app from EVERY screen.
//
// THE ROOT CAUSE, and it is one line meeting one architectural fact. `installBackButtonHandler` read
// Capacitor's `canGoBack` and, when it was false, called `exitApp()` — a correct rule for an app whose
// screens are browser HISTORY entries. NavBharatAI's are not: `toggleTab` ends in `setActiveView`, a
// React state change, and pushes only into its own `tabHistories` object. Nothing ever calls
// `history.pushState`, so the WebView's stack holds exactly ONE entry for the life of the app and
// `canGoBack` is false on the home screen, inside Settings, mid-build — everywhere. Every Back press
// took the exit branch. The handler was not misfiring; it was asking a question this app cannot answer.
//
// 🔑 SO THE STACK IS NOT THE SOURCE OF TRUTH — THE APP'S OWN STATE IS. This module is that decision,
// kept PURE (no React, no Capacitor, no DOM) so the behaviour every Android user judges the app by can
// be tested exhaustively instead of by hand on a phone.
//
// THE ORDER, and each step is what a person pressing Back actually expects:
//   1. The exit dialog is open  → close the DIALOG. Back must never be the button that confirms
//      leaving; a dialog asking "are you sure?" is dismissed by Back on every Android app ever made.
//   2. Something is open on top → close the topmost one. Jumping to Home from an open sheet would
//      throw away what the user was doing and read as a crash.
//   3. Not on Home            → go Home. (The admin's rule: "kisi bhi page se home aa jaye".)
//   4. On Home                → ask before leaving. ("ek popup aye, jisme pucha jaye aap exit karna
//      chahte hai?")
//
// ⚠️ IT IS TOTAL ON PURPOSE. Every input produces an action, because the one outcome worse than
// exiting too eagerly is a Back button that does NOTHING — that traps the user with no way out and no
// way to tell a frozen app from a deliberate one. There is no branch here that returns nothing.

/** What the app should do about one Back press. */
export type BackAction =
  /** The exit dialog is showing — close it and stay in the app. */
  | { type: 'dismiss-exit-prompt' }
  /** Close this overlay (the topmost open one) and stay where we are. */
  | { type: 'close-overlay'; id: string }
  /** Leave this screen for the home screen. */
  | { type: 'go-home' }
  /** Already home — ask whether to leave the app. */
  | { type: 'confirm-exit' };

export interface BackState {
  /** True while the "Exit NavBharatAI?" dialog is on screen. */
  exitPromptOpen: boolean;
  /**
   * Ids of everything open over the page, OUTERMOST FIRST — so the LAST entry is the topmost and is
   * what Back closes. A caller builds this from its own state in the order the layers stack.
   *
   * ⚠️ An id is only a label for the caller to switch on; this module never interprets it. That is
   * what keeps the decision pure while the list of overlays stays free to grow.
   */
  openOverlays: readonly string[];
  /** True when the user is already on the home screen. */
  isHome: boolean;
}

/**
 * Decide what one Back press means. PURE — same input, same answer, always.
 *
 * Defensive about its own input rather than trusting it: a caller assembling `openOverlays` from a
 * dozen booleans can easily produce a hole in the array, and a `close-overlay` carrying an empty id
 * would be an instruction the caller cannot act on — which is how a Back button silently starts doing
 * nothing. Unusable entries are skipped, never obeyed.
 */
export function decideBackAction(state: BackState): BackAction {
  if (state?.exitPromptOpen) return { type: 'dismiss-exit-prompt' };

  const overlays = Array.isArray(state?.openOverlays) ? state.openOverlays : [];
  for (let i = overlays.length - 1; i >= 0; i--) {
    const id = typeof overlays[i] === 'string' ? overlays[i].trim() : '';
    if (id) return { type: 'close-overlay', id };
  }

  return state?.isHome ? { type: 'confirm-exit' } : { type: 'go-home' };
}

/**
 * The event the native shell fires when Android's Back button is pressed.
 *
 * It is a DOM event rather than a callback threaded down from `main.tsx` because the decision above
 * needs the app's live state (which screen, what is open) and `main.tsx` has none of it — the same
 * reason `navbharat:navigate` already exists in this codebase. Reusing that established pattern keeps
 * one way of talking to the root component instead of two.
 */
export const HARDWARE_BACK_EVENT = 'navbharat:hardware-back';
