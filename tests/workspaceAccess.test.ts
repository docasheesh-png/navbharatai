import { describe, it, expect } from 'vitest';
import { resolveWorkspaceAccess } from '../src/server/lib/WorkspaceAccess';

/** P-COLLAB.2 — pure workspace-access decision (owner / member / anonymous / denied). */

describe('resolveWorkspaceAccess', () => {
  it('the owner always passes (regardless of membership)', () => {
    expect(resolveWorkspaceAccess({ requesterUid: 'o1', ownerId: 'o1', isMember: false })).toBe('owner');
    expect(resolveWorkspaceAccess({ requesterUid: 'o1', ownerId: 'o1', isMember: true })).toBe('owner');
  });

  it('an active team member of the owner passes', () => {
    expect(resolveWorkspaceAccess({ requesterUid: 'u2', ownerId: 'o1', isMember: true })).toBe('member');
  });

  it('a different, non-member authenticated user is denied', () => {
    expect(resolveWorkspaceAccess({ requesterUid: 'stranger', ownerId: 'o1', isMember: false })).toBe('denied');
  });

  it('no uid is anonymous (the middleware rejects it on auth-required routes)', () => {
    expect(resolveWorkspaceAccess({ requesterUid: null, ownerId: 'o1', isMember: false })).toBe('anonymous');
    expect(resolveWorkspaceAccess({ requesterUid: undefined, ownerId: 'o1', isMember: true })).toBe('anonymous');
  });

  it('is purely additive over owner-only: it never denies the owner and only ADDS member access', () => {
    // For any owner, access is granted no matter what — never a regression vs requireUserMatch.
    for (const isMember of [true, false]) {
      expect(resolveWorkspaceAccess({ requesterUid: 'owner', ownerId: 'owner', isMember })).toBe('owner');
    }
    // A non-owner who is NOT a member is denied — exactly the old behaviour (no new exposure).
    expect(resolveWorkspaceAccess({ requesterUid: 'x', ownerId: 'owner', isMember: false })).toBe('denied');
  });
});
