import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serviceHealth, healthHeadline } from './mcpHealth';
import { allowAfterCooldown, COOLDOWN_MAX_ENTRIES } from '../lib/callCooldown';

/**
 * "CONNECTED" IS NOT "WORKING".
 *
 * A connection is proven once and then trusted forever, so an expired key surfaced in the middle of a
 * build as a service that quietly contributed nothing. Everything here defends one property: the check
 * never says something is fine unless the service actually answered with tools.
 */

describe('serviceHealth', () => {
  it('a service that answered with tools is working, and says how many', () => {
    const h = serviceHealth({ id: 'notion', toolCount: 7 });
    expect(h.state).toBe('working');
    expect(h.message).toContain('7');
  });

  it('🔒 a failure carries the reason the service gave, not a generic line', () => {
    const h = serviceHealth({ id: 'linear', toolCount: 0, error: 'That service refused the key (401).' });
    expect(h.state).toBe('failing');
    expect(h.message).toBe('That service refused the key (401).');
  });

  it('🔒 answering with an EMPTY tool list is failing, not fine', () => {
    // It is unusable to a build either way, and "connected but contributes nothing" is the exact
    // silent state this check exists to end.
    const h = serviceHealth({ id: 'x', toolCount: 0 });
    expect(h.state).toBe('failing');
    expect(h.message).toMatch(/expired|no tools/i);
  });

  it('a nonsense tool count is never read as working', () => {
    expect(serviceHealth({ id: 'x', toolCount: NaN }).state).toBe('failing');
    expect(serviceHealth({ id: 'x', toolCount: -3 }).state).toBe('failing');
  });
});

describe('healthHeadline', () => {
  const ok = (id: string) => serviceHealth({ id, toolCount: 2 });
  const bad = (id: string) => serviceHealth({ id, toolCount: 0, error: 'gone' });

  it('nothing connected says so rather than claiming an all-clear', () => {
    expect(healthHeadline([])).toBe('Nothing to check.');
  });

  it('all working reads as all working', () => {
    expect(healthHeadline([ok('a'), ok('b')], 2)).toMatch(/All 2 .*working/);
    expect(healthHeadline([ok('a')], 1)).toMatch(/service is working/);
  });

  it('names how many are broken', () => {
    expect(healthHeadline([ok('a'), bad('b'), bad('c')], 3)).toMatch(/2 of 3 are not working/);
  });

  it('🔒 a partial check is never described as a whole one', () => {
    // Two of five answering is not "all your services are working" — that is the nearly-true claim
    // this codebase keeps rooting out.
    const line = healthHeadline([ok('a'), ok('b')], 5);
    expect(line).not.toMatch(/^All /);
    expect(line).toMatch(/3 could not be checked/);
  });

  it('a partial check with failures still names both numbers', () => {
    const line = healthHeadline([ok('a'), bad('b')], 4);
    expect(line).toMatch(/1 of 2 are not working/);
    expect(line).toMatch(/2 could not be checked/);
  });
});

describe('allowAfterCooldown — one implementation, two callers', () => {
  it('allows the first call and refuses an immediate second', () => {
    const s = new Map<string, number>();
    expect(allowAfterCooldown(s, 'w1', 1000, 5000)).toBe(true);
    expect(allowAfterCooldown(s, 'w1', 1000, 5000)).toBe(false);
    expect(allowAfterCooldown(s, 'w1', 5999, 5000)).toBe(false);
    expect(allowAfterCooldown(s, 'w1', 6000, 5000)).toBe(true);
  });

  it('🔒 a caller that has never called is not confused with one that called at time 0', () => {
    const s = new Map<string, number>();
    expect(allowAfterCooldown(s, 'fresh', 0, 5000)).toBe(true);
  });

  it('🔒 a REFUSED call does not extend the window', () => {
    const s = new Map<string, number>();
    expect(allowAfterCooldown(s, 'w1', 0, 5000)).toBe(true);
    for (let t = 1; t < 5000; t += 250) allowAfterCooldown(s, 'w1', t, 5000);
    expect(allowAfterCooldown(s, 'w1', 5000, 5000)).toBe(true);
  });

  it('is per key — one busy caller cannot block anybody else', () => {
    const s = new Map<string, number>();
    expect(allowAfterCooldown(s, 'w1', 0, 5000)).toBe(true);
    expect(allowAfterCooldown(s, 'w2', 0, 5000)).toBe(true);
  });

  it('cannot grow without limit', () => {
    const s = new Map<string, number>();
    for (let i = 0; i <= COOLDOWN_MAX_ENTRIES + 10; i++) allowAfterCooldown(s, `k${i}`, i, 5000);
    expect(s.size).toBeLessThanOrEqual(COOLDOWN_MAX_ENTRIES);
  });
});

describe('🔒 the wiring — a check that is not bounded is a way to hammer somebody else’s server', () => {
  const routes = readFileSync(resolve(__dirname, '../routes/agentv3.ts'), 'utf8');
  const at = routes.indexOf("app.post('/api/agentv3/mcp/check'");
  const body = routes.slice(at, at + 2000);

  it('the route exists and belongs to the workspace owner', () => {
    expect(at).toBeGreaterThan(-1);
    expect(body).toContain('assertVerifiedWorkspaceOwner');
  });

  it('🔒 it is rate-limited per app, because each call reaches outside', () => {
    expect(body).toContain('allowAfterCooldown');
    expect(body).toContain('429');
  });

  it('🔒 it is NOT plan-gated — seeing why a build lost a tool is not buying a feature', () => {
    expect(body).not.toContain('canUseConnectedServices');
  });

  it('a probe that throws is a failing SERVICE, never a failed check', () => {
    expect(body).toContain('listRemoteTools(cfg).catch');
  });

  it('the headline is told how many services there were, so a partial check cannot read as a full one', () => {
    expect(body).toContain('healthHeadline(results, servers.length)');
  });
});
