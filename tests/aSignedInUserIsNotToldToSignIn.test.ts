// A SIGNED-IN USER IS NEVER TOLD TO SIGN IN (admin screenshot 2026-11-21: avatar shown, the Pro build answered "Please sign in
// to build with NavBharatAI Pro", while the private-files list on the same screen loaded with the same account).
//
// 🔑 ROOT CAUSE. The build asks for a FRESH token (a network call to the token service). The build hook kept a private copy
// of the header helper whose catch dropped the token altogether when that one call failed, so the build went out with no
// identity — every other request, sent with the cached token, was verified. 🧬 CLASS: a transient refresh failure turned into
// "not signed in". One token path now (`currentIdToken`); a failed forced refresh falls back to the cached token; a 401
// "signin" for a user who IS signed in here is retried once, and never reads "please sign in".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fake = vi.hoisted(() => ({ user: null as null | { getIdToken: (force?: boolean) => Promise<string> } }));
vi.mock('../src/lib/firebase', () => ({ auth: { get currentUser() { return fake.user; } } }));
import { currentIdToken, authJsonHeaders, authHeader, signInRefusalMessage, SIGN_IN_NOT_CONFIRMED } from '../src/lib/authHeaders';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('🔑 one token path, and a failed refresh keeps the working token', () => {
  beforeEach(() => { fake.user = null; });

  it('the exact failure: the fresh-token call throws, the cached token still goes out', async () => {
    fake.user = { getIdToken: async (force?: boolean) => { if (force) throw new Error('auth/network-request-failed'); return 'cached-token'; } };
    expect(await currentIdToken(true)).toBe('cached-token');
    expect((await authJsonHeaders(true)).Authorization).toBe('Bearer cached-token');
    expect((await authHeader(true)).Authorization).toBe('Bearer cached-token');
  });

  it('a fresh token is used when the refresh works', async () => {
    fake.user = { getIdToken: async (force?: boolean) => (force ? 'fresh' : 'cached') };
    expect(await currentIdToken(true)).toBe('fresh');
    expect(await currentIdToken(false)).toBe('cached');
  });

  it('signed out, or no token at all: no Authorization header (the server answers honestly)', async () => {
    expect(await currentIdToken(true)).toBeNull();
    expect((await authJsonHeaders(true)).Authorization).toBeUndefined();
    fake.user = { getIdToken: async () => { throw new Error('auth/user-token-expired'); } };
    expect(await currentIdToken(true)).toBeNull();
  });

  it('🧬 census: the build hook keeps no private token helper; nothing outside the module re-implements the forced refresh', () => {
    const hook = read('src/hooks/useAgentV3Build.ts');
    expect(hook).not.toMatch(/async function authJsonHeaders/);
    expect(hook).toMatch(/import \{[^}]*authJsonHeaders[^}]*\} from '\.\.\/lib\/authHeaders'/);
    const lib = read('src/lib/authHeaders.ts');
    expect((lib.match(/getIdToken\(/g) ?? []).length).toBe(2);   // both inside currentIdToken
  });
});

describe('🗣️ the refusal tells the truth', () => {
  it('a user signed in here reads "could not be confirmed", never "please sign in"', () => {
    const server = 'Please sign in to build with NavBharatAI Pro — builds run on a real account so usage can be tracked.';
    expect(signInRefusalMessage(server, true)).toBe(SIGN_IN_NOT_CONFIRMED);
    expect(SIGN_IN_NOT_CONFIRMED).not.toMatch(/^Please sign in/);
    expect(signInRefusalMessage(server, false)).toBe(server);   // a real visitor is still asked to sign in
  });

  it('the build retries a "signin" 401 once for a signed-in user, then shows the honest message', () => {
    const hook = read('src/hooks/useAgentV3Build.ts');
    expect(hook).toMatch(/if \(res\.status === 401 && auth\.currentUser && !opts\?\.queueContinuationNonce && !isStale\(gen\)\) \{[\s\S]{0,300}if \(code === 'signin'\) res = await sendBuild\(controller\.signal\);/);
    expect(hook).toMatch(/if \(res\.status === 401 && body\.code === 'signin'\) msg = signInRefusalMessage\(msg, !!auth\.currentUser\);/);
  });
});

describe('📎 an empty private-files panel takes no space', () => {
  it('hidden with no files and no error; shown with a file, or with an error to report', () => {
    const src = read('src/components/agentv3/StoredAttachments.tsx');
    expect(src).toMatch(/if \(!userId \|\| available !== true \|\| \(files\.length === 0 && !error\)\) return null;/);
  });
});
