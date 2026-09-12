import { describe, it, expect } from 'vitest';
import { remixGate, remixRefusal, type RemixGateFacts } from './remixPlanGate';

const facts = (over: Partial<RemixGateFacts> = {}): RemixGateFacts => ({
  plansEnabled: true,
  uid: 'u1',
  freeListed: false,
  isOwnApp: false,
  alreadyPurchased: false,
  planKnown: true,
  planActive: false,
  ...over,
});

describe('remixGate — the entitlement both remix surfaces share', () => {
  it('a signed-in user WITH a plan may remix', () => {
    expect(remixGate(facts({ planActive: true }))).toEqual({ allow: true });
  });

  it('a signed-in user WITHOUT a plan is refused — this is the admin’s instruction', () => {
    expect(remixGate(facts())).toEqual({ allow: false, reason: 'no-plan' });
  });

  it('a signed-OUT visitor is asked to sign in first — they cannot hold a plan without an account', () => {
    expect(remixGate(facts({ uid: null }))).toEqual({ allow: false, reason: 'signed-out' });
  });
});

describe('the three exemptions, which must never be quietly dropped', () => {
  it('🔒 YOUR OWN app is always yours — a plan to read your own code would be absurd', () => {
    expect(remixGate(facts({ isOwnApp: true }))).toEqual({ allow: true });
    // And even signed-out cannot reach this: ownership is proven by uid, so the branch is coherent.
    expect(remixGate(facts({ isOwnApp: true, planActive: false, planKnown: true }))).toEqual({ allow: true });
  });

  it('🔒 an app you ALREADY BOUGHT stays yours — "buy once, take the code whenever you like"', () => {
    // Retroactively gating a paid entitlement is the one thing a store may never do.
    expect(remixGate(facts({ alreadyPurchased: true }))).toEqual({ allow: true });
  });

  it('the admin/tester free-list is exempt, like every other gate here', () => {
    expect(remixGate(facts({ freeListed: true }))).toEqual({ allow: true });
    expect(remixGate(facts({ freeListed: true, uid: null }))).toEqual({ allow: true });
  });
});

describe('🔒 it fails OPEN — rule #1 says an outage must never block a legitimate user', () => {
  it('a plan store that could not answer ALLOWS', () => {
    expect(remixGate(facts({ planKnown: false }))).toEqual({ allow: true });
  });

  it('only a KNOWN "no active plan" refuses', () => {
    expect(remixGate(facts({ planKnown: true, planActive: false }))).toEqual({ allow: false, reason: 'no-plan' });
    expect(remixGate(facts({ planKnown: false, planActive: false }))).toEqual({ allow: true });
  });

  it('plans switched off entirely means nothing to gate — today’s behaviour exactly', () => {
    expect(remixGate(facts({ plansEnabled: false }))).toEqual({ allow: true });
    expect(remixGate(facts({ plansEnabled: false, uid: null }))).toEqual({ allow: true });
  });
});

describe('remixRefusal — a refusal with no way forward is a dead button', () => {
  it('names the price and asks for the plan', () => {
    const r = remixRefusal('no-plan', 149);
    expect(r.status).toBe(402);
    expect(r.body.needsPlan).toBe(true);
    expect(r.body.priceInr).toBe(149);
    expect(r.body.error).toContain('₹149');
  });

  it('a signed-out visitor is told BOTH things at once, so there is no second surprise', () => {
    const r = remixRefusal('signed-out', 149);
    expect(r.status).toBe(401);
    expect(r.body.needsSignIn).toBe(true);
    expect(r.body.needsPlan).toBe(true);
    expect(r.body.error.toLowerCase()).toContain('sign in');
    expect(r.body.error).toContain('₹149');
  });

  it('says the app itself stays free to use — the fairness that makes the gate honest', () => {
    expect(remixRefusal('no-plan', 149).body.error.toLowerCase()).toContain('free');
    expect(remixRefusal('signed-out', 149).body.error.toLowerCase()).toContain('free');
  });

  it('the price comes from the caller, never from a constant typed in here', () => {
    expect(remixRefusal('no-plan', 199).body.error).toContain('₹199');
    expect(remixRefusal('no-plan', 199).body.priceInr).toBe(199);
  });
});
