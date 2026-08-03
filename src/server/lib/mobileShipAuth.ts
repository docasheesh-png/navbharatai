// Where the user's GitHub token lives on a ship-to-stores request — declared ONCE, for every route in
// the feature.
//
// ROOT CAUSE THIS CLOSES (admin 2026-08-03, "Build my APK now se build nahi chali"): the feature is
// split across two route files that disagreed about the contract.
//   • routes/mobileSetup.ts read the GitHub token from  X-GitHub-Token  (correct — the client sends the
//     FIREBASE token in Authorization, because every authenticated call in the app does).
//   • routes/mobileShip.ts  read it from  Authorization  and stripped the "Bearer " prefix, so it took
//     the user's Firebase ID token and presented it to GitHub as a GitHub token.
// GitHub answered 401 to every dispatch, every status poll and every download, and the panel showed
// "GitHub refused the request — reconnect GitHub", which sent the user to reconnect an account that was
// already connected fine. Setup worked, so the repository really appeared — which made the failure look
// like a GitHub problem rather than ours.
//
// A second copy of "which header?" is how that happened, so there is now exactly one answer here, and a
// test asserts both route files use it. The Authorization fallback is deliberate and NOT dead code: any
// older client still sending the token that way keeps working instead of silently breaking.

import type { Request } from 'express';

/** The header the client sends the GitHub OAuth token in, kept distinct from the Firebase one. */
export const GITHUB_TOKEN_HEADER = 'x-github-token';

/**
 * The user's GitHub token, or null.
 *
 * A Firebase ID token is a JWT — three base64 segments separated by dots — and a GitHub token never is.
 * So a JWT arriving in Authorization is rejected rather than forwarded to GitHub, which turns the old
 * silent 401 into an honest "connect GitHub" the user can actually act on.
 */
export function githubTokenFromRequest(req: Request): string | null {
  const dedicated = req.headers[GITHUB_TOKEN_HEADER];
  const fromHeader = Array.isArray(dedicated) ? dedicated[0] : dedicated;
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader.trim();

  const raw = req.headers.authorization;
  if (!raw) return null;
  const token = raw.replace(/^(bearer|token)\s+/i, '').trim();
  if (!token || looksLikeFirebaseIdToken(token)) return null;
  return token;
}

/** A Firebase ID token is a signed JWT: header.payload.signature, all base64url. */
export function looksLikeFirebaseIdToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(token);
}
