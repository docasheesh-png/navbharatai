import { describe, it, expect } from 'vitest';
import { resolveGithubConnectionForUser } from './githubConnection';

describe('resolveGithubConnectionForUser — GitHub connection is per NavBharatAI user', () => {
  it('keeps a token owned by the current user (no change)', () => {
    const r = resolveGithubConnectionForUser('userA', 'tok-A', 'userA');
    expect(r).toEqual({ token: 'tok-A', ownerUid: 'userA', changed: false, reason: 'kept' });
  });

  it('CLEARS a token owned by a DIFFERENT user (the reported leak)', () => {
    const r = resolveGithubConnectionForUser('userB', 'tok-A', 'userA');
    expect(r.token).toBeNull();
    expect(r.ownerUid).toBeNull();
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('cleared-different-user');
  });

  it('claims an unowned (legacy / just-picked-up) token for the current user', () => {
    const r = resolveGithubConnectionForUser('userA', 'tok-legacy', '');
    expect(r).toEqual({ token: 'tok-legacy', ownerUid: 'userA', changed: true, reason: 'claimed' });
    // null owner behaves the same as empty.
    expect(resolveGithubConnectionForUser('userA', 'tok-legacy', null).reason).toBe('claimed');
  });

  it('is a no-op when there is no token', () => {
    const r = resolveGithubConnectionForUser('userA', null, null);
    expect(r).toEqual({ token: null, ownerUid: null, changed: false, reason: 'none' });
    expect(resolveGithubConnectionForUser('userA', '', 'userA').reason).toBe('none');
  });

  it('a different user never inherits — end-to-end: A connects, B signs in, B is clean', () => {
    // A connects GitHub → owner stamped as A.
    const afterA = resolveGithubConnectionForUser('userA', 'tok-A', '');
    expect(afterA.token).toBe('tok-A');
    expect(afterA.ownerUid).toBe('userA');
    // B signs in on the same browser with A's token still present → cleared.
    const forB = resolveGithubConnectionForUser('userB', 'tok-A', afterA.ownerUid);
    expect(forB.token).toBeNull();
    expect(forB.reason).toBe('cleared-different-user');
  });
});
