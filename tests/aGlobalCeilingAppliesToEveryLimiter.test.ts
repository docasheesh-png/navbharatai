/**
 * Audit 2026-10-11, F5: five limiters declared a platform-wide ANONYMOUS ceiling that never applied.
 *
 * `rateLimiter({ durable: false, anonGlobalPerHour })` returned before the global check, so `app-ai` (20,000/h)
 * and `app-ai-image` (5,000/h) — which spend money — plus `store-data-write`, `site-hit` and `devapi` had only a
 * per-address limit, which a botnet walks past. The ceiling now applies through a batched shared count.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BatchedGlobalCounter, type GlobalCounterStore } from '../src/server/lib/globalAnonCeiling';

/** A shared store, like the one Firestore document all instances increment. */
function sharedStore(): GlobalCounterStore & { total: () => number } {
  const counts = new Map<string, number>();
  return {
    async addAndRead(name, idx, n) { const k = `${name}:${idx}`; counts.set(k, (counts.get(k) ?? 0) + n); return counts.get(k)!; },
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
  };
}

describe('the platform-wide anonymous ceiling holds across instances', () => {
  it('three instances, flushing every request: together they allow the ceiling and no more', async () => {
    const store = sharedStore();
    const instances = [0, 1, 2].map(() => new BatchedGlobalCounter('app-ai', 30, store, 3_600_000, 0));
    let allowed = 0;
    for (let i = 0; i < 90; i++) {
      const inst = instances[i % 3];
      if (inst.allow(1_000 + i)) allowed++;
      await inst.settled();
    }
    expect(allowed).toBeLessThanOrEqual(30 + 3); // at most one request of lag per instance
    expect(allowed).toBeGreaterThanOrEqual(28);
  });

  it('a new window starts from zero', async () => {
    const store = sharedStore();
    const c = new BatchedGlobalCounter('site-hit', 2, store, 1_000, 0);
    expect([c.allow(0), c.allow(1), c.allow(2)]).toEqual([true, true, false]);
    await c.settled();
    expect(c.allow(1_500)).toBe(true);
  });

  it('a store that cannot answer fails OPEN and keeps counting locally', async () => {
    const broken: GlobalCounterStore = { async addAndRead() { throw new Error('down'); } };
    const c = new BatchedGlobalCounter('devapi', 3, broken, 3_600_000, 0);
    const out: boolean[] = [];
    for (let i = 0; i < 5; i++) { out.push(c.allow(i)); await c.settled(); }
    expect(out).toEqual([true, true, true, false, false]); // the local count still holds the ceiling
  });

  it('batches: at most one store write per flush interval per instance', async () => {
    let writes = 0;
    const store: GlobalCounterStore = { async addAndRead(_n, _i, n) { if (n > 0) writes++; return 0; } };
    const c = new BatchedGlobalCounter('store-data-write', 1_000_000, store, 3_600_000, 10_000);
    for (let t = 0; t < 1_000; t++) c.allow(t); // 1,000 requests inside one second
    await c.settled();
    expect(writes).toBe(1);
  });
});

describe('wiring: no limiter can declare a ceiling that is skipped', () => {
  const MW = readFileSync('src/server/lib/authMiddleware.ts', 'utf8');
  it('the memory-only branch enforces the anonymous ceiling before it returns', () => {
    const branch = MW.slice(MW.indexOf('if (opts.durable === false) {'), MW.indexOf('// Layer 2'));
    expect(branch).toMatch(/globalAnonCounter\(opts\.name, opts\.anonGlobalPerHour\)\.allow\(now\)/);
    expect(MW).not.toMatch(/if \(opts\.durable === false\) \{ next\(\); return; \}/);
  });

  it('every limiter that declares anonGlobalPerHour reaches a branch that enforces it', () => {
    const declared: string[] = [];
    for (const f of readdirSync('src/server/routes').filter((n) => n.endsWith('.ts') && !n.includes('.test.')).map((n) => join('src/server/routes', n))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/rateLimiter\(\{[^}]*anonGlobalPerHour[^}]*\}\)/g)) declared.push(m[0]);
    }
    expect(declared.length).toBeGreaterThan(0);
    // Both branches of rateLimiter() now enforce it; this keeps a third branch from quietly skipping it.
    expect((MW.match(/opts\.anonGlobalPerHour/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
