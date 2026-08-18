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
import { readFileSync, readdirSync } from 'fs';
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

describe('EVERY route that needs a GitHub token uses the shared contract', () => {
  // Grep-level, deliberately: the bug was a SECOND private copy of "which header?", and only reading
  // the real source can prove another has not appeared.
  //
  // ⚠️ THIS BLOCK USED TO NAME TWO FILES, AND THAT IS EXACTLY HOW A THIRD COPY GOT IN (admin
  // 2026-08-19: "github connected hai fir bhi yeh error"). `routes/navStore.ts` — written after this
  // test — read the token from `body.githubToken` while its client sent the `X-GitHub-Token` HEADER,
  // so "Send for review" failed 100% of the time and told the user to connect an account that was
  // already connected. A guard over a FIXED LIST of files does not guard the rule; it guards the
  // files that existed the day it was written.
  //
  // So the list is DISCOVERED now: every route file that fetches a GitHub artifact or calls the
  // GitHub API must go through `githubTokenFromRequest`. A new route cannot opt out by being new.
  const routesDir = join(process.cwd(), 'src/server/routes');
  const read = (p: string) => readFileSync(join(routesDir, p), 'utf8');

  // Comments describe the broken shapes on purpose, so the scan must read CODE. A guard that fires
  // on the documentation of its own fix is a guard someone deletes.
  const codeOnly = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  /**
   * ⚠️ THE RULE IS NOT "never read the body" — and getting that wrong would have broken working
   * features. The v5.0 client genuinely posts `githubToken` in the BODY to its own `/api/agentv3/*`
   * routes (ship, revert, deploy), and those read it from the body. Client and server agree, so they
   * work; a blanket ban would have "fixed" them into failure.
   *
   * The real invariant is AGREEMENT: whatever a client sends, its server must read. This family —
   * the ship-to-stores and store-publish routes — has clients that send the dedicated HEADER
   * (`ghHeaders()`, shared with the Download button), so their servers must use the shared helper.
   */
  const HEADER_FAMILY = ['mobileShip.ts', 'mobileSetup.ts', 'navStore.ts'];

  it.each(HEADER_FAMILY)('routes/%s reads the token ONLY through the shared helper', (file) => {
    const src = codeOnly(read(file));
    expect(src, `${file} must import the one answer`).toContain('mobileShipAuth');
    expect(src, `${file} must not read Authorization itself`).not.toMatch(/req\.headers\.authorization/);
    // The navStore regression precisely: reaching into the BODY for a token this family's clients
    // only ever put in a header.
    expect(src, `${file} must not look for a body-carried GitHub token`).not.toMatch(/body\??\.githubToken/);
  });

  it('CLIENT AND SERVER AGREE for the store publish — the pair that actually broke', () => {
    // The failure was never visible in either file alone: each was self-consistent, and only the
    // PAIR was wrong. So the pair is what gets asserted.
    const client = readFileSync(join(process.cwd(), 'src/components/ide/PublishToNavStore.tsx'), 'utf8');
    expect(client, 'the publish form must send GitHub auth the way the Download button does').toContain('ghHeaders()');
    expect(codeOnly(read('navStore.ts')), 'so the server must read that header').toContain('githubTokenFromRequest(req)');
  });

  it('every route that downloads a build artifact uses the shared helper', () => {
    // Discovered, not listed: `fetchBuildArtifact` IS the header-based download path, so any route
    // reaching for it inherits the header contract — including routes written after today.
    const artifactRoutes = readdirSync(routesDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /fetchBuildArtifact/.test(codeOnly(read(f))));
    expect(artifactRoutes.length, 'a silent empty list would guard nothing').toBeGreaterThan(0);
    for (const file of artifactRoutes) {
      expect(codeOnly(read(file)), `${file} downloads an artifact but invents its own token source`)
        .toContain('githubTokenFromRequest');
    }
  });
});
