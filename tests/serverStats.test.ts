import { describe, it, expect } from 'vitest';
import { serverStats, defaultServerStats } from '../src/server/lib/serverStats';

/**
 * ORDER-DEPENDENT BY CONSTRUCTION, until now (found by a shuffled run, 2026-08-06).
 *
 * `serverStats` is a process-wide MUTABLE singleton that routes legitimately write to — `totalHits`
 * climbs on every request. Asserting `serverStats.totalHits === 0` was therefore asserting a fact about
 * global state at an arbitrary moment, true only while this file happened to run before anything that
 * made a request. Under a shuffled file order it failed — intermittently, in a suite of 12,000, where
 * the cause looks like anything except "another file made a request". This file's own last test even
 * increments it, so the ordering was load-bearing WITHIN the file too.
 *
 * The DEFAULTS are a fact about the shape and are asserted on a fresh object; the SINGLETON is asserted
 * only for the things that stay true however much traffic it has seen.
 */
describe('defaultServerStats — the documented defaults', () => {
  it('starts every counter at zero', () => {
    const s = defaultServerStats();
    expect(s.totalHits).toBe(0);
    expect(s.failedLogins).toBe(0);
    expect(s.failedLoginIPs).toEqual([]);
    expect(s.dailyHits.size).toBe(0);
    expect(s.announcements).toEqual([]);
  });

  it('🔒 carries no control that nothing enforces (audit 2026-10-11, F16)', () => {
    const d = defaultServerStats() as unknown as Record<string, unknown>;
    for (const gone of ['maintenanceMode', 'featureFlags', 'pricingConfig', 'providerEnabled']) expect(gone in d, gone).toBe(false);
  });

  it('hands each caller its OWN nested objects — a shared Map would recreate the coupling', () => {
    const a = defaultServerStats();
    const b = defaultServerStats();
    a.dailyHits.set('2026-08-06', 1);
    a.announcements.push({ id: '1', message: 'x', createdAt: 'now', target: 'all' });
    expect(b.dailyHits.size).toBe(0);
    expect(b.announcements).toEqual([]);
  });
});

describe('serverStats singleton — what stays true however much traffic it has seen', () => {
  it('starts FROM the defaults (same shape)', () => {
    expect(Object.keys(serverStats).sort()).toEqual(Object.keys(defaultServerStats()).sort());
  });

  it('is the SHARED mutable instance every route writes to', () => {
    const before = serverStats.totalHits;
    serverStats.totalHits += 1;
    expect(serverStats.totalHits).toBe(before + 1);
    serverStats.totalHits = before; // leave the process as we found it
  });
});
