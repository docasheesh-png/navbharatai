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

  it('is not in maintenance mode', () => {
    expect(defaultServerStats().maintenanceMode).toBe(false);
  });

  it('has doctorAI and appBuilder enabled', () => {
    expect(defaultServerStats().featureFlags.doctorAI).toBe(true);
    expect(defaultServerStats().featureFlags.appBuilder).toBe(true);
  });

  it('prices 100 coins per rupee', () => {
    expect(defaultServerStats().pricingConfig.coinsPerRupee).toBe(100);
  });

  it('enables every provider', () => {
    const p = defaultServerStats().providerEnabled;
    expect(p.gemini).toBe(true);
    expect(p.anthropic).toBe(true);
    expect(p.grok).toBe(true);
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
  it('starts FROM the defaults (same shape, same config)', () => {
    const d = defaultServerStats();
    expect(serverStats.featureFlags).toEqual(d.featureFlags);
    expect(serverStats.pricingConfig).toEqual(d.pricingConfig);
    expect(serverStats.providerEnabled).toEqual(d.providerEnabled);
  });

  it('is the SHARED mutable instance every route writes to', () => {
    const before = serverStats.totalHits;
    serverStats.totalHits += 1;
    expect(serverStats.totalHits).toBe(before + 1);
    serverStats.totalHits = before; // leave the process as we found it
  });
});
