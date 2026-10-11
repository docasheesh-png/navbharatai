import { describe, it, expect } from 'vitest';
import { windowKey, decideRate, consumeDurableRate, consumeWithStore, decideAfterIncrement, windowExpiry } from '../src/server/lib/DurableRateLimit';
import { readFileSync } from 'node:fs';

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

describe('audit 2026-10-11 (D9): a concurrent burst can never pass more than the limit', () => {
  // A store whose increment is atomic (as Firestore's `increment` is), with the read-back delayed so every
  // request's increment lands before any of them reads — the worst interleaving for the old read-then-write.
  function atomicStore() {
    let count = 0;
    const gate: Array<() => void> = [];
    return {
      store: { async incrementAndRead() { count += 1; await new Promise<void>((r) => gate.push(r)); return count; } },
      release: () => { while (gate.length) gate.shift()!(); },
    };
  }

  it('20 parallel requests against a limit of 10: at most 10 allowed', async () => {
    const { store, release } = atomicStore();
    const pending = Array.from({ length: 20 }, () => consumeWithStore(store, 10));
    await new Promise((r) => setTimeout(r, 0));
    release();
    const results = await Promise.all(pending);
    expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(10);
  });

  it('sequential requests: exactly the limit passes, the next is refused', async () => {
    let count = 0;
    const store = { async incrementAndRead() { count += 1; return count; } };
    const out: boolean[] = [];
    for (let i = 0; i < 4; i++) out.push((await consumeWithStore(store, 3)).allowed);
    expect(out).toEqual([true, true, true, false]);
  });

  it('a store error fails OPEN, never blocking a real request', async () => {
    const store = { async incrementAndRead(): Promise<number> { throw new Error('unavailable'); } };
    expect((await consumeWithStore(store, 1)).allowed).toBe(true);
  });

  it('counters expire a day after their window, so a TTL policy can delete them', () => {
    expect(windowExpiry(0, 3_600_000).getTime()).toBe(3_600_000 + 86_400_000);
    expect(windowExpiry(3_599_999, 3_600_000).getTime()).toBe(3_600_000 + 86_400_000);
    expect(decideAfterIncrement(10, 10)).toBe(true);
    expect(decideAfterIncrement(11, 10)).toBe(false);
  });

  it('the live path increments atomically and never writes a count it read', () => {
    const src = readFileSync('src/server/lib/DurableRateLimit.ts', 'utf8');
    expect(src).toMatch(/count: admin\.firestore\.FieldValue\.increment\(1\)/);
    expect(src).not.toMatch(/count: used \+ 1/);
  });
});
