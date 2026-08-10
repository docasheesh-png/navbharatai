import { describe, it, expect, afterEach } from 'vitest';
import { agentV3FreeList, isAgentV3FreeUser, isAgentV3PaidPublicEnabled, isAgentV3CreditGateEnabled, buildRequiresSignIn, costRoutingEnabled, costRoutingActiveFor } from './featureFlag';

const save = { ...process.env };
afterEach(() => {
  process.env.AGENTV3_FREE_LIST = save.AGENTV3_FREE_LIST;
  process.env.AGENTV3_ALLOWLIST = save.AGENTV3_ALLOWLIST;
  process.env.AGENTV3_PAID_PUBLIC = save.AGENTV3_PAID_PUBLIC;
  process.env.AGENTV3_CREDIT_GATE = save.AGENTV3_CREDIT_GATE;
  process.env.AGENTV3_COST_ROUTING = save.AGENTV3_COST_ROUTING;
  process.env.AGENTV3_COST_ROUTING_USERS = save.AGENTV3_COST_ROUTING_USERS;
  if (save.AGENTV3_FREE_LIST === undefined) delete process.env.AGENTV3_FREE_LIST;
  if (save.AGENTV3_ALLOWLIST === undefined) delete process.env.AGENTV3_ALLOWLIST;
  if (save.AGENTV3_PAID_PUBLIC === undefined) delete process.env.AGENTV3_PAID_PUBLIC;
  if (save.AGENTV3_CREDIT_GATE === undefined) delete process.env.AGENTV3_CREDIT_GATE;
  if (save.AGENTV3_COST_ROUTING === undefined) delete process.env.AGENTV3_COST_ROUTING;
  if (save.AGENTV3_COST_ROUTING_USERS === undefined) delete process.env.AGENTV3_COST_ROUTING_USERS;
});

describe('isAgentV3PaidPublicEnabled — money-path master switch (default OFF)', () => {
  it('is OFF until the admin explicitly says yes — in any spelling', () => {
    // CONTRACT CHANGED DELIBERATELY (audit finding #1, 2026-08-09): rejecting `1`/`on` was the
    // DEFECT, not a safeguard — the admin's habit is `on`, so a money gate written that way was
    // silently OFF. An explicit YES is still required; only the spellings widened.
    delete process.env.AGENTV3_PAID_PUBLIC;
    expect(isAgentV3PaidPublicEnabled()).toBe(false);
    process.env.AGENTV3_PAID_PUBLIC = 'false';
    expect(isAgentV3PaidPublicEnabled()).toBe(false);
    for (const v of ['1', 'on', 'true', 'TRUE']) {
      process.env.AGENTV3_PAID_PUBLIC = v;
      expect(isAgentV3PaidPublicEnabled(), v).toBe(true);
    }
  });
});

describe('isAgentV3CreditGateEnabled — decoupled ₹0-balance gate (default OFF)', () => {
  it('is OFF until the admin explicitly says yes (see the note above)', () => {
    delete process.env.AGENTV3_CREDIT_GATE;
    expect(isAgentV3CreditGateEnabled()).toBe(false);
    process.env.AGENTV3_CREDIT_GATE = 'false';
    expect(isAgentV3CreditGateEnabled()).toBe(false);
    process.env.AGENTV3_CREDIT_GATE = '1';
    expect(isAgentV3CreditGateEnabled()).toBe(true);
    process.env.AGENTV3_CREDIT_GATE = 'on';
    expect(isAgentV3CreditGateEnabled()).toBe(true);
    process.env.AGENTV3_CREDIT_GATE = 'true';
    expect(isAgentV3CreditGateEnabled()).toBe(true);
  });

  it('is INDEPENDENT of the paid-public switch (either flag can arm the gate)', () => {
    delete process.env.AGENTV3_PAID_PUBLIC;
    process.env.AGENTV3_CREDIT_GATE = 'true';
    // Credit gate on, paid-public off → gate armed without turning on paid-public.
    expect(isAgentV3CreditGateEnabled()).toBe(true);
    expect(isAgentV3PaidPublicEnabled()).toBe(false);
  });
});

describe('agentV3FreeList / isAgentV3FreeUser (paid-public FREE-list)', () => {
  it('BACKWARD-COMPAT: unset AGENTV3_FREE_LIST defaults to the current allowlist (today = the admins)', () => {
    delete process.env.AGENTV3_FREE_LIST;
    process.env.AGENTV3_ALLOWLIST = 'aashishcpmt09@gmail.com, doc.asheesh@icloud.com';
    expect(agentV3FreeList()).toEqual(['aashishcpmt09@gmail.com', 'doc.asheesh@icloud.com']);
    expect(isAgentV3FreeUser(null, 'AASHISHCPMT09@GMAIL.COM')).toBe(true); // email match, case-insensitive
    expect(isAgentV3FreeUser('some-uid', 'stranger@x.com')).toBe(false);
  });

  it('an explicit AGENTV3_FREE_LIST takes precedence over the allowlist (split ACCESS vs FREE)', () => {
    process.env.AGENTV3_ALLOWLIST = ''; // public access (everyone), but…
    process.env.AGENTV3_FREE_LIST = 'admin-uid-1, admin@navbharatai.in';
    expect(isAgentV3FreeUser('admin-uid-1', null)).toBe(true);   // uid match → free
    expect(isAgentV3FreeUser('paying-user', 'someone@else.com')).toBe(false); // a paying public user
    expect(isAgentV3FreeUser(null, 'ADMIN@NAVBHARATAI.IN')).toBe(true);
  });

  it('empty free-list AND empty allowlist → nobody is free (all paid)', () => {
    process.env.AGENTV3_FREE_LIST = '';
    process.env.AGENTV3_ALLOWLIST = '';
    expect(agentV3FreeList()).toEqual([]);
    expect(isAgentV3FreeUser('anyone', 'any@one.com')).toBe(false);
  });

  it('never matches on empty/blank identity (no accidental free access)', () => {
    process.env.AGENTV3_FREE_LIST = 'real@admin.com';
    expect(isAgentV3FreeUser(null, null)).toBe(false);
    expect(isAgentV3FreeUser('', '')).toBe(false);
  });
});

describe('buildRequiresSignIn — Phase 1.3 bill-or-refuse (anon paid build is refused, Fix 26 preserved)', () => {
  it('a VERIFIED user is always allowed to build (never refused)', () => {
    process.env.AGENTV3_ALLOWLIST = 'admin@x.com';
    expect(buildRequiresSignIn('any-verified-uid', null)).toBe(false);
    process.env.AGENTV3_ALLOWLIST = ''; // even in the public/empty-allowlist future
    expect(buildRequiresSignIn('paying-user-uid', 'someone@else.com')).toBe(false);
  });

  it('FIX 26 preserved: a token-blip of an allowlisted identity (no uid, claimed email matches) is allowed', () => {
    process.env.AGENTV3_ALLOWLIST = 'aashishcpmt09@gmail.com, doc.asheesh@icloud.com';
    expect(buildRequiresSignIn(null, 'DOC.ASHEESH@ICLOUD.COM')).toBe(false); // case-insensitive email match
  });

  it('THE BLEED: a genuinely anonymous caller is REFUSED — including the public empty-allowlist future', () => {
    process.env.AGENTV3_ALLOWLIST = 'admin@x.com';
    expect(buildRequiresSignIn(null, null)).toBe(true);              // no uid, no email
    expect(buildRequiresSignIn(null, 'stranger@nowhere.com')).toBe(true); // email not on the allowlist
    process.env.AGENTV3_ALLOWLIST = ''; // public: empty allowlist matches nobody → anon refused
    expect(buildRequiresSignIn(null, 'drive-by@public.com')).toBe(true);
    expect(buildRequiresSignIn(null, null)).toBe(true);
  });
});

describe('costRoutingEnabled / costRoutingActiveFor — the Slice-G ONE master switch (+ canary)', () => {
  it('is OFF by default and only "on"/"true" turn it on (a typo stays a safe no-op)', () => {
    delete process.env.AGENTV3_COST_ROUTING;
    expect(costRoutingEnabled()).toBe(false);
    process.env.AGENTV3_COST_ROUTING = 'glm'; // stray value → OFF, never a silent enable
    expect(costRoutingEnabled()).toBe(false);
    process.env.AGENTV3_COST_ROUTING = 'on';
    expect(costRoutingEnabled()).toBe(true);
    process.env.AGENTV3_COST_ROUTING = 'TRUE';
    expect(costRoutingEnabled()).toBe(true);
  });

  it('master OFF ⇒ nobody is in the regime, regardless of the canary list', () => {
    delete process.env.AGENTV3_COST_ROUTING;
    process.env.AGENTV3_COST_ROUTING_USERS = 'tester@x.com';
    expect(costRoutingActiveFor('uid1', 'tester@x.com')).toBe(false);
  });

  it('master ON + EMPTY canary ⇒ everyone is in the regime', () => {
    process.env.AGENTV3_COST_ROUTING = 'on';
    delete process.env.AGENTV3_COST_ROUTING_USERS;
    expect(costRoutingActiveFor('any-uid', 'anyone@x.com')).toBe(true);
    expect(costRoutingActiveFor(null, null)).toBe(true);
  });

  it('master ON + canary list ⇒ ONLY the listed uid/email (case-insensitive email)', () => {
    process.env.AGENTV3_COST_ROUTING = 'on';
    process.env.AGENTV3_COST_ROUTING_USERS = 'uid-42, Tester@X.com';
    expect(costRoutingActiveFor('uid-42', null)).toBe(true);
    expect(costRoutingActiveFor(null, 'tester@x.com')).toBe(true); // case-insensitive
    expect(costRoutingActiveFor('other-uid', 'other@x.com')).toBe(false);
  });
});
