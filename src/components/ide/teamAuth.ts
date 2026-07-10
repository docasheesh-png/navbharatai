// Shared auth-header helper for the RBAC-gated team + notification routes. Kept in its own module so
// both TeamCollaboration and MentionInbox use the ONE auth path (no drift, no circular import).

/**
 * Build an Authorization header carrying the signed-in user's Firebase ID token. Best-effort: returns
 * `{}` when unauthenticated or Firebase isn't ready, so the caller can surface an honest "sign in"
 * message rather than silently failing.
 */
export async function teamAuthHeader(): Promise<Record<string, string>> {
  try {
    const { getAuth } = await import('firebase/auth');
    const { getApp } = await import('firebase/app');
    const user = getAuth(getApp()).currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}
