/**
 * Audit finding #3b — one client-side auth header.
 *
 * Eight files each carried their own "attach the Firebase ID token", under four names and two ways of
 * reaching Firebase. All eight were behaviourally equivalent when read, so no bug shipped from this —
 * but finding #3 is what a drifted auth helper becomes given time: a copy that could not import the
 * real thing was re-typed weaker, and the weaker one put a password in a URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const getIdToken = vi.fn();
// Mocks `src/lib/firebase`, NOT `src/App` (updated 2026-08-24). The module under test used to take
// `auth` off the app ROOT, which is the import cycle that made the client bundle unsplittable — see
// tests/appModuleGraph.test.ts. Mocking the root also meant this suite could pass while the real
// dependency was wrong; it now mocks the module `authHeaders` genuinely depends on.
vi.mock('../src/lib/firebase', () => ({
  get auth() { return { currentUser: currentUser as unknown }; },
}));

let currentUser: { getIdToken: () => Promise<string> } | null = null;

beforeEach(() => {
  getIdToken.mockReset();
  currentUser = null;
});

describe('authHeader', () => {
  it('carries the signed-in user\'s token', async () => {
    const { authHeader } = await import('../src/lib/authHeaders');
    getIdToken.mockResolvedValue('tok-123');
    currentUser = { getIdToken };
    expect(await authHeader()).toEqual({ Authorization: 'Bearer tok-123' });
  });

  it('returns {} when nobody is signed in — the caller lets the SERVER answer 401', async () => {
    const { authHeader } = await import('../src/lib/authHeaders');
    currentUser = null;
    expect(await authHeader()).toEqual({});
  });

  it('never throws when the token fetch fails — a sign-out race must not break a screen', async () => {
    const { authHeader } = await import('../src/lib/authHeaders');
    getIdToken.mockRejectedValue(new Error('network'));
    currentUser = { getIdToken };
    await expect(authHeader()).resolves.toEqual({});
  });

  it('omits the header for an empty token rather than sending `Bearer `', async () => {
    const { authHeader } = await import('../src/lib/authHeaders');
    getIdToken.mockResolvedValue('');
    currentUser = { getIdToken };
    expect(await authHeader()).toEqual({});
  });
});

describe('authJsonHeaders', () => {
  it('adds the JSON content type, signed in or not', async () => {
    const { authJsonHeaders } = await import('../src/lib/authHeaders');
    currentUser = null;
    expect(await authJsonHeaders()).toEqual({ 'Content-Type': 'application/json' });
    getIdToken.mockResolvedValue('tok-9');
    currentUser = { getIdToken };
    expect(await authJsonHeaders()).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok-9' });
  });
});

describe('the copies are gone and cannot come back', () => {
  const files = execSync(
    "find src/components src/lib -name '*.ts' -o -name '*.tsx' | grep -v '\\.test\\.'",
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  it('no component defines its own ID-token header helper', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('src/lib/authHeaders.ts')) continue; // the definition
      // authedFetch keeps the NAME `authHeaders` because eight files import it, but it no longer
      // implements the token path — the next assertion proves it delegates.
      if (f.endsWith('src/lib/authedFetch.ts')) continue;
      let src: string;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      if (/^(export )?async function auth(Header|Headers|JsonHeaders)\s*\(/m.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('the files that carried a copy now import the shared one', () => {
    for (const f of [
      'src/components/agentv3/AgentV3Panel.tsx',
      'src/components/agentv3/PreviewSurface.tsx',
      'src/components/agentv3/NbaiDomainConnect.tsx',
      'src/components/ide/WorkspaceLogs.tsx',
      'src/components/ide/ShellTerminal.tsx',
      'src/components/ide/ShareForReview.tsx',
      'src/components/ide/TeamLibraryPanel.tsx',
      'src/components/ide/teamAuth.ts',
      'src/lib/pushApi.ts',
    ]) {
      expect(readFileSync(f, 'utf8'), f).toContain('authHeaders');
    }
  });

  it('there is now ONE token path — authedFetch delegates instead of owning a second one', () => {
    const fetchMod = readFileSync('src/lib/authedFetch.ts', 'utf8');
    expect(fetchMod).toContain("from './authHeaders'");
    expect(fetchMod).not.toContain('getIdToken'); // it must not mint a token itself any more
  });

  it('teamAuthHeader keeps its name, so its two importers are untouched', () => {
    const src = readFileSync('src/components/ide/teamAuth.ts', 'utf8');
    expect(src).toContain('teamAuthHeader');
    for (const f of ['src/components/ide/MentionInbox.tsx', 'src/components/ide/TeamCollaboration.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('teamAuthHeader');
    }
  });

  it('🔒 does NOT touch the GitHub token — a different credential that happens to share the spelling', () => {
    // `/api/github/*` forwards localStorage.gh_token straight to GitHub as `token <x>`. Routing those
    // callers through the Firebase helper would send the wrong credential and 401 every repo list.
    const shared = readFileSync('src/lib/authHeaders.ts', 'utf8');
    expect(shared).not.toContain('localStorage');
    for (const f of ['src/components/ide/AppScanPanel.tsx', 'src/components/ide/AICodeReview.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('gh_token');
    }
  });
});
