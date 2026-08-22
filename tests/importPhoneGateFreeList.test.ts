import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { importBlockedForPhone } from '../src/server/lib/phoneGate';

/**
 * THE ADMIN LOCKED OUT OF THEIR OWN PRODUCT (2026-08-22).
 *
 * The import gate shipped without the free-list exemption that EVERY sibling gate in this codebase
 * has — the hosting-plan gate, the billing gate, the build gate all read `isAgentV3FreeUser` first.
 * This one did not, so the account that exists precisely to test the product was refused at its own
 * import and the day's work could not be verified at all.
 *
 * Two things are pinned here: the exemption itself, and the reason it was missed — a rule that has to
 * be remembered at each call site is a rule that will eventually be forgotten at one.
 */

const ADMIN_EMAIL = 'aashishcpmt09@gmail.com';
const noPhone = async () => ({ getUserByPhoneNumber: async () => null, getUser: async () => ({ phoneNumber: null }) });
const withPhone = async () => ({ getUserByPhoneNumber: async () => null, getUser: async () => ({ phoneNumber: '+919999999999' }) });

let saved: string | undefined;
beforeEach(() => { saved = process.env.AGENTV3_FREE_LIST; process.env.AGENTV3_FREE_LIST = ADMIN_EMAIL; });
afterEach(() => { if (saved === undefined) delete process.env.AGENTV3_FREE_LIST; else process.env.AGENTV3_FREE_LIST = saved; });

describe('importBlockedForPhone — the free list is checked, like every other gate', () => {
  it('🔒 a free-list account with NO verified number is NOT blocked', () => {
    // The exact lockout. Before the fix this returned true and the admin could not import at all.
    return expect(importBlockedForPhone({ uid: 'u1', email: ADMIN_EMAIL }, noPhone)).resolves.toBe(false);
  });

  it('🔒 the match is on EMAIL — a uid-only caller would silently never match', () => {
    // This is the subtle half. AGENTV3_FREE_LIST holds ADDRESSES, so a call site that resolves only a
    // uid fails to match and the account stays blocked — and "not on the list" looks exactly like
    // "we never checked the list properly". Both call sites therefore pass the verified identity.
    return expect(importBlockedForPhone({ uid: 'u1', email: null }, noPhone)).resolves.toBe(true);
  });

  it('an ordinary account with no verified number is still blocked — the rule still works', () => {
    return expect(importBlockedForPhone({ uid: 'u2', email: 'someone@example.com' }, noPhone)).resolves.toBe(true);
  });

  it('an ordinary account WITH a verified number passes', () => {
    return expect(importBlockedForPhone({ uid: 'u2', email: 'someone@example.com' }, withPhone)).resolves.toBe(false);
  });

  it('a signed-out caller is blocked', () => {
    return expect(importBlockedForPhone(null, noPhone)).resolves.toBe(true);
  });

  it('the kill switch still wins, and wins FIRST', async () => {
    // An operator turning the gate off must not be second-guessed by anything below it.
    expect(await importBlockedForPhone({ uid: 'u2', email: 'x@y.com' }, noPhone, { AGENTV3_IMPORT_REQUIRES_PHONE: 'off' } as never)).toBe(false);
  });

  it('🔒 a directory failure still fails CLOSED for a non-exempt account', async () => {
    // The asymmetry the module documents: a wrong "yes" lets an unverified account import; a wrong
    // "no" costs one OTP. The cheap mistake is the one to make — and the exemption must not weaken it.
    const boom = async () => { throw new Error('directory down'); };
    expect(await importBlockedForPhone({ uid: 'u2', email: 'x@y.com' }, boom as never)).toBe(true);
    // …but an exempt account never reaches the directory at all, so an outage cannot lock them out.
    expect(await importBlockedForPhone({ uid: 'u1', email: ADMIN_EMAIL }, boom as never)).toBe(false);
  });
});

describe('one decision point, so a third gate cannot forget the exemption', () => {
  const zip = readFileSync(join(__dirname, '..', 'src/server/routes/zipUpload.ts'), 'utf8');
  const build = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');

  it('both import gates go through the shared helper', () => {
    expect(zip).toContain('importBlockedForPhone(');
    expect(build).toContain('importBlockedForPhone(');
  });

  it('🔒 neither re-implements the check by hand', () => {
    // The original bug was two hand-rolled gates, both missing the exemption. If a future edit
    // inlines `hasVerifiedPhoneWith` at a route again, it will have re-created exactly that hole.
    expect(zip).not.toContain('hasVerifiedPhoneWith(');
    expect(build).not.toContain('hasVerifiedPhoneWith(');
  });

  it('both pass the verified IDENTITY, not a bare uid', () => {
    expect(zip).toContain('importBlockedForPhone(await verifyFirebaseIdentity(req)');
    expect(build).toContain('importBlockedForPhone(await verifyFirebaseIdentity(req)');
  });
});
