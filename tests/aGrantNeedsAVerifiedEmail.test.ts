// Q-624 (forensic audit 2026-10-04; admin 2026-10-05: option A) — an email grants nothing until the
// provider has VERIFIED it.
//
// The free list, the cost-routing canary, the sign-in exemption, the store admins and the report admins
// all match an email. Email/password sign-up sends no verification here, so anyone could register a listed
// address nobody had used yet (an admin's work address, a tester's) and inherit free builds, admin views
// and the store review queue. The fix is a TYPE: every grant takes a `GrantEmail`, which only `grantEmail`
// can produce, and it returns null for an unverified address. These tests lock the behaviour and the
// census that keeps a new call site from minting the brand some other way.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  grantEmail, identityGrantEmail, isAgentV3FreeUser, costRoutingActiveFor, buildRequiresSignIn,
  freeListLabelForStoredEmail,
} from '../src/server/AgentV3/featureFlag';
import { resolveGrantEmailWith } from '../src/server/lib/authMiddleware';
import { isAdminEmail } from '../src/server/lib/adminEmails';
import { moneyGate } from '../src/server/lib/identityPolicy';

const LISTED = 'listed.person@example.com';
const saved: Record<string, string | undefined> = {};
const KEYS = ['AGENTV3_FREE_LIST', 'AGENTV3_ALLOWLIST', 'AGENTV3_COST_ROUTING', 'AGENTV3_COST_ROUTING_USERS', 'AGENTV3_REPORT_ADMINS', 'NAV_STORE_ADMINS'];
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.AGENTV3_FREE_LIST = LISTED;
  process.env.AGENTV3_ALLOWLIST = LISTED;
  process.env.AGENTV3_COST_ROUTING = 'true';
  process.env.AGENTV3_COST_ROUTING_USERS = LISTED;
  process.env.AGENTV3_REPORT_ADMINS = LISTED;
  process.env.NAV_STORE_ADMINS = LISTED;
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

const unverified = { uid: 'attacker', email: LISTED, emailVerified: false };
const verified = { uid: 'owner', email: LISTED, emailVerified: true };

describe('a listed address that the provider has NOT verified grants nothing', () => {
  it('free list, canary, sign-in exemption and report admin all refuse it', () => {
    const g = identityGrantEmail(unverified);
    expect(g).toBeNull();
    expect(isAgentV3FreeUser(unverified.uid, g)).toBe(false);
    expect(costRoutingActiveFor(unverified.uid, g)).toBe(false);
    expect(buildRequiresSignIn(null, g)).toBe(true);
    expect(isAdminEmail(g)).toBe(false);
  });

  it('a missing verification flag is "not verified", never "probably fine"', () => {
    expect(identityGrantEmail({ email: LISTED })).toBeNull();
    expect(grantEmail(LISTED, undefined)).toBeNull();
  });

  it('the same address, verified, grants exactly what it did before', () => {
    const g = identityGrantEmail(verified);
    expect(g).toBe(LISTED);
    expect(isAgentV3FreeUser(verified.uid, g)).toBe(true);
    expect(costRoutingActiveFor(verified.uid, g)).toBe(true);
    expect(buildRequiresSignIn(null, g)).toBe(false);
    expect(isAdminEmail(g)).toBe(true);
  });

  it('the money gate carries the verification flag through, so routes behind it can decide', () => {
    const r = moneyGate(unverified);
    expect(r.ok && identityGrantEmail(r)).toBeNull();
    const ok = moneyGate(verified);
    expect(ok.ok && identityGrantEmail(ok)).toBe(LISTED);
  });
});

describe('the account lookup (token without an email claim) honours the user record', () => {
  const authWith = (u: { email?: string | null; emailVerified?: boolean }) => async () => ({ getUser: async () => u });
  it('an unverified account address is not a grant', async () => {
    expect(await resolveGrantEmailWith('u', authWith({ email: LISTED, emailVerified: false }))).toBeNull();
    expect(await resolveGrantEmailWith('u', authWith({ email: LISTED }))).toBeNull();
  });
  it('a verified account address is', async () => {
    expect(await resolveGrantEmailWith('u', authWith({ email: LISTED, emailVerified: true }))).toBe(LISTED);
  });
  it('a lookup that fails grants nothing', async () => {
    expect(await resolveGrantEmailWith('u', async () => { throw new Error('down'); })).toBeNull();
  });
});

describe('the costly-AI account (images, chat images, screenshot-to-prompt) carries only a verified address', () => {
  it('requireAccountForCostlyAi drops an unverified address', async () => {
    vi.resetModules();
    vi.doMock('../src/server/lib/authMiddleware', async (orig) => ({
      ...(await orig<typeof import('../src/server/lib/authMiddleware')>()),
      verifyFirebaseIdentity: async () => ({ uid: 'attacker', email: LISTED, emailVerified: false }),
    }));
    const { requireAccountForCostlyAi } = await import('../src/server/lib/costlyAiAccess');
    const account = await requireAccountForCostlyAi({ headers: {} } as never, 'image generation');
    expect(account.ok).toBe(true);
    if (account.ok) expect(account.email).toBeNull();
    vi.doUnmock('../src/server/lib/authMiddleware');
  });
});

describe('census: the brand has one mint and the label has one reader', () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(n) && !/\.test\./.test(n)) files.push(p); } };
  walk('src/server');
  const code = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

  it('only featureFlag.ts turns a string into a GrantEmail', () => {
    const minting = files.filter((f) => /as\s+GrantEmail\b|<GrantEmail>/.test(code(f)));
    expect(minting).toEqual(['src/server/AgentV3/featureFlag.ts']);
  });

  it('the stored-email free-list LABEL is read by the admin lists only', () => {
    const readers = files.filter((f) => !f.endsWith('featureFlag.ts') && code(f).includes('freeListLabelForStoredEmail('));
    expect(readers).toEqual(['src/server/routes/admin.ts']);
    expect(freeListLabelForStoredEmail(null, LISTED)).toBe(true); // a label still shows the listed row
  });

  it('the token verifier reports the provider\'s email_verified claim', () => {
    expect(code('src/server/lib/authMiddleware.ts')).toMatch(/emailVerified: decoded\.email_verified === true/);
  });
});
