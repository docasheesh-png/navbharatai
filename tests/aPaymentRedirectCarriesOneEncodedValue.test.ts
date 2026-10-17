// Q-889 — THE REDIRECT CARRIES ONE ENCODED VALUE, AND THE HOST HEADER IS CHECKED BEFORE IT IS TRUSTED.
//
// Both halves were verified present before being touched (Q-1126 batch 1 census):
//   · `payment.ts:555` — `res.redirect(\`/?payment=check&order_id=${order_id}\`)`, the value raw;
//   · `payment.ts:303` — `const host = req.get('host')`, then `return_url` built from it.
//
// 🔑 THE TWO ARE DIFFERENT SIZES OF PROBLEM, and the row said so honestly: the redirect is
// same-origin and is NOT an open redirect, while `return_url` is where a payment provider sends the
// PAYER after they pay. Only the second can take someone somewhere else.
//
// ⚠️ WHY THE HOST IS SHAPE-CHECKED RATHER THAN COMPARED TO A CONFIGURED ORIGIN. There is no
// canonical-origin constant in this repo (searched PUBLIC_ORIGIN / APP_ORIGIN / APP_URL / SITE_URL —
// the only hits belong to GENERATED apps' database provisioning). Adding one means a new Cloud Run
// key whose absence does not degrade this flow but BREAKS it, since the payer is never returned —
// the trade the first absolute rule forbids, and with CI down (Q-1131) it cannot even be proven. The
// configured-origin version is Q-1134. A shape check cannot refuse a real deployment, so it ships now.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripCodeComments } from '../src/server/AgentV3/stripCodeComments';

const SRC = readFileSync(join(process.cwd(), 'src/server/routes/payment.ts'), 'utf8');
// Comments stripped: the fix's own comments QUOTE the old code as evidence, and a source check that
// reads its own documentation is a check that can never go green. (Written down because I made exactly
// this mistake twice in one day — on the Q-1037 census and again on Q-887's first assertion.)
const CODE = stripCodeComments(SRC);

/** The shape the route now requires of a Host header — re-derived here so the test states it itself. */
const HOST_SHAPE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;

describe('the payment redirect and the return_url do not trust what the client sent', () => {
  it('the redirect value is encoded', () => {
    expect(CODE).toContain('encodeURIComponent(orderId)');
    expect(CODE, 'the raw interpolation must be gone')
      .not.toMatch(/order_id=\$\{\s*order_id\s*\}/);
  });

  it('…and it is ONE value, because `as string` was a claim and not a check', () => {
    // `?order_id=a&order_id=b` makes Express hand back an array. The old cast asserted a string
    // without checking, and `encodeURIComponent(['a','b'])` would quietly encode "a,b".
    expect(CODE).toContain('Array.isArray(raw) ? raw[0] : raw');
    expect(CODE, 'a non-string must yield an empty value, never a stringified object')
      .toContain("typeof orderId === 'string' ? encodeURIComponent(orderId) : ''");
  });

  it('the Host header is checked before `return_url` is built from it', () => {
    expect(CODE).toContain('const rawHost =');
    expect(CODE, 'the check must come BEFORE the url that uses it')
      .toMatch(/rawHost[\s\S]{0,400}secureReturnUrl/);
    expect(CODE).toContain('A-Za-z0-9.-');
    // A malformed Host is refused through the shared door, so nothing of it reaches the client.
    expect(CODE).toContain("'payment create-order host'");
  });

  it('the shape accepts every real host and rejects every vector the row named', () => {
    for (const ok of [
      'navbharatai.com', 'www.navbharatai.com', 'mitrify.xyz', 'localhost:3000', '127.0.0.1:8080',
      'navbharat-ai-prod-abc123-as.a.run.app', 'a.b.c.d.e.f',
    ]) expect(HOST_SHAPE.test(ok), ok).toBe(true);

    for (const bad of [
      'evil.com/path',                 // a path smuggled into the authority
      'good.com@evil.com',             // userinfo: the browser goes to evil.com
      'good.com, evil.com',            // a second value
      'good.com\nX-Injected: 1',       // header injection
      'https://evil.com',              // a scheme
      'good.com:99999999',             // an impossible port
      '',                              // nothing at all
      ' good.com',                     // leading whitespace
      'good.com:abc',                  // a non-numeric port
    ]) expect(HOST_SHAPE.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it('the provider placeholder is NOT interpolation and must stay literal', () => {
    // `{order_id}` in `return_url` is the PROVIDER's own placeholder — it substitutes the real id when
    // it redirects the payer. Turning it into `${orderId}` would look like a fix and would break the
    // round trip, so it is pinned.
    expect(CODE).toContain('/api/payment/verify-redirect?order_id={order_id}');
  });
});
