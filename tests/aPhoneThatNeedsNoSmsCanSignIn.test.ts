// ANDROID INSTANT VERIFICATION → A REAL SIGN-IN (admin 2026-09-30: "sabhi problem fix? … No - continue").
// The phone confirmed the number without an SMS; the app now signs in natively and hands that session
// over through the server. These lock the handover's order and failures, and the server's refusals.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { handOverNativePhoneSession, fetchPhoneExchange, type HandoverDeps } from '../src/lib/phoneHandover';
import { exchangePhoneIdToken, EXCHANGE_MAX_AGE_S, type ExchangeAuth } from '../src/server/lib/phoneTokenExchange';

const NOW = 1_800_000_000;
const TOKEN = 'x'.repeat(40);

function deps(over: Partial<HandoverDeps> = {}) {
  const calls: string[] = [];
  const d: HandoverDeps = {
    getNativeIdToken: async () => { calls.push('id'); return TOKEN; },
    exchange: async () => { calls.push('exchange'); return { ok: true, token: 'custom' }; },
    signInWithCustomToken: async (t) => { calls.push(`web:${t}`); },
    signOutNative: async () => { calls.push('native-out'); },
    ...over,
  };
  return { d, calls };
}

describe('the client handover', () => {
  it('reads the native token, exchanges it, signs the web session in, then signs the native one out', async () => {
    const { d, calls } = deps();
    expect(await handOverNativePhoneSession(d)).toEqual({ ok: true });
    expect(calls).toEqual(['id', 'exchange', 'web:custom', 'native-out']);
  });

  it('every failure ends in a named code and nothing after it runs', async () => {
    let r = deps({ getNativeIdToken: async () => { throw new Error('no user'); } });
    expect(await handOverNativePhoneSession(r.d)).toEqual({ ok: false, code: 'no-native-session' });
    r = deps({ exchange: async () => ({ ok: false, code: 'custom-token-unavailable' }) });
    expect(await handOverNativePhoneSession(r.d)).toEqual({ ok: false, code: 'custom-token-unavailable' });
    expect(r.calls).toEqual(['id']);
    r = deps({ signInWithCustomToken: async () => { throw new Error('x'); } });
    expect(await handOverNativePhoneSession(r.d)).toEqual({ ok: false, code: 'web-sign-in-failed' });
    expect(r.calls).not.toContain('native-out');
  });

  it('a native sign-out failure does not undo a sign-in that happened', async () => {
    const { d } = deps({ signOutNative: async () => { throw new Error('x'); } });
    expect(await handOverNativePhoneSession(d)).toEqual({ ok: true });
  });

  it('the exchange call reports the server\'s own code, or the HTTP status, never a throw', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true, token: 'c' }), { status: 200 }));
    expect(await fetchPhoneExchange(TOKEN, ok as unknown as typeof fetch)).toEqual({ ok: true, token: 'c' });
    const refused = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'stale' }), { status: 401 }));
    expect(await fetchPhoneExchange(TOKEN, refused as unknown as typeof fetch)).toEqual({ ok: false, code: 'stale' });
    const html = vi.fn(async () => new Response('<html>', { status: 502 }));
    expect(await fetchPhoneExchange(TOKEN, html as unknown as typeof fetch)).toEqual({ ok: false, code: 'http-502' });
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchPhoneExchange(TOKEN, down as unknown as typeof fetch)).toEqual({ ok: false, code: 'network' });
  });
});

function auth(decoded: Record<string, unknown> | Error, mint: string | Error = 'custom-token'): ExchangeAuth & { minted: string[] } {
  const minted: string[] = [];
  return {
    minted,
    verifyIdToken: async () => { if (decoded instanceof Error) throw decoded; return decoded as never; },
    createCustomToken: async (uid) => { if (mint instanceof Error) throw mint; minted.push(uid); return mint; },
  };
}
const PHONE = { uid: 'u1', phone_number: '+919800000000', auth_time: NOW - 10, firebase: { sign_in_provider: 'phone' } };

describe('the server exchange', () => {
  it('a fresh phone sign-in gets a custom token for the SAME uid', async () => {
    const a = auth(PHONE);
    expect(await exchangePhoneIdToken(TOKEN, a, NOW)).toEqual({ ok: true, token: 'custom-token' });
    expect(a.minted).toEqual(['u1']);
  });

  it('refuses a token that is not a phone sign-in — no other provider can be laundered through it', async () => {
    const a = auth({ ...PHONE, firebase: { sign_in_provider: 'password' } });
    expect(await exchangePhoneIdToken(TOKEN, a, NOW)).toMatchObject({ ok: false, status: 403, code: 'not-phone' });
    expect(a.minted).toEqual([]);
    expect(await exchangePhoneIdToken(TOKEN, auth({ ...PHONE, phone_number: undefined }), NOW)).toMatchObject({ code: 'not-phone' });
  });

  it('refuses an old sign-in, so a token found later cannot be replayed', async () => {
    const a = auth({ ...PHONE, auth_time: NOW - EXCHANGE_MAX_AGE_S - 1 });
    expect(await exchangePhoneIdToken(TOKEN, a, NOW)).toMatchObject({ ok: false, status: 401, code: 'stale' });
    expect(await exchangePhoneIdToken(TOKEN, auth({ ...PHONE, auth_time: undefined }), NOW)).toMatchObject({ code: 'stale' });
    expect(a.minted).toEqual([]);
  });

  it('refuses an invalid token and a malformed body', async () => {
    expect(await exchangePhoneIdToken(TOKEN, auth(new Error('bad')), NOW)).toMatchObject({ status: 401, code: 'invalid-token' });
    expect(await exchangePhoneIdToken(undefined, auth(PHONE), NOW)).toMatchObject({ status: 400 });
    expect(await exchangePhoneIdToken('short', auth(PHONE), NOW)).toMatchObject({ status: 400 });
  });

  it('a missing IAM permission is an honest 503 with its own code, not a fake success', async () => {
    expect(await exchangePhoneIdToken(TOKEN, auth(PHONE, new Error('iam.serviceAccounts.signBlob denied')), NOW))
      .toMatchObject({ ok: false, status: 503, code: 'custom-token-unavailable' });
    expect(await exchangePhoneIdToken(TOKEN, null, NOW)).toMatchObject({ status: 503, code: 'unavailable' });
  });

  it('the route is mounted and rate-limited per address', () => {
    const route = readFileSync('src/server/routes/auth.ts', 'utf8');
    expect(route).toMatch(/app\.post\('\/api\/auth\/phone-exchange'[\s\S]{0,400}consumeDurableRate\('phone_exchange_ip'/);
  });
});
