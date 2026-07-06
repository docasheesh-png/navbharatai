// Social sign-in (Google/GitHub) — the ONE decision for what a popup failure means.
//
// ROOT CAUSE it fixes (admin, 2026-07-06 — "Google login is not smooth"): the popup catch treated
// `auth/popup-closed-by-user` (the USER cancelled) and `auth/cancelled-popup-request` (a double-tap
// superseded the first popup) the same as `auth/popup-blocked` — and responded with
// `signInWithRedirect`, a FULL-PAGE navigation to Google. So closing the popup ("cancel") forced the
// user straight back into the Google login anyway, and a double-tap set off a popup + a page
// navigation at once. Cancel must mean CANCEL; only a genuinely BLOCKED popup warrants the redirect
// fallback. Pure + exported for unit testing.

export type PopupFailureAction =
  /** The browser refused to open the popup — fall back to the full-page redirect flow. */
  | 'redirect'
  /** The user cancelled (closed the popup) or a second tap superseded it — stop quietly, no error. */
  | 'cancel'
  /** A genuine failure — surface it honestly. */
  | 'error';

export function popupFailureAction(code: string | null | undefined): PopupFailureAction {
  if (code === 'auth/popup-blocked') return 'redirect';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'cancel';
  return 'error';
}
