// The GitHub OAuth connection is PER NavBharatAI USER, not per browser.
//
// The token lives in localStorage under a single key ('gh_token'), which is global to the browser
// profile. Without an owner binding it outlives the NavBharatAI session that created it: a second
// user signing in on the same browser (or the same person's account being replaced) would inherit
// the previous user's GitHub connection — the repo picker would list SOMEONE ELSE'S repos and a
// build could push to SOMEONE ELSE'S account. That is the "every user sees my account, not theirs"
// bug the admin reported.
//
// The fix binds the token to the uid that authorized it (stored alongside as 'gh_owner_uid'), and
// this pure resolver decides, on every auth-state change, whether the stored token may be used by
// the now-current user. Pure + fully unit-testable; the React layer only applies the decision.

export interface GithubConnectionResolution {
  /** The token the current user may use (null → no usable connection for them). */
  token: string | null;
  /** The owner uid to persist (null → clear the stored owner). */
  ownerUid: string | null;
  /** True when the caller must WRITE the change back (clear storage / reset state / restamp owner). */
  changed: boolean;
  /** Why — for an honest log line. */
  reason: 'none' | 'kept' | 'claimed' | 'cleared-different-user';
}

/**
 * Decide what happens to a stored GitHub token when NavBharatAI user `currentUid` is active.
 *
 *  - No token → nothing to do.
 *  - Token owned by THIS user → keep it.
 *  - Token with no recorded owner (legacy, or just picked up this session) → the current user
 *    CLAIMS it. This is safe: connecting GitHub requires an active NavBharatAI session, and that
 *    session persists across reloads, so an unowned token was necessarily authorized by whoever is
 *    signed in now. (Freshly picked-up tokens are stamped at the source too, so in practice the
 *    only unowned tokens are pre-existing ones belonging to the current user.)
 *  - Token owned by a DIFFERENT user → CLEAR it; this user must connect their own GitHub.
 *
 * PURE.
 */
export function resolveGithubConnectionForUser(
  currentUid: string,
  storedToken: string | null | undefined,
  storedOwner: string | null | undefined,
): GithubConnectionResolution {
  if (!storedToken) {
    return { token: null, ownerUid: storedOwner ?? null, changed: false, reason: 'none' };
  }
  const owner = (storedOwner || '').trim();
  if (owner && owner !== currentUid) {
    return { token: null, ownerUid: null, changed: true, reason: 'cleared-different-user' };
  }
  if (!owner) {
    return { token: storedToken, ownerUid: currentUid, changed: true, reason: 'claimed' };
  }
  return { token: storedToken, ownerUid: currentUid, changed: false, reason: 'kept' };
}
