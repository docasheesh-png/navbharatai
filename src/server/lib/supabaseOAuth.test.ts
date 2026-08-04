import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  createPkcePair, signOAuthState, verifyOAuthState, buildSupabaseAuthorizeUrl,
  tokenExchangeBody, refreshTokenBody, basicAuthHeader, parseCallbackParams,
  supabaseOAuthConfigured, connectFailureMessage,
  SUPABASE_SCOPES, SUPABASE_AUTHORIZE_URL, OAUTH_STATE_TTL_MS,
} from './supabaseOAuth';

const SECRET = 'test-signing-secret';
const NOW = 1_800_000_000_000;

describe('createPkcePair — the code is useless to an interceptor without the verifier', () => {
  it('derives the challenge as base64url(SHA-256(verifier)), per RFC 7636 S256', () => {
    const fixed = Buffer.alloc(32, 7);
    const { verifier, challenge } = createPkcePair(() => fixed);
    expect(verifier).toBe(fixed.toString('base64url'));
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
  });

  it('produces a verifier in the legal 43–128 char range with no URL-unsafe characters', () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('is random per call — two flows never share a verifier', () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
  });
});

describe('OAuth state — CSRF protection AND the binding to the user who started the flow', () => {
  const state = (uid = 'user-1', exp = NOW + OAUTH_STATE_TTL_MS, nonce = 'n1'): string =>
    signOAuthState(SECRET, uid, exp, nonce);

  it('round-trips and returns the user the flow began as', () => {
    expect(verifyOAuthState(SECRET, state('user-42'), NOW)).toEqual({ ok: true, userId: 'user-42' });
  });

  it('rejects a state signed with a DIFFERENT secret (forgery)', () => {
    const forged = signOAuthState('attacker-secret', 'victim', NOW + 60_000, 'n');
    expect(verifyOAuthState(SECRET, forged, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a TAMPERED userId — this is the attack that would attach an attacker\'s Supabase account to a victim', () => {
    const good = state('victim');
    const tampered = good.replace('victim', 'attack');
    expect(verifyOAuthState(SECRET, tampered, NOW).ok).toBe(false);
  });

  it('rejects an expired state, and accepts it right up to the boundary', () => {
    const exp = NOW + 1000;
    expect(verifyOAuthState(SECRET, state('u', exp), exp)).toEqual({ ok: true, userId: 'u' });
    expect(verifyOAuthState(SECRET, state('u', exp), exp + 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', 'a.b.c', 'a.b.c.d.e', 'u.notanumber.n.sig']) {
      expect(verifyOAuthState(SECRET, bad, NOW).ok).toBe(false);
    }
  });

  it('two flows in the SAME millisecond differ, so one cannot be replayed as the other', () => {
    expect(state('u', NOW, 'nonce-a')).not.toBe(state('u', NOW, 'nonce-b'));
  });
});

describe('buildSupabaseAuthorizeUrl — asks for the minimum, over the right endpoint', () => {
  const url = (): URL => new URL(buildSupabaseAuthorizeUrl({
    clientId: 'client-123',
    redirectUri: 'https://navbharatai.com/api/integrations/supabase/callback',
    state: 'signed-state',
    codeChallenge: 'challenge-abc',
  }));

  it('targets Supabase\'s own authorize endpoint with PKCE S256', () => {
    const u = url();
    expect(`${u.origin}${u.pathname}`).toBe(SUPABASE_AUTHORIZE_URL);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('signed-state');
    expect(u.searchParams.get('client_id')).toBe('client-123');
  });

  it('NEVER sends the code verifier to the authorize endpoint (that would defeat PKCE entirely)', () => {
    expect(url().searchParams.get('code_verifier')).toBeNull();
  });

  it('requests exactly the five Phase-1 scopes — a bigger consent screen loses users', () => {
    const scopes = (url().searchParams.get('scope') ?? '').split(' ');
    expect(scopes.sort()).toEqual([...SUPABASE_SCOPES].sort());
    // Scopes we deliberately do NOT ask for.
    for (const forbidden of ['analytics', 'domains', 'edge_functions', 'storage', 'rest']) {
      expect(scopes.join(' ')).not.toContain(forbidden);
    }
  });
});

describe('token exchange bodies', () => {
  it('sends the verifier (not the challenge) on the authorization_code grant', () => {
    const p = new URLSearchParams(tokenExchangeBody({
      code: 'the-code', redirectUri: 'https://navbharatai.com/cb', codeVerifier: 'the-verifier',
    }));
    expect(p.get('grant_type')).toBe('authorization_code');
    expect(p.get('code')).toBe('the-code');
    expect(p.get('code_verifier')).toBe('the-verifier');
    expect(p.get('redirect_uri')).toBe('https://navbharatai.com/cb');
  });

  it('builds a refresh grant', () => {
    const p = new URLSearchParams(refreshTokenBody('refresh-xyz'));
    expect(p.get('grant_type')).toBe('refresh_token');
    expect(p.get('refresh_token')).toBe('refresh-xyz');
  });

  it('puts credentials in a Basic header, so the secret never lands in a URL or a log line', () => {
    const h = basicAuthHeader('id', 'secret');
    expect(h.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(h.slice(6), 'base64').toString()).toBe('id:secret');
  });
});

describe('parseCallbackParams — a refusal is not a crash', () => {
  it('accepts a good callback', () => {
    expect(parseCallbackParams({ code: 'c', state: 's' })).toEqual({ ok: true, code: 'c', state: 's' });
  });

  it('surfaces the provider\'s own description when the user declines', () => {
    // Supabase reports this as query params on a 200 redirect, not an HTTP error — without this
    // branch "user pressed Cancel" would look like a malformed request.
    const r = parseCallbackParams({ error: 'access_denied', error_description: 'The user declined access.' });
    expect(r).toEqual({ ok: false, reason: 'The user declined access.' });
  });

  it('falls back to the error code when no description is given', () => {
    expect(parseCallbackParams({ error: 'server_error' })).toEqual({ ok: false, reason: 'server_error' });
  });

  it('names precisely what was missing', () => {
    expect(parseCallbackParams({ state: 's' })).toMatchObject({ ok: false });
    expect((parseCallbackParams({ state: 's' }) as { reason: string }).reason).toContain('authorization code');
    expect((parseCallbackParams({ code: 'c' }) as { reason: string }).reason).toContain('security token');
  });

  it('ignores non-string query values instead of trusting them', () => {
    expect(parseCallbackParams({ code: ['a'], state: 's' }).ok).toBe(false);
  });
});

describe('configuration + user-facing messages (honest states, rule 2)', () => {
  it('is only "configured" when BOTH credentials are present', () => {
    expect(supabaseOAuthConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(supabaseOAuthConfigured({ SUPABASE_OAUTH_CLIENT_ID: 'a' } as NodeJS.ProcessEnv)).toBe(false);
    expect(supabaseOAuthConfigured({ SUPABASE_OAUTH_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv)).toBe(false);
    expect(supabaseOAuthConfigured({ SUPABASE_OAUTH_CLIENT_ID: 'a', SUPABASE_OAUTH_CLIENT_SECRET: 'b' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('tells the user what to DO, not just that something failed', () => {
    expect(connectFailureMessage('expired')).toContain('again');
    expect(connectFailureMessage('bad-signature')).toContain('Settings → Database');
    expect(connectFailureMessage('not-configured')).toContain('not available yet');
    expect(connectFailureMessage('exchange-failed')).toContain('try once more');
  });

  it('passes a provider description through rather than replacing it with a vague line', () => {
    expect(connectFailureMessage('The user declined access.')).toBe('The user declined access.');
  });
});
