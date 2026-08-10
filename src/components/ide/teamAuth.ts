// Shared auth-header helper for the RBAC-gated team + notification routes. Kept in its own module so
// both TeamCollaboration and MentionInbox use the ONE auth path (no drift, no circular import).

/**
 * Build an Authorization header carrying the signed-in user's Firebase ID token. Best-effort: returns
 * `{}` when unauthenticated or Firebase isn't ready, so the caller can surface an honest "sign in"
 * message rather than silently failing.
 */
/**
 * Kept as a named re-export (TeamCollaboration and MentionInbox import it) but the implementation now
 * lives in `lib/authHeaders` — audit finding #3b: eight copies of "attach the ID token" is how an auth
 * path drifts.
 */
export { authHeader as teamAuthHeader } from '../../lib/authHeaders';
