// The STORAGE side of the per-user GitHub connection.
//
// `githubConnection.ts` holds the PURE resolver that decides whether a stored token may be used by
// the currently signed-in user. This module holds the two writes that decision implies. They are
// deliberately separate files: the resolver's value is that it is pure and fully unit-testable, and
// folding `localStorage` writes into it would cost that.
//
// WHY THEY MOVED HERE (2026-08-24): both used to be defined in `App.tsx`, so `useChatEngine` and
// `useGitHubConnect` imported them from the app ROOT — dragging App.tsx's whole static graph into
// any chunk that touched them. See tests/appModuleGraph.test.ts.

/**
 * Records WHICH NavBharatAI user authorized the stored GitHub token. Without it the token outlives
 * the session that created it, and a second user on the same browser would inherit someone else's
 * GitHub account — the "every user sees my repos" bug `githubConnection.ts` documents in full.
 */
const GH_OWNER_KEY = 'gh_owner_uid';

/** Stamp the current owner. Called whenever a token is stored. */
export function rememberGithubOwner(uid: string | null | undefined): void {
  try { localStorage.setItem(GH_OWNER_KEY, uid || ''); } catch { /* storage unavailable */ }
}

/** Drop the whole connection — token, its change signal, and the owner stamp. */
export function clearGithubConnection(): void {
  try {
    localStorage.removeItem('gh_token');
    localStorage.removeItem('gh_token_signal');
    localStorage.removeItem(GH_OWNER_KEY);
  } catch { /* storage unavailable */ }
}

/**
 * Who owns the stored token, or null when nothing is stamped.
 *
 * A READER rather than an exported key string, deliberately: `GH_OWNER_KEY` stays private to this
 * module, so there is exactly ONE place that knows the storage key and no call site can drift onto a
 * near-miss spelling. App.tsx used to read `localStorage.getItem(GH_OWNER_KEY)` inline, which is why
 * the key had to be module-visible there at all.
 */
export function readGithubOwner(): string | null {
  try { return localStorage.getItem(GH_OWNER_KEY); } catch { return null; }
}
