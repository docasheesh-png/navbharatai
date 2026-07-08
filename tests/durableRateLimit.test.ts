import { describe, it, expect } from 'vitest';
import { windowKey, decideRate, consumeDurableRate } from '../src/server/lib/DurableRateLimit';

// SECURITY Phase 1.4 — durable, cross-instance rate limiting. The in-memory limiter reset on every
// Cloud Run cold start (per-instance), so limits didn't actually hold; this durable layer makes them
// real. Firestore is unreachable under VITEST, so the consume path is verified as bounded/fail-open;
// the window + decision logic (the correctness core) is verified purely.

describe('windowKey — deterministic per-window bucket id (rolls over automatically)', () => {
  const HOUR = 3_600_000;
  it('same window → same id; next window → different id (fixed wall-clock buckets)', () => {
    // Buckets are absolute floor(now/windowMs): bucket 0 is [0, HOUR), bucket 1 is [HOUR, 2·HOUR).
    const a = windowKey('build', 'user-1', 0, HOUR);
    const b = windowKey('build', 'user-1', HOUR - 1, HOUR); // still bucket 0
    const c = windowKey('build', 'user-1', HOUR, HOUR);     // rolls into bucket 1
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('different name or key → different bucket (limiters never share a counter)', () => {
    expect(windowKey('build', 'u1', 0, HOUR)).not.toBe(windowKey('workspace', 'u1', 0, HOUR));
    expect(windowKey('build', 'u1', 0, HOUR)).not.toBe(windowKey('build', 'u2', 0, HOUR));
  });
  it('sanitizes unsafe characters (IPs, path metacharacters) into a safe doc id', () => {
    const k = windowKey('build', '203.0.113.7/../etc', 0, HOUR);
    expect(k).not.toMatch(/[^A-Za-z0-9_-]/); // Firestore-safe id, no traversal
  });
  it('the GLOBAL anon bucket is a single shared id for a window (platform-wide ceiling)', () => {
    const g1 = windowKey('build', 'GLOBAL_ANON', 5_000, HOUR);
    const g2 = windowKey('build', 'GLOBAL_ANON', 9_999, HOUR);
    expect(g1).toBe(g2); // every anon caller in the window shares ONE ceiling counter
  });
});

describe('decideRate — allow while the pre-increment count is below the limit', () => {
  it('allows below the limit, blocks at/above it', () => {
    expect(decideRate(0, 5)).toBe(true);
    expect(decideRate(4, 5)).toBe(true);
    expect(decideRate(5, 5)).toBe(false); // the 6th request in a 5/window limit is denied
    expect(decideRate(9, 5)).toBe(false);
  });
});

describe('consumeDurableRate — VITEST-skipped, bounded, FAIL-OPEN (never blocks on infra)', () => {
  it('fails open (allowed) with no reachable Firestore, and never throws', async () => {
    await expect(consumeDurableRate('build', 'user-1', 5, 3_600_000, 1_000_000)).resolves.toEqual({ allowed: true, used: 0, limit: 5 });
  });
  it('is inert for a non-positive limit / empty key (no accidental block)', async () => {
    await expect(consumeDurableRate('build', 'user-1', 0, 3_600_000, 0)).resolves.toMatchObject({ allowed: true });
    await expect(consumeDurableRate('build', '', 5, 3_600_000, 0)).resolves.toMatchObject({ allowed: true });
  });
});
