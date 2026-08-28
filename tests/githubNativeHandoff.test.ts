import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NATIVE_STATE_LEGACY,
  NATIVE_STATE_V2,
  NATIVE_OAUTH_REDIRECT,
  TICKET_TTL_MS,
  signNativeState,
  parseNativeState,
  makeTicket,
  readTicket,
  nativeReturnUrl,
} from '../src/server/lib/githubNativeHandoff';

/**
 * THE GITHUB TOKEN MUST STOP RIDING IN A DEEP LINK ANY APP CAN CLAIM.
 *
 * Security audit finding 1 (HIGH). The native OAuth return was
 * `com.navbharat.ai://github-callback#gh_token=<TOKEN>`, and a custom URI scheme is not exclusive on
 * Android — any installed app may declare `com.navbharat.ai`. The scope is `repo workflow`: full
 * read/write on every private repository the user has.
 *
 * The previous defences (origin allowlist, open-redirect guard, fixed scheme constant) all protected
 * against a crafted `state` sending the token somewhere else. None of them touched an app claiming the
 * scheme, because that attack never goes near `state`.
 */

const SECRET = 'test-secret-key';
const NOW = 1_700_000_000_000;

// A stand-in for lib/secrets: reversible, and tamper-evident like the real AES-GCM.
const enc = (s: string) => `enc(${Buffer.from(s, 'utf8').toString('base64')})`;
const dec = (c: string) => {
  const m = /^enc\((.*)\)$/.exec(c);
  if (!m) throw new Error('not our ciphertext');
  return Buffer.from(m[1], 'base64').toString('utf8');
};

describe('parseNativeState — which app is on the other end', () => {
  it('recognises a pre-ticket app and leaves it alone', () => {
    expect(parseNativeState(SECRET, NATIVE_STATE_LEGACY, NOW)).toEqual({ kind: 'legacy' });
  });

  it('recovers the uid from a signed v2 state', () => {
    const state = signNativeState(SECRET, 'uid-abc', NOW + 60_000);
    expect(state.startsWith(`${NATIVE_STATE_V2}.`)).toBe(true);
    expect(parseNativeState(SECRET, state, NOW)).toEqual({ kind: 'v2', uid: 'uid-abc' });
  });

  it('is "none" for the web flow, so browser OAuth is completely unchanged', () => {
    for (const s of ['https://navbharatai.com/build', '', undefined, null, 42]) {
      expect(parseNativeState(SECRET, s, NOW)).toEqual({ kind: 'none' });
    }
  });

  /**
   * ⚠️ THE ATTACK THIS BLOCKS, and the reason `v2-invalid` is its own outcome rather than a fallback.
   * If a broken v2 state degraded to `legacy`, an attacker would send a deliberately malformed one and
   * the server would helpfully revert to putting a repo-scoped token in the hijackable deep link —
   * defeating the entire fix with a typo.
   */
  it('a BROKEN v2 state is refused, never downgraded to the token path', () => {
    const good = signNativeState(SECRET, 'uid-abc', NOW + 60_000);

    expect(parseNativeState(SECRET, `${NATIVE_STATE_V2}.uid.123`, NOW))
      .toEqual({ kind: 'v2-invalid', reason: 'malformed' });
    expect(parseNativeState(SECRET, `${good}x`, NOW))
      .toEqual({ kind: 'v2-invalid', reason: 'bad-signature' });
    expect(parseNativeState('other-secret', good, NOW))
      .toEqual({ kind: 'v2-invalid', reason: 'bad-signature' });
    expect(parseNativeState(SECRET, signNativeState(SECRET, 'u', NOW - 1), NOW))
      .toEqual({ kind: 'v2-invalid', reason: 'expired' });

    // None of them is 'legacy'. That is the whole point.
    for (const bad of [`${NATIVE_STATE_V2}.a.b`, `${good}x`, `${NATIVE_STATE_V2}.u.notanumber.sig`]) {
      expect(parseNativeState(SECRET, bad, NOW).kind).not.toBe('legacy');
    }
  });

  it('a uid cannot be swapped without breaking the signature', () => {
    // Without the HMAC an attacker could bind a ticket to whichever user they liked.
    const state = signNativeState(SECRET, 'victim', NOW + 60_000);
    const forged = state.replace('victim', 'attacker');
    expect(parseNativeState(SECRET, forged, NOW).kind).toBe('v2-invalid');
  });

  it('checks the signature BEFORE the expiry', () => {
    // A forged state and an expired one must not be distinguishable by which error comes back.
    const forgedAndExpired = `${NATIVE_STATE_V2}.u.${NOW - 1}.deadbeef`;
    expect(parseNativeState(SECRET, forgedAndExpired, NOW))
      .toEqual({ kind: 'v2-invalid', reason: 'bad-signature' });
  });
});

describe('the ticket — encrypted, uid-bound, short-lived', () => {
  it('round-trips for the user it was minted for', () => {
    const t = makeTicket('gho_realtoken', 'uid-abc', NOW, enc);
    expect(t).not.toContain('gho_realtoken');   // the token is never in the clear
    expect(readTicket(t, 'uid-abc', NOW + 1000, dec)).toEqual({ ok: true, token: 'gho_realtoken' });
  });

  it('🔒 SOMEBODY ELSE cannot redeem it — this is the attack', () => {
    // An app that claimed com.navbharat.ai and grabbed the deep link holds this ticket. It still needs
    // the victim's Firebase session to get anywhere, and it does not have one.
    const t = makeTicket('gho_realtoken', 'victim-uid', NOW, enc);
    expect(readTicket(t, 'attacker-uid', NOW + 1000, dec)).toEqual({ ok: false, reason: 'wrong-user' });
  });

  it('expires', () => {
    const t = makeTicket('gho_realtoken', 'uid-abc', NOW, enc);
    expect(readTicket(t, 'uid-abc', NOW + TICKET_TTL_MS + 1, dec)).toEqual({ ok: false, reason: 'expired' });
  });

  it('reports ownership BEFORE expiry', () => {
    // Someone else's ticket is a security event; an expired one is routine. Reporting the routine
    // reason for the security event would hide it in the logs.
    const t = makeTicket('gho_realtoken', 'victim-uid', NOW, enc);
    expect(readTicket(t, 'attacker-uid', NOW + TICKET_TTL_MS + 1, dec).reason).toBe('wrong-user');
  });

  it('never throws on junk — a bad ticket is routine, not exceptional', () => {
    for (const junk of ['', '   ', 'not-a-ticket', null, undefined, 42, {}]) {
      expect(() => readTicket(junk, 'uid', NOW, dec)).not.toThrow();
      expect(readTicket(junk, 'uid', NOW, dec).ok).toBe(false);
    }
    expect(readTicket(enc('not json'), 'uid', NOW, dec)).toEqual({ ok: false, reason: 'unreadable' });
    expect(readTicket(enc('{"u":"uid"}'), 'uid', NOW, dec)).toEqual({ ok: false, reason: 'unreadable' });
  });
});

describe('nativeReturnUrl — one function decides the whole return', () => {
  it('a pre-ticket app gets EXACTLY what it got before', () => {
    // Byte-identical to the old nativeOauthReturn, because those installs run from assets baked into
    // their APK and a server deploy cannot change them.
    expect(nativeReturnUrl({ kind: 'legacy' }, 'tok123', null))
      .toBe('com.navbharat.ai://github-callback#gh_token=tok123');
    expect(nativeReturnUrl({ kind: 'legacy' }, 'a b&c', null))
      .toBe('com.navbharat.ai://github-callback#gh_token=a%20b%26c');
  });

  it('a v2 app gets the ticket and never the token', () => {
    const url = nativeReturnUrl({ kind: 'v2', uid: 'u' }, 'gho_secret', 'TICKET')!;
    expect(url).toBe('com.navbharat.ai://github-callback#gh_ticket=TICKET');
    expect(url).not.toContain('gho_secret');
    expect(url).not.toContain('gh_token');
  });

  it('🔒 NO TICKET means REFUSE, never fall back to the token', () => {
    // A missing ticket means encryption was unavailable. Silently reverting to the insecure path is
    // precisely what this change exists to remove.
    expect(nativeReturnUrl({ kind: 'v2', uid: 'u' }, 'gho_secret', null)).toBeNull();
  });

  it('refuses a broken v2 state and the web flow alike', () => {
    expect(nativeReturnUrl({ kind: 'v2-invalid', reason: 'bad-signature' }, 'tok', 'T')).toBeNull();
    expect(nativeReturnUrl({ kind: 'none' }, 'tok', 'T')).toBeNull();
  });

  it('🔒 the scheme target is a FIXED constant — a crafted state can never redirect the token', () => {
    // Carried over from the retired nativeOauthReturn test: this invariant is still load-bearing.
    expect(NATIVE_OAUTH_REDIRECT).toBe('com.navbharat.ai://github-callback');
    for (const url of [
      nativeReturnUrl({ kind: 'legacy' }, 'tok', null),
      nativeReturnUrl({ kind: 'v2', uid: 'u' }, 'tok', 'T'),
    ]) {
      expect(url!.startsWith(NATIVE_OAUTH_REDIRECT)).toBe(true);
    }
  });
});

// ── The wiring ─────────────────────────────────────────────────────────────────────────────────
describe('both ends are really connected', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/githubAuth.ts'), 'utf8');
  const ret = readFileSync(join(process.cwd(), 'src/lib/githubOauthReturn.ts'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
  const hook = readFileSync(join(process.cwd(), 'src/hooks/useGitHubConnect.ts'), 'utf8');

  it('the redeem endpoint takes its uid from a VERIFIED identity, never the body', () => {
    // Trusting a body-supplied uid would reduce the whole scheme to "tell me whose ticket this is".
    expect(route).toContain("app.post('/api/github/native-exchange'");
    expect(route).toContain('const identity = await verifyFirebaseIdentity(req);');
    expect(route).toContain('readTicket(req.body?.ticket, identity.uid, Date.now(), decrypt)');
    expect(route).not.toMatch(/readTicket\([^)]*req\.body\??\.\s*uid/);
  });

  it('the callback refuses a broken v2 state instead of downgrading', () => {
    expect(route).toContain("if (nativeState.kind === 'v2-invalid')");
  });

  it('the state is only upgraded for an app that ASKED and is AUTHENTICATED', () => {
    expect(route).toContain("String(req.query.handoff || '') === 'ticket'");
    expect(route).toContain('const identity = await verifyFirebaseIdentity(req);');
  });

  it('the dead helper is gone, not left looking like the live path', () => {
    expect(route).not.toContain('export function nativeOauthReturn');
  });

  it('the client handles BOTH a ticket and a legacy token', () => {
    // The SERVER chooses which to send, so the client cannot assume. Dropping the token branch would
    // break sign-in exactly when authentication was unavailable.
    expect(ret).toContain('export function ticketFromDeepLink');
    expect(ret).toContain('export function tokenFromDeepLink');
    expect(app).toContain('const ticket = ticketFromDeepLink(data?.url);');
    expect(app).toContain('const directToken = tokenFromDeepLink(data?.url);');
    expect(app).toContain('await redeemGithubTicket(ticket)');
  });

  it('the app asks for a ticket, with its identity attached', () => {
    expect(hook).toContain("reqUrl.searchParams.set('handoff', 'ticket')");
    expect(hook).toContain('authJsonHeaders');
    expect(hook).toContain('const response = await fetch(reqUrl.toString(), { headers: authHeader });');
  });
});
