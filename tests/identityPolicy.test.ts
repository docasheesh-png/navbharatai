import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  moneyGate,
  requireVerifiedForMoney,
  verifiedIdentity,
  anonCapabilityOk,
  listableBy,
  SESSION_ID_RE,
  ANON_WORKSPACE_PREFIX,
} from '../src/server/lib/identityPolicy';

// Security Master Plan Phase 0 — THE two-tier identity law, locked by tests before any route
// wires to it. Tier 1: money/quota/cross-user data → verified identity ONLY (claims are nothing).
// Tier 2: anon artifacts → only the exact unguessable sessionId capability, never enumeration.

function fakeReq(headers: Record<string, string> = {}, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}): Request {
  return { headers, body, query } as unknown as Request;
}

describe('Tier 1 — moneyGate: money/quota/billing surfaces take a VERIFIED identity or refuse', () => {
  it('refuses with 401 when there is no verified identity (never "degrade and spend")', () => {
    const r = moneyGate(null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/sign in/i);
    }
  });
  it('refuses an empty uid (a hollow identity is no identity)', () => {
    expect(moneyGate({ uid: '', email: null }).ok).toBe(false);
  });
  it('passes a verified caller through with uid + email', () => {
    const r = moneyGate({ uid: 'user-1', email: 'a@b.c' });
    expect(r).toEqual({ ok: true, uid: 'user-1', email: 'a@b.c' });
  });
});

describe('Tier 1 — verifiedIdentity: a claimed userId is NEVER identity', () => {
  it('THE EXPLOIT SCENARIO: a spoofed body/query userId with no token resolves to null → money gate refuses', async () => {
    const req = fakeReq({}, { userId: 'victim-uid' }, { userId: 'victim-uid' });
    expect(await verifiedIdentity(req)).toBeNull();
    const gate = await requireVerifiedForMoney(req);
    expect(gate.ok).toBe(false);
  });
  it('test seam: an explicit x-test-verified-uid header simulates a verified caller (opt-in, like a real token)', async () => {
    const req = fakeReq({ 'x-test-verified-uid': 'user-9', 'x-test-verified-email': 'u9@x.io' });
    expect(await verifiedIdentity(req)).toEqual({ uid: 'user-9', email: 'u9@x.io' });
    const gate = await requireVerifiedForMoney(req);
    expect(gate).toMatchObject({ ok: true, uid: 'user-9' });
  });
});

describe('Tier 2 — anonCapabilityOk: anon data only via the EXACT unguessable sessionId', () => {
  const sid = 'e361e8bb-session-1';
  const ws = `${ANON_WORKSPACE_PREFIX}${sid}`;

  it('grants access when the full exact sessionId is presented', () => {
    expect(anonCapabilityOk(ws, sid)).toBe(true);
  });
  it('denies a missing / empty / wrong / prefix-only proof', () => {
    expect(anonCapabilityOk(ws, null)).toBe(false);
    expect(anonCapabilityOk(ws, undefined)).toBe(false);
    expect(anonCapabilityOk(ws, '')).toBe(false);
    expect(anonCapabilityOk(ws, 'someone-elses-sid')).toBe(false);
    expect(anonCapabilityOk(ws, sid.slice(0, 8))).toBe(false); // guessing a prefix grants nothing
  });
  it('never applies to real-user workspaces (those are uid-gated, not capability-gated)', () => {
    expect(anonCapabilityOk(`agentv3-user-1-${sid}`, sid)).toBe(false);
  });
  it('rejects malformed anon workspace ids (an id that could not have been minted by us)', () => {
    expect(anonCapabilityOk(`${ANON_WORKSPACE_PREFIX}`, '')).toBe(false);
    expect(anonCapabilityOk(`${ANON_WORKSPACE_PREFIX}../etc`, '../etc')).toBe(false); // fails SESSION_ID_RE
  });
});

describe('Tier 2 corollary — listableBy: anon artifacts are NEVER enumerable', () => {
  it('anon-owned artifacts never list, for anyone (capability-only access)', () => {
    expect(listableBy('anon', 'user-1')).toBe(false);
    expect(listableBy('anon', null)).toBe(false);
    expect(listableBy(null, 'user-1')).toBe(false);
  });
  it('a real artifact lists only for its verified owner', () => {
    expect(listableBy('user-1', 'user-1')).toBe(true);
    expect(listableBy('user-1', 'user-2')).toBe(false);
    expect(listableBy('user-1', null)).toBe(false); // no verified identity → no listing
  });
});

describe('SESSION_ID_RE — the single session-token shape', () => {
  it('accepts our real id shapes and rejects injection-shaped strings', () => {
    expect(SESSION_ID_RE.test('pro-1751900000000')).toBe(true);
    expect(SESSION_ID_RE.test('e361e8bb-1a2b-4c3d')).toBe(true);
    expect(SESSION_ID_RE.test('ab')).toBe(false);           // too short to be unguessable
    expect(SESSION_ID_RE.test('a/../../etc')).toBe(false);  // path metacharacters
    expect(SESSION_ID_RE.test('a b c')).toBe(false);        // spaces
    expect(SESSION_ID_RE.test('x'.repeat(65))).toBe(false); // unbounded
  });
});
