// THE LOCK ON "the wrong token went to GitHub".
//
// Root cause, admin 2026-08-03: routes/mobileSetup.ts read the GitHub token from X-GitHub-Token while
// routes/mobileShip.ts read it from Authorization — which carries the FIREBASE ID token, because every
// authenticated call in the app puts it there. So the ship routes handed a Firebase JWT to GitHub as if
// it were a GitHub token. GitHub answered 401, and the panel told the user to reconnect a GitHub account
// that was connected perfectly well. Setup worked (right header) while every build call failed (wrong
// header), which made it look like a GitHub outage rather than our own bug.

import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GITHUB_TOKEN_HEADER, githubTokenFromRequest, looksLikeFirebaseIdToken } from './mobileShipAuth';

const req = (headers: Record<string, string | string[]>): Request => ({ headers } as unknown as Request);

// A structurally real Firebase ID token: three base64url segments. The value is meaningless.
const FIREBASE_JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYzEyMyJ9.eyJ1c2VyX2lkIjoidGVzdC11c2VyLTAwMSJ9.c2lnbmF0dXJlLXBsYWNlaG9sZGVy';

describe('which header carries the GitHub token', () => {
  it('reads the dedicated header', () => {
    expect(githubTokenFromRequest(req({ [GITHUB_TOKEN_HEADER]: 'gho_realGithubToken' }))).toBe('gho_realGithubToken');
  });

  it('THE REGRESSION: never forwards a Firebase ID token found in Authorization', () => {
    expect(githubTokenFromRequest(req({ authorization: `Bearer ${FIREBASE_JWT}` }))).toBeNull();
  });

  it('prefers the dedicated header even when Authorization also has something', () => {
    expect(githubTokenFromRequest(req({
      authorization: `Bearer ${FIREBASE_JWT}`,
      [GITHUB_TOKEN_HEADER]: 'gho_realGithubToken',
    }))).toBe('gho_realGithubToken');
  });

  it('still accepts an older client that sent a real GitHub token in Authorization', () => {
    expect(githubTokenFromRequest(req({ authorization: 'token gho_realGithubToken' }))).toBe('gho_realGithubToken');
    expect(githubTokenFromRequest(req({ authorization: 'Bearer ghp_realGithubToken' }))).toBe('ghp_realGithubToken');
  });

  it('handles a repeated header and an absent one', () => {
    expect(githubTokenFromRequest(req({ [GITHUB_TOKEN_HEADER]: ['gho_first', 'gho_second'] }))).toBe('gho_first');
    expect(githubTokenFromRequest(req({}))).toBeNull();
    expect(githubTokenFromRequest(req({ authorization: 'Bearer   ' }))).toBeNull();
  });

  it('recognises a JWT by shape, and does not mistake a GitHub token for one', () => {
    expect(looksLikeFirebaseIdToken(FIREBASE_JWT)).toBe(true);
    expect(looksLikeFirebaseIdToken('gho_16C7e42F292c6912E7710c838347Ae178B4a')).toBe(false);
    expect(looksLikeFirebaseIdToken('github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWX')).toBe(false);
  });
});

describe('both route files use the shared contract', () => {
  // Grep-level, deliberately: the bug was a SECOND private copy of "which header?", and only reading the
  // real source can prove a third one has not appeared.
  const read = (p: string) => readFileSync(join(process.cwd(), 'src/server/routes', p), 'utf8');

  it('routes/mobileShip.ts does not read the Authorization header itself', () => {
    const src = read('mobileShip.ts');
    expect(src).toContain('mobileShipAuth');
    expect(src).not.toMatch(/req\.headers\.authorization/);
  });

  it('routes/mobileSetup.ts does not grow its own second copy either', () => {
    const src = read('mobileSetup.ts');
    expect(src).not.toMatch(/req\.headers\.authorization/);
  });
});
