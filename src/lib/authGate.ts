// Auth gating for protected views — the "har baar login karna pad raha hai" root-cause fix
// (admin 2026-07-20).
//
// THE BUG CLASS: Firebase restores a saved session ASYNCHRONOUSLY on every app open (localStorage read →
// onAuthStateChanged), which takes ~0.3–2s (longer on phones). The protected-view gates checked only
// `!user` — so during that restore window a returning, genuinely-logged-in user who opened the app (or
// tapped Pro Chat / History) was shown the LOGIN screen. Most users then just logged in again — hence
// "every open asks me to log in", exactly what Google/Instagram never do.
//
// THE RULE (how the big apps do it): while the saved session is still RESTORING, never show login —
// open the view optimistically. Only when the restore has SETTLED logged-out does the login prompt
// appear. A genuinely signed-out user still cannot use a protected view (the modal gates it the moment
// the restore settles — see the settle effect in App.tsx); a signed-in user never sees a login flash.
// Pure + unit-testable.

/** Views that need a signed-in user. */
export const AUTH_GATED_VIEWS = ['security', 'history', 'nbi_pro_chat', 'sda_chat', 'engineer_ai'] as const;

export function isAuthGatedView(view: string): boolean {
  return (AUTH_GATED_VIEWS as readonly string[]).includes(view);
}

/**
 * Decide what opening `view` should do:
 *  • 'open'  — not a gated view, OR the user is signed in, OR the session restore is still running
 *              (optimistic open: never flash login at a returning user).
 *  • 'login' — gated view, restore has settled, and there is genuinely no user → prompt sign-in.
 */
export function authGateDecision(view: string, hasUser: boolean, authRestoring: boolean): 'open' | 'login' {
  if (!isAuthGatedView(view)) return 'open';
  if (hasUser) return 'open';
  if (authRestoring) return 'open';
  return 'login';
}
