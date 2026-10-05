// Q-623 (forensic audit 2026-10-04, P1) — a `#gh_token=` fragment is stored ONLY for a sign-in this tab
// started.
//
// THE ATTACK. App.tsx stored any `#gh_token=` fragment with no check, so the link
// `https://navbharatai.com/#gh_token=<attacker token>` planted the attacker's GitHub token in a victim's
// session — and the victim's later pushes landed in the attacker's account. The OAuth `state` carried no
// per-attempt value, so the same planting worked through the server callback too.
//
// THE CLASS. "A credential arriving at the client is trusted because of WHERE it arrived, not because
// this client asked for it." Its siblings, all covered here: the fragment, the popup's postMessage, the
// popup page writing storage directly, and the native deep link carrying a raw token.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redeemGithubTicket } from '../src/lib/githubOauthReturn';
import {
  GITHUB_WEB_NONCE_KEY,
  GITHUB_DEVICE_NONCE_KEY,
  GITHUB_NONCE_HEADER,
  NONCE_MAX_AGE_MS,
  newOauthNonce,
  beginGithubOauthAttempt,
  consumeGithubNonce,
  takeGithubReturnFragment,
  type NonceStorage,
} from '../src/lib/githubOauthNonce';

const NOW = 1_800_000_000_000;
const NONCE = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

function memoryStorage(): NonceStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

function started(nonce = NONCE, at = NOW) {
  const s = memoryStorage();
  beginGithubOauthAttempt(s, GITHUB_WEB_NONCE_KEY, at, nonce);
  return s;
}

describe('the fragment is stored only with the nonce this tab saved', () => {
  it('🔒 THE ATTACK: a fragment token with no nonce is discarded', () => {
    const s = started();
    expect(takeGithubReturnFragment('#gh_token=gho_attacker', s, NOW))
      .toEqual({ kind: 'rejected', reason: 'no-nonce' });
    // …and it did not cost the user their own in-flight sign-in.
    expect(s.map.has(GITHUB_WEB_NONCE_KEY)).toBe(true);
  });

  it('🔒 a fragment token with the WRONG nonce is discarded', () => {
    const s = started();
    expect(takeGithubReturnFragment(`#gh_token=gho_attacker&gh_nonce=${OTHER}`, s, NOW))
      .toEqual({ kind: 'rejected', reason: 'nonce-mismatch' });
  });

  it('🔒 a fragment token arriving when this tab started NO sign-in is discarded', () => {
    expect(takeGithubReturnFragment(`#gh_token=gho_attacker&gh_nonce=${NONCE}`, memoryStorage(), NOW).kind)
      .toBe('rejected');
    expect(takeGithubReturnFragment(`#gh_token=gho_attacker&gh_nonce=${NONCE}`, null, NOW).kind)
      .toBe('rejected');
  });

  it('the real return — right nonce — is stored, once', () => {
    const s = started();
    expect(takeGithubReturnFragment(`#gh_token=gho_real&gh_nonce=${NONCE}`, s, NOW + 5_000))
      .toEqual({ kind: 'accepted', token: 'gho_real' });
    expect(s.map.has(GITHUB_WEB_NONCE_KEY)).toBe(false); // single use: deleted on acceptance
  });

  it('🔒 a reused nonce is rejected — the same link cannot plant a second token', () => {
    const s = started();
    expect(takeGithubReturnFragment(`#gh_token=gho_real&gh_nonce=${NONCE}`, s, NOW).kind).toBe('accepted');
    expect(takeGithubReturnFragment(`#gh_token=gho_attacker&gh_nonce=${NONCE}`, s, NOW))
      .toEqual({ kind: 'rejected', reason: 'nonce-mismatch' });
  });

  it('a nonce older than the server state can live is dead', () => {
    const s = started(NONCE, NOW);
    expect(takeGithubReturnFragment(`#gh_token=gho_real&gh_nonce=${NONCE}`, s, NOW + NONCE_MAX_AGE_MS + 1).kind)
      .toBe('rejected');
  });

  it('URL-encoded tokens round-trip, and a page with no GitHub fragment is left alone', () => {
    const s = started();
    expect(takeGithubReturnFragment(`#gh_token=a%20b%26c&gh_nonce=${NONCE}`, s, NOW))
      .toEqual({ kind: 'accepted', token: 'a b&c' });
    expect(takeGithubReturnFragment('', s, NOW)).toEqual({ kind: 'absent' });
    expect(takeGithubReturnFragment('#fb_token=x', s, NOW)).toEqual({ kind: 'absent' });
  });

  it('a malformed nonce never matches, even if the same junk was somehow saved', () => {
    const s = memoryStorage();
    s.setItem(GITHUB_WEB_NONCE_KEY, JSON.stringify({ n: 'short', at: NOW }));
    expect(consumeGithubNonce(s, GITHUB_WEB_NONCE_KEY, 'short', NOW)).toBe(false);
    expect(consumeGithubNonce(s, GITHUB_WEB_NONCE_KEY, undefined, NOW)).toBe(false);
  });
});

describe('starting an attempt', () => {
  it('makes 32 random bytes of hex and sends them in the header, not the URL', () => {
    const n = newOauthNonce();
    expect(n).toMatch(/^[a-f0-9]{64}$/);
    expect(newOauthNonce()).not.toBe(n);
    const s = memoryStorage();
    expect(beginGithubOauthAttempt(s, GITHUB_WEB_NONCE_KEY, NOW, NONCE)).toEqual({ [GITHUB_NONCE_HEADER]: NONCE });
  });

  it('refuses to start when storage is unavailable — a return it cannot verify must not begin', () => {
    expect(() => beginGithubOauthAttempt(null, GITHUB_WEB_NONCE_KEY, NOW)).toThrow(/storage/);
  });
});

// ── The wiring: every intake goes through the one decision ────────────────────────────────────────
describe('every place a GitHub token enters the web client checks the nonce', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
  const app = read('src/App.tsx');
  const route = read('src/server/routes/githubAuth.ts');

  it('the fragment intake calls the tested decision and nothing reads gh_token off the hash directly', () => {
    expect(app).toContain("takeGithubReturnFragment(window.location.hash, browserStorage('session'), Date.now())");
    expect(app).not.toMatch(/hashParams\.get\(\s*['"]gh_token['"]\s*\)/);
  });

  it('the postMessage intake checks the nonce as well as the origin', () => {
    const at = app.indexOf("e.data.type === 'GITHUB_AUTH_SUCCESS'");
    const body = app.slice(at, app.indexOf("e.data.type === 'GITHUB_AUTH_ERROR'", at));
    expect(body).toContain('if (e.origin !== window.location.origin) return;');
    expect(body).toContain("consumeGithubNonce(browserStorage('session'), GITHUB_WEB_NONCE_KEY, e.data.nonce, Date.now())");
  });

  it('both web sign-in starters send a nonce', () => {
    expect(read('src/hooks/useGitHubConnect.ts')).toContain('beginGithubOauthAttempt(browserStorage(\'session\'), GITHUB_WEB_NONCE_KEY');
    expect(read('src/components/agentv3/AgentV3Panel.tsx')).toContain('beginGithubOauthAttempt(browserStorage(\'session\'), GITHUB_WEB_NONCE_KEY');
  });

  it('🔒 the callback\'s popup page never writes the token into storage itself', () => {
    // It used to set localStorage gh_token + gh_token_signal directly, which planted a token in every
    // open tab for a code nobody in this browser asked for.
    expect(route).not.toMatch(/localStorage\.setItem\(\s*['"]gh_token/);
    expect(route).toContain("postMessage({ type: 'GITHUB_AUTH_SUCCESS', token: token, nonce: nonce }, targetOrigin)");
  });
});

// ── Native (Q-629): the app redeems a ticket only for a sign-in it started ───────────────────────────
describe('redeemGithubTicket presents the device nonce, once', () => {
  function okPost() {
    const calls: Array<{ url: string; body: unknown }> = [];
    const post = async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ token: 'gho_real' }), { status: 200 });
    };
    return { calls, post };
  }

  it('🔒 an unsolicited ticket (no saved nonce) is never even sent to the server', async () => {
    const { calls, post } = okPost();
    expect(await redeemGithubTicket('T', { post, storage: memoryStorage(), nowMs: NOW })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('sends the ticket WITH the saved nonce, and the nonce is single use', async () => {
    const s = memoryStorage();
    beginGithubOauthAttempt(s, GITHUB_DEVICE_NONCE_KEY, NOW, NONCE);
    const { calls, post } = okPost();
    expect(await redeemGithubTicket('T', { post, storage: s, nowMs: NOW })).toBe('gho_real');
    expect(calls).toEqual([{ url: '/api/github/native-exchange', body: { ticket: 'T', nonce: NONCE } }]);
    expect(await redeemGithubTicket('T', { post, storage: s, nowMs: NOW })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
