import { describe, it, expect } from 'vitest';
import { needsRefresh, REFRESH_SKEW_MS } from './supabaseConnectionStore';

// Only the PURE boundary is unit-tested here; the Firestore paths are exercised by the route tests
// against a real emulator/no-op db. This is the piece where a subtle mistake is silently costly.
describe('needsRefresh — refreshing early is free, failing mid-request is not', () => {
  const NOW = 1_800_000_000_000;

  it('refreshes a token that is already expired', () => {
    expect(needsRefresh(NOW - 1, NOW)).toBe(true);
  });

  it('does NOT refresh a token with plenty of life left', () => {
    expect(needsRefresh(NOW + 60 * 60_000, NOW)).toBe(false);
  });

  it('refreshes INSIDE the skew window — the whole point of the skew', () => {
    // A token expiring in 4 seconds passes a naive `expiresAt > now` check and then dies mid-request,
    // surfacing to the user as a random failure on an operation that was actually fine.
    expect(needsRefresh(NOW + 4_000, NOW)).toBe(true);
  });

  it('treats the skew boundary itself as "refresh now"', () => {
    expect(needsRefresh(NOW + REFRESH_SKEW_MS, NOW)).toBe(true);
    expect(needsRefresh(NOW + REFRESH_SKEW_MS + 1, NOW)).toBe(false);
  });

  it('assumes stale when the expiry is unknown rather than gambling on it', () => {
    expect(needsRefresh(NaN, NOW)).toBe(true);
    expect(needsRefresh(Infinity, NOW)).toBe(true);
    expect(needsRefresh(undefined as unknown as number, NOW)).toBe(true);
  });

  it('honours a caller-supplied skew', () => {
    expect(needsRefresh(NOW + 30_000, NOW, 10_000)).toBe(false);
    expect(needsRefresh(NOW + 30_000, NOW, 45_000)).toBe(true);
  });
});
