import { describe, it, expect } from 'vitest';
import {
  normalizeInviteRole,
  buildInviteRecord,
  isInviteAcceptable,
  buildMemberRecord,
  canManageTeam,
  INVITE_TTL_MS,
  type MemberRecord,
} from '../src/server/lib/TeamStore';

/** P-COLLAB.1 — pure invite/member logic (roles, record building, acceptability). */

describe('normalizeInviteRole', () => {
  it('maps the UI capitalized roles and canonical roles', () => {
    expect(normalizeInviteRole('Admin')).toBe('admin');
    expect(normalizeInviteRole('Editor')).toBe('editor');
    expect(normalizeInviteRole('Viewer')).toBe('viewer');
    expect(normalizeInviteRole('editor')).toBe('editor');
  });
  it('defaults unknown/empty to the least-privileged viewer', () => {
    expect(normalizeInviteRole('')).toBe('viewer');
    expect(normalizeInviteRole(undefined)).toBe('viewer');
    expect(normalizeInviteRole('superuser')).toBe('viewer');
    expect(normalizeInviteRole(null)).toBe('viewer');
  });
  it('never grants owner via an invite (caps at admin)', () => {
    expect(normalizeInviteRole('owner')).toBe('admin');
    expect(normalizeInviteRole('Owner')).toBe('admin');
  });
  it('recognises the billing side-grant', () => {
    expect(normalizeInviteRole('billing')).toBe('billing_only');
    expect(normalizeInviteRole('billing_only')).toBe('billing_only');
  });
});

describe('buildInviteRecord', () => {
  it('normalises the email + role and sets a pending, expiring invite', () => {
    const rec = buildInviteRecord({
      token: 'tok123', teamId: 'ownerUid', email: '  Foo@Bar.COM ', role: 'Admin', invitedBy: 'ownerUid', now: 1000,
    });
    expect(rec.token).toBe('tok123');
    expect(rec.teamId).toBe('ownerUid');
    expect(rec.email).toBe('foo@bar.com');
    expect(rec.role).toBe('admin');
    expect(rec.status).toBe('pending');
    expect(rec.createdAt).toBe(1000);
    expect(rec.expiresAt).toBe(1000 + INVITE_TTL_MS);
  });
  it('honours a custom ttl and guards a bad clock', () => {
    const rec = buildInviteRecord({ token: 't', teamId: 'x', email: 'a@b.co', invitedBy: 'x', now: 500, ttlMs: 60000 });
    expect(rec.expiresAt).toBe(60500);
    const bad = buildInviteRecord({ token: 't', teamId: 'x', email: 'a@b.co', invitedBy: 'x', now: -5 });
    expect(bad.createdAt).toBe(0);
    expect(bad.role).toBe('viewer');
  });
});

describe('isInviteAcceptable', () => {
  const base = { status: 'pending' as const, expiresAt: 2000 };
  it('accepts a pending, unexpired invite', () => {
    expect(isInviteAcceptable(base, 1000)).toBe(true);
  });
  it('rejects an expired invite', () => {
    expect(isInviteAcceptable(base, 3000)).toBe(false);
  });
  it('rejects an already-accepted or revoked invite', () => {
    expect(isInviteAcceptable({ status: 'accepted', expiresAt: 9999 }, 1000)).toBe(false);
    expect(isInviteAcceptable({ status: 'revoked', expiresAt: 9999 }, 1000)).toBe(false);
  });
  it('rejects a null/undefined invite', () => {
    expect(isInviteAcceptable(null, 1000)).toBe(false);
    expect(isInviteAcceptable(undefined, 1000)).toBe(false);
  });
  it('treats a zero/absent expiry as non-expiring', () => {
    expect(isInviteAcceptable({ status: 'pending', expiresAt: 0 }, 9_999_999)).toBe(true);
  });
});

describe('buildMemberRecord', () => {
  it('builds an active member with a normalised email', () => {
    const m = buildMemberRecord({ uid: 'u1', email: 'X@Y.Z', role: 'editor', now: 42 });
    expect(m).toEqual({ uid: 'u1', email: 'x@y.z', role: 'editor', status: 'active', joinedAt: 42 });
  });
});

describe('canManageTeam (audit H2 — resource-scoped team management)', () => {
  const member = (uid: string, role: MemberRecord['role'], status: MemberRecord['status'] = 'active'): MemberRecord =>
    ({ uid, email: `${uid}@t.co`, role, status, joinedAt: 1 });

  it('the team owner (uid === teamId) always may — even with no member records', () => {
    expect(canManageTeam({ requesterUid: 'owner1', teamId: 'owner1', members: [] })).toBe(true);
  });

  it('an active ADMIN member of the team may', () => {
    const members = [member('admin1', 'admin'), member('ed1', 'editor')];
    expect(canManageTeam({ requesterUid: 'admin1', teamId: 'owner1', members })).toBe(true);
  });

  it('an editor or viewer member may NOT', () => {
    const members = [member('ed1', 'editor'), member('v1', 'viewer')];
    expect(canManageTeam({ requesterUid: 'ed1', teamId: 'owner1', members })).toBe(false);
    expect(canManageTeam({ requesterUid: 'v1', teamId: 'owner1', members })).toBe(false);
  });

  it('a removed admin may NOT (fail-closed on status)', () => {
    const members = [member('admin1', 'admin', 'removed')];
    expect(canManageTeam({ requesterUid: 'admin1', teamId: 'owner1', members })).toBe(false);
  });

  it('a stranger (not owner, not a member) may NOT manage another tenant’s team — the core H2 fix', () => {
    const members = [member('admin1', 'admin')];
    expect(canManageTeam({ requesterUid: 'attacker', teamId: 'owner1', members })).toBe(false);
  });

  it('fails closed on missing requesterUid / teamId', () => {
    expect(canManageTeam({ requesterUid: null, teamId: 'owner1', members: [] })).toBe(false);
    expect(canManageTeam({ requesterUid: 'u1', teamId: '', members: [] })).toBe(false);
    expect(canManageTeam({ requesterUid: undefined, teamId: '', members: [] })).toBe(false);
  });
});
