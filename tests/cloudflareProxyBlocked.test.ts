/**
 * When Cloudflare's proxy blocks the domain, SAY SO — and say the one thing that fixes it.
 *
 * The admin connected their own domain, deployed, and got Cloudflare's **error 525, "SSL handshake
 * failed"**: browser ✅, Cloudflare ✅, host ❌.
 *
 * We already knew why. `cloudflareManagedDns.ts` says it in the code: records are written proxied OFF
 * because *"Firebase must see its own A records directly to validate ownership and issue the
 * certificate; proxying through Cloudflare would break the attach. This is a correctness constraint,
 * not a style choice."*
 *
 * But when it actually happened, `checkDomainServing` reported a bare "answered with an error (HTTP
 * 525)" and the user was left on Cloudflare's page being told to check an SSL configuration they did
 * not know they had. The system knew the answer and did not say it — which is the failure this closes.
 */
import { describe, it, expect } from 'vitest';
import {
  checkDomainServing, canClaimLive, isCloudflareOriginError, proxyBlockedNote,
} from '../src/server/lib/domainServingCheck';

const allow = async () => ({ ok: true });
const answering = (status: number, body = '') =>
  async () => ({ status, text: async () => body });

describe('the 52x band is Cloudflare talking, not the app', () => {
  it('recognises every origin-side code', () => {
    for (const s of [521, 522, 523, 524, 525, 526]) {
      expect(isCloudflareOriginError(s), String(s)).toBe(true);
    }
  });

  it('cannot mislabel an ordinary error page — no framework returns these', () => {
    for (const s of [200, 301, 404, 429, 500, 502, 503, 520, 527, 530]) {
      expect(isCloudflareOriginError(s), String(s)).toBe(false);
    }
    expect(isCloudflareOriginError(NaN)).toBe(false);
    expect(isCloudflareOriginError(525.5)).toBe(false);
  });
});

describe('the exact error the admin hit', () => {
  it('525 becomes proxy_blocked, not a bare "error"', async () => {
    const r = await checkDomainServing('mitrify.xyz', answering(525) as never, 6000, allow);
    expect(r.state).toBe('proxy_blocked');
    expect(r.status).toBe(525);
  });

  it('the note names the orange cloud and the exact click', async () => {
    const { note } = await checkDomainServing('example.com', answering(525) as never, 6000, allow);
    expect(note).toMatch(/orange cloud/i);
    expect(note).toMatch(/DNS → Records/);
    expect(note).toMatch(/grey/i);
    expect(note).toMatch(/DNS only/i);
  });

  it('tells the user their app is fine — because it is', async () => {
    // The app builds, compiles and is published. Only the DNS path in front of it is wrong, and a
    // message that implies otherwise sends someone rebuilding a working app.
    const { note } = await checkDomainServing('example.com', answering(525) as never, 6000, allow);
    expect(note).toMatch(/Nothing about your app is broken/i);
  });

  it('does NOT repeat Cloudflare\'s own useless advice', async () => {
    // Cloudflare's page says "the SSL configuration used is not compatible" — true, and no help at all
    // to someone who did not know they had an SSL configuration.
    const { note } = await checkDomainServing('example.com', answering(525) as never, 6000, allow);
    expect(note).not.toMatch(/cipher|not compatible|SSL configuration/i);
  });

  it('526 says the certificate was rejected, not that the connection failed', () => {
    expect(proxyBlockedNote(526)).toMatch(/rejected the certificate/i);
    expect(proxyBlockedNote(525)).toMatch(/could not open a secure connection/i);
  });
});

describe('a blocked domain is never called Live', () => {
  it('proxy_blocked withdraws the claim, like the other positive-evidence states', () => {
    // Cloudflare said it from the edge; the certificate cannot be issued while the record is proxied.
    // Calling this "Live" while the user stares at an error page is the fake success canClaimLive exists for.
    expect(canClaimLive(true, 'proxy_blocked')).toBe(false);
    expect(canClaimLive(true, 'nothing_published')).toBe(false);
    expect(canClaimLive(true, 'error')).toBe(false);
  });

  it('and the states that SHOULD still claim it are untouched', () => {
    expect(canClaimLive(true, 'serving')).toBe(true);
    // `unknown` means OUR check failed — downgrading a working domain for that would be the same
    // dishonesty in the other direction.
    expect(canClaimLive(true, 'unknown')).toBe(true);
    expect(canClaimLive(false, 'serving')).toBe(false);
  });
});

describe('the other states still behave exactly as before', () => {
  it('a working domain serves', async () => {
    expect((await checkDomainServing('x.com', answering(200) as never, 6000, allow)).state).toBe('serving');
  });

  it('Firebase\'s empty-site page is still its own state', async () => {
    const r = await checkDomainServing('x.com', answering(404, "site not found — you haven't deployed") as never, 6000, allow);
    expect(r.state).toBe('nothing_published');
  });

  it('an ordinary 500 is still a plain error', async () => {
    expect((await checkDomainServing('x.com', answering(500) as never, 6000, allow)).state).toBe('error');
  });
});
