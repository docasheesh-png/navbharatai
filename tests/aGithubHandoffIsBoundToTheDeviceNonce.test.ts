// Q-629 (admin decision 2026-10-05, option a) and the server half of Q-623.
//
// Q-629. The native GitHub hand-off returned `com.navbharat.ai://github-callback#gh_token=<token>` for
// the public state `nbai-native`, and the server FELL BACK to it whenever a v2 app's identity check
// failed — which is every user signing IN with GitHub on the phone. A custom scheme is claimable by any
// installed app, and the token is `repo workflow`. Now the app makes a one-time device nonce, the
// state carries only its hash, the deep link carries only an encrypted ticket, and the ticket is
// redeemed ONCE by presenting the nonce. No identity needed, no fallback, no token in a URL.
//
// Q-623 (server half). The web callback released a token for any state — even none — so an attacker's
// own authorization code sent to a victim planted the attacker's token. Now only a signed state that
// carries the starting tab's nonce gets a token, and the nonce comes back beside it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => {
  const post = vi.fn();
  const get = vi.fn();
  return { default: { post, get }, post, get };
});

import axios from 'axios';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import {
  GITHUB_NONCE_HEADER,
  NATIVE_STATE_DEVICE,
  TICKET_TTL_MS,
  TicketLedger,
  deviceChallenge,
  signDeviceState,
  parseNativeState,
  makeDeviceTicket,
  makeTicket,
  readDeviceTicket,
  readTicket,
  legacyTokenReturnEnabled,
  LEGACY_TOKEN_RETURN_ENV,
} from '../src/server/lib/githubNativeHandoff';
import { signWebState, parseWebState, WEB_STATE_PREFIX } from '../src/server/lib/githubWebState';
import { registerGithubAuthRoutes } from '../src/server/routes/githubAuth';

const SECRET = 'test-secret-key';
const NOW = 1_800_000_000_000;
const NONCE = '0123456789abcdef'.repeat(4);
const OTHER = 'f'.repeat(64);
const enc = (s: string) => `enc(${Buffer.from(s, 'utf8').toString('base64')})`;
const dec = (c: string) => {
  const m = /^enc\((.*)\)$/.exec(c);
  if (!m) throw new Error('not our ciphertext');
  return Buffer.from(m[1], 'base64').toString('utf8');
};

// ── The pure pieces ────────────────────────────────────────────────────────────────────────────────
describe('the device state carries only the HASH of the nonce', () => {
  it('round-trips, and the nonce itself never appears in the state', () => {
    const state = signDeviceState(SECRET, deviceChallenge(NONCE), NOW + 60_000);
    expect(state.startsWith(`${NATIVE_STATE_DEVICE}.`)).toBe(true);
    expect(state).not.toContain(NONCE);
    expect(parseNativeState(SECRET, state, NOW)).toEqual({ kind: 'device', challenge: deviceChallenge(NONCE) });
  });

  it('🔒 a forged, tampered or expired device state is refused — never the legacy kind', () => {
    const good = signDeviceState(SECRET, deviceChallenge(NONCE), NOW + 60_000);
    for (const bad of [`${good}x`, good.replace(deviceChallenge(NONCE), deviceChallenge(OTHER)), `${NATIVE_STATE_DEVICE}.a.b`]) {
      expect(parseNativeState(SECRET, bad, NOW).kind).toBe('device-invalid');
    }
    expect(parseNativeState(SECRET, signDeviceState(SECRET, deviceChallenge(NONCE), NOW - 1), NOW))
      .toEqual({ kind: 'device-invalid', reason: 'expired' });
  });
});

describe('the device ticket — redeemed once, by the nonce, before it expires', () => {
  const challenge = deviceChallenge(NONCE);

  it('opens for the right nonce, and the token is never in the clear', () => {
    const t = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(t).not.toContain('gho_real');
    expect(readDeviceTicket(t, NONCE, NOW + 1000, dec, new TicketLedger())).toEqual({ ok: true, token: 'gho_real' });
  });

  it('🔒 THE ATTACK: an app that intercepted the deep link has the ticket but not the nonce', () => {
    const t = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(readDeviceTicket(t, OTHER, NOW, dec, new TicketLedger())).toEqual({ ok: false, reason: 'wrong-device' });
    expect(readDeviceTicket(t, undefined, NOW, dec, new TicketLedger())).toEqual({ ok: false, reason: 'bad-nonce' });
  });

  it('🔒 single use: the second redemption of the same ticket is refused', () => {
    const ledger = new TicketLedger();
    const t = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(readDeviceTicket(t, NONCE, NOW, dec, ledger).ok).toBe(true);
    expect(readDeviceTicket(t, NONCE, NOW + 1, dec, ledger)).toEqual({ ok: false, reason: 'replayed' });
  });

  it('a wrong-nonce attempt does not burn the real user\'s ticket', () => {
    const ledger = new TicketLedger();
    const t = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(readDeviceTicket(t, OTHER, NOW, dec, ledger).ok).toBe(false);
    expect(readDeviceTicket(t, NONCE, NOW, dec, ledger).ok).toBe(true);
  });

  it('🔒 expires', () => {
    const t = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(readDeviceTicket(t, NONCE, NOW + TICKET_TTL_MS + 1, dec, new TicketLedger()))
      .toEqual({ ok: false, reason: 'expired' });
  });

  it('a uid ticket and a device ticket cannot be opened through each other\'s door', () => {
    const uidTicket = makeTicket('gho_real', 'uid-1', NOW, enc);
    expect(readDeviceTicket(uidTicket, NONCE, NOW, dec, new TicketLedger()).ok).toBe(false);
    const deviceTicket = makeDeviceTicket('gho_real', challenge, NOW, enc, 'id1');
    expect(readTicket(deviceTicket, 'uid-1', NOW, dec).ok).toBe(false);
  });
});

describe('the legacy switch', () => {
  it('defaults ON (dated 2026-10-05: pre-2026-08-28 installs still need it) and turns off by name', () => {
    expect(legacyTokenReturnEnabled({})).toBe(true);
    for (const off of ['off', 'OFF', '0', 'false', 'no']) {
      expect(legacyTokenReturnEnabled({ [LEGACY_TOKEN_RETURN_ENV]: off })).toBe(false);
    }
    expect(LEGACY_TOKEN_RETURN_ENV).toBe('GITHUB_NATIVE_LEGACY_TOKEN_RETURN');
  });
});

describe('the web state binds the nonce and the return URL', () => {
  it('round-trips and refuses tampering', () => {
    const state = signWebState(SECRET, 'https://navbharatai.com/build', NONCE, NOW + 60_000);
    expect(parseWebState(SECRET, state, NOW)).toEqual({ kind: 'web', returnUrl: 'https://navbharatai.com/build', nonce: NONCE });
    expect(parseWebState(SECRET, state.replace(NONCE, OTHER), NOW).kind).toBe('web-invalid');
    expect(parseWebState('other', state, NOW).kind).toBe('web-invalid');
    expect(parseWebState(SECRET, signWebState(SECRET, '', NONCE, NOW - 1), NOW))
      .toEqual({ kind: 'web-invalid', reason: 'expired' });
    expect(parseWebState(SECRET, 'https://navbharatai.com/', NOW)).toEqual({ kind: 'none' });
  });
});

// ── The routes, end to end ─────────────────────────────────────────────────────────────────────────
describe('the routes', () => {
  const routes = captureRoutes(registerGithubAuthRoutes);
  const urlRoute = routes.get('GET /api/auth/github/url')!;
  // Registered with an array of paths, so the harness keys it by the array's joined form.
  const callback = [...routes.entries()].find(([k]) => k.startsWith('GET ') && k.includes('/api/github/callback'))![1];
  const exchange = routes.get('POST /api/github/native-exchange')!;
  const post = (axios as any).post as ReturnType<typeof vi.fn>;
  const saved = { ...process.env };

  function res() {
    const r: any = mockRes();
    r.redirectedTo = null;
    r.redirect = (u: string) => { r.redirectedTo = u; r.statusCode = 302; return r; };
    return r;
  }
  async function startUrl(query: Record<string, string>, headers: Record<string, string> = {}) {
    const r = res();
    await urlRoute(mockReq({ query, headers }), r);
    return r;
  }
  async function runCallback(state: string) {
    const r = res();
    await callback(mockReq({ query: { code: 'the-code', state } }), r);
    return r;
  }

  beforeEach(() => {
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    delete process.env[LEGACY_TOKEN_RETURN_ENV];
    post.mockReset();
    post.mockResolvedValue({ data: { access_token: 'gho_REAL_TOKEN' } });
  });
  afterEach(() => { process.env = { ...saved }; });

  it('Q-629 end to end: device flow works signed-out, the deep link carries no token, redeem is once', async () => {
    const started = await startUrl({ state: 'nbai-native', handoff: 'device' }, { [GITHUB_NONCE_HEADER]: NONCE });
    expect(started.statusCode).toBe(200);
    const state = started.body.state as string;
    expect(state.startsWith(`${NATIVE_STATE_DEVICE}.`)).toBe(true);
    expect(state).not.toContain(NONCE);

    const cb = await runCallback(state);
    const link = cb.redirectedTo as string;
    expect(link.startsWith('com.navbharat.ai://github-callback#gh_ticket=')).toBe(true);
    expect(link).not.toContain('gho_REAL_TOKEN');
    expect(link).not.toContain('gh_token');
    const ticket = new URLSearchParams(link.split('#')[1]).get('gh_ticket')!;

    const thief = res();
    await exchange(mockReq({ body: { ticket, nonce: OTHER } }), thief);
    expect(thief.statusCode).toBe(400);

    const first = res();
    await exchange(mockReq({ body: { ticket, nonce: NONCE } }), first);
    expect(first.body).toEqual({ token: 'gho_REAL_TOKEN' });
    expect(first.headers['cache-control']).toBe('no-store');

    const replay = res();
    await exchange(mockReq({ body: { ticket, nonce: NONCE } }), replay);
    expect(replay.statusCode).toBe(400);
  });

  it('a device request without a valid nonce is refused, not downgraded', async () => {
    const r = await startUrl({ state: 'nbai-native', handoff: 'device' }, { [GITHUB_NONCE_HEADER]: 'nope' });
    expect(r.statusCode).toBe(400);
  });

  it('🔒 Q-629: a v2 request whose identity check fails does NOT fall back to the token-in-URL state', async () => {
    const r = await startUrl({ state: 'nbai-native', handoff: 'ticket' });
    expect(r.statusCode).toBe(401);
    expect(r.body?.url).toBeUndefined();
    expect(r.body?.state).toBeUndefined();
  });

  it('the bare legacy state is served only while the switch is on', async () => {
    const on = await startUrl({ state: 'nbai-native' });
    expect(on.body.state).toBe('nbai-native');
    expect((await runCallback('nbai-native')).redirectedTo).toBe('com.navbharat.ai://github-callback#gh_token=gho_REAL_TOKEN');

    process.env[LEGACY_TOKEN_RETURN_ENV] = 'off';
    expect((await startUrl({ state: 'nbai-native' })).statusCode).toBe(400);
    post.mockClear();
    const cb = await runCallback('nbai-native');
    expect(cb.statusCode).toBe(400);
    expect(cb.redirectedTo).toBeNull();
    expect(post).not.toHaveBeenCalled(); // refused before the code is ever exchanged
  });

  it('Q-623: the web flow signs the tab nonce in and echoes it beside the token', async () => {
    const started = await startUrl({ state: 'https://navbharatai.com/build' }, { [GITHUB_NONCE_HEADER]: NONCE });
    expect((started.body.state as string).startsWith(`${WEB_STATE_PREFIX}.`)).toBe(true);
    const cb = await runCallback(started.body.state);
    expect(cb.redirectedTo).toBe(`https://navbharatai.com/build#gh_token=gho_REAL_TOKEN&gh_nonce=${NONCE}`);
  });

  it('🔒 Q-623: an unsigned web state (an attacker\'s own code sent to a victim) gets no token at all', async () => {
    for (const state of ['https://navbharatai.com/build', '', 'anything']) {
      post.mockClear();
      const cb = await runCallback(state);
      expect(cb.statusCode).toBe(400);
      expect(cb.redirectedTo).toBeNull();
      expect(String(cb.sent ?? '')).not.toContain('gho_REAL_TOKEN');
      expect(post).not.toHaveBeenCalled();
    }
  });

  it('a web start without a nonce is told to reload rather than sent to GitHub', async () => {
    const r = await startUrl({ state: 'https://navbharatai.com/build' });
    expect(r.statusCode).toBe(400);
    expect(r.body?.url).toBeUndefined();
  });

  it('safeReturnUrl stays in force inside a signed state: a foreign page gets the popup, never a redirect', async () => {
    const started = await startUrl({ state: 'https://navbharatai.com/pwa/abc' }, { [GITHUB_NONCE_HEADER]: NONCE });
    const cb = await runCallback(started.body.state);
    expect(cb.redirectedTo).toBeNull();
    const page = String(cb.sent);
    expect(page).toContain(`"${NONCE}"`);
    expect(page).not.toContain('/pwa/abc');
    expect(page).not.toMatch(/localStorage\.setItem\(\s*['"]gh_token/);
  });
});
