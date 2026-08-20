import { describe, it, expect } from 'vitest';
import {
  stashPendingConnection, claimPendingConnection, PENDING_CONNECTION_TTL_MS, nonceFromState,
} from './supabaseIntegration';

/**
 * REGRESSION (admin 2026-08-20): "supabase login connect ke baad wapas wahi aa jata hai" — the OAuth
 * callback demanded a Bearer token on a top-level browser NAVIGATION, which never carries one, so
 * every consent for every user failed with "sign in as the same account". The fix stashes the
 * exchanged tokens at the callback and lets the OPENER claim them over an authenticated fetch.
 * These tests lock the claim's security properties, which are what justified the old (impossible)
 * check: only the account that began the flow can claim, exactly once, within the TTL.
 */
const payload = (n: number) => ({
  accessToken: `at-${n}`, refreshToken: `rt-${n}`, expiresAtMs: 9e12,
  orgId: 'org-1', orgName: 'My Org', connectedAtMs: 0,
});

describe('pending Supabase connection claim', () => {
  it('the account that began the flow claims it and gets the exchanged tokens', () => {
    stashPendingConnection('nonce-a', 'uid-1', payload(1), 'My Org', 1000);
    const hit = claimPendingConnection('nonce-a', 'uid-1', 2000);
    expect(hit?.payload.accessToken).toBe('at-1');
    expect(hit?.orgName).toBe('My Org');
  });

  it('single use — a second claim gets nothing', () => {
    stashPendingConnection('nonce-b', 'uid-1', payload(2), 'My Org', 1000);
    expect(claimPendingConnection('nonce-b', 'uid-1', 2000)).not.toBeNull();
    expect(claimPendingConnection('nonce-b', 'uid-1', 2001)).toBeNull();
  });

  it('a DIFFERENT account cannot claim it — and the failed attempt consumes the entry', () => {
    stashPendingConnection('nonce-c', 'uid-1', payload(3), 'My Org', 1000);
    expect(claimPendingConnection('nonce-c', 'uid-ATTACKER', 2000)).toBeNull();
    // A value that failed an ownership check must not stay claimable afterwards.
    expect(claimPendingConnection('nonce-c', 'uid-1', 2001)).toBeNull();
  });

  it('an empty uid never claims anything', () => {
    stashPendingConnection('nonce-d', 'uid-1', payload(4), 'My Org', 1000);
    expect(claimPendingConnection('nonce-d', '', 2000)).toBeNull();
  });

  it('expires after the TTL', () => {
    stashPendingConnection('nonce-e', 'uid-1', payload(5), 'My Org', 1000);
    expect(claimPendingConnection('nonce-e', 'uid-1', 1000 + PENDING_CONNECTION_TTL_MS + 1)).toBeNull();
  });

  it('an unknown nonce yields nothing', () => {
    expect(claimPendingConnection('never-stashed', 'uid-1', 1000)).toBeNull();
  });

  it('nonceFromState reads the third dot-segment of a well-formed state (the completion key)', () => {
    expect(nonceFromState('v1.uid.abc123.sig')).toBe('abc123');
    expect(nonceFromState('garbage')).toBe('');
  });
});
