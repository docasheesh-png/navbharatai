// THE MID-BUILD STOP — a build may not spend past its ceiling (admin 2026-09-13: "-500₹ har user ko
// diye to ham barbaad ho jayenge").
//
// The wallet floor bounds what the USER is billed. These tests cover the other half: what the build
// is allowed to cost US while it is still running.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCostCeilingUsd,
  ledgerCostUsd,
  checkCostCeiling,
  costCeilingDetail,
  DEFAULT_BUILD_COST_CEILING_USD,
  MAX_BUILD_COST_CEILING_USD,
} from '../src/server/AgentV3/buildCostCeiling';
import { abortSummary, abortCauseOf, abortBuild, isUserInitiated } from '../src/server/AgentV3/buildAbortCause';

describe('buildCostCeilingUsd — the configured ceiling', () => {
  it('defaults to $5 when nothing is set', () => {
    expect(buildCostCeilingUsd({} as NodeJS.ProcessEnv)).toBe(DEFAULT_BUILD_COST_CEILING_USD);
  });

  it('reads a plain value', () => {
    expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: '2.5' } as NodeJS.ProcessEnv)).toBe(2.5);
  });

  it('accepts the shapes an operator actually types', () => {
    for (const raw of [' 2.5 ', '$2.5', '2.50']) {
      expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: raw } as NodeJS.ProcessEnv)).toBe(2.5);
    }
  });

  it('an EXPLICIT 0 is the opt-out — and the only way to reach "no ceiling"', () => {
    expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(checkCostCeiling(9999, 0).stop).toBe(false);
  });

  it('🔒 a MALFORMED value falls back to the default, NEVER to "no ceiling"', () => {
    // The whole point: a typo must not silently restore the unbounded build this module exists to end.
    for (const raw of ['abc', '-1', '', '   ', 'five']) {
      expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: raw } as NodeJS.ProcessEnv))
        .toBe(DEFAULT_BUILD_COST_CEILING_USD);
    }
  });

  it('🔒 caps an absurd value — a typo of 500 cannot reproduce an unbounded build', () => {
    expect(buildCostCeilingUsd({ AGENTV3_BUILD_COST_CEILING_USD: '500' } as NodeJS.ProcessEnv))
      .toBe(MAX_BUILD_COST_CEILING_USD);
  });
});

describe('checkCostCeiling — when a build is stopped', () => {
  it('stops at or past the ceiling', () => {
    expect(checkCostCeiling(5, 5).stop).toBe(true);
    expect(checkCostCeiling(7.2, 5).stop).toBe(true);
  });

  it('a normal build is nowhere near it', () => {
    // Real builds in this repo's own reports cost $0.4-$1.0.
    expect(checkCostCeiling(0.45, 5).stop).toBe(false);
    expect(checkCostCeiling(1.0, 5).stop).toBe(false);
  });

  it('a cost we could not measure never ends a build', () => {
    expect(checkCostCeiling(Number.NaN, 5).stop).toBe(false);
    expect(checkCostCeiling(Number.POSITIVE_INFINITY, 5).stop).toBe(false);
    expect(checkCostCeiling(-3, 5).stop).toBe(false);
  });
});

describe('ledgerCostUsd — the live reading', () => {
  it('an empty ledger costs nothing', () => {
    expect(ledgerCostUsd([])).toBe(0);
  });

  it('prices real entries and grows with the tokens spent', () => {
    const one = ledgerCostUsd([{ provider: 'CLAUDE', usage: { inputTokens: 100_000, outputTokens: 20_000 } }]);
    const two = ledgerCostUsd([{ provider: 'CLAUDE', usage: { inputTokens: 200_000, outputTokens: 40_000 } }]);
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
  });

  it('🔴 the reading EXCLUDES the unattributed remainder, so the stop fires LATE, never early', () => {
    // realProviderCostUsd's second argument is the aux remainder. ledgerCostUsd deliberately omits it,
    // which is what makes the live figure an under-estimate of the build's true cost.
    const src = readFileSync('src/server/AgentV3/buildCostCeiling.ts', 'utf8');
    expect(src).toMatch(/realProviderCostUsd\(entries\)/);
    expect(src).not.toMatch(/realProviderCostUsd\(entries,/);
  });
});

describe('the user-facing sentence', () => {
  it('never blames the user, and never names our cost', () => {
    const saved = abortSummary('cost-cap', { builtSomething: true });
    const nothing = abortSummary('cost-cap', { builtSomething: false });
    for (const msg of [saved, nothing]) {
      expect(msg).not.toMatch(/\$|USD|cost|token|provider/i);
      expect(msg).not.toMatch(/you stopped|stopped by the user/i);
    }
  });

  it('when work SURVIVED it says so and how to continue', () => {
    expect(abortSummary('cost-cap', { builtSomething: true })).toMatch(/saved/i);
    expect(abortSummary('cost-cap', { builtSomething: true })).toMatch(/continue/i);
  });

  it('when nothing was produced it does NOT claim files were saved', () => {
    expect(abortSummary('cost-cap', { builtSomething: false })).not.toMatch(/saved/i);
  });

  it('🔒 a cost stop is never filed as the user abandoning the build', () => {
    expect(isUserInitiated('cost-cap')).toBe(false);
  });

  it('the cause survives a real abort', () => {
    const c = new AbortController();
    abortBuild(c, 'cost-cap');
    expect(c.signal.aborted).toBe(true);
    expect(abortCauseOf(c.signal)).toBe('cost-cap');
  });
});

describe('the ADMIN line', () => {
  it('carries both numbers, the under-estimate caveat, and the key to change it', () => {
    const detail = costCeilingDetail(checkCostCeiling(5.25, 5));
    expect(detail).toContain('$5.25');
    expect(detail).toContain('$5.00');
    expect(detail).toMatch(/at least this much/i);
    expect(detail).toContain('AGENTV3_BUILD_COST_CEILING_USD');
  });
});

describe('the wiring — the ceiling lives at the CHOKE POINT, not in the call sites', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');

  it('is evaluated inside captureTurnUsage, which every build and heal turn passes through', () => {
    const start = route.indexOf('const captureTurnUsage =');
    expect(start).toBeGreaterThan(0);
    const body = route.slice(start, start + 2600);
    expect(body).toContain('checkCostCeiling');
    expect(body).toContain("'cost-cap'");
  });

  it('🔒 fires at most once per build', () => {
    expect(route).toContain('let costCeilingFired = false;');
    const start = route.indexOf('const captureTurnUsage =');
    const body = route.slice(start, start + 2600);
    expect(body).toContain('if (!costCeilingFired)');
    expect(body).toContain('costCeilingFired = true;');
  });

  it('🔒 an evaluation that throws never ends a build (fails OPEN)', () => {
    const start = route.indexOf('if (!costCeilingFired)');
    const body = route.slice(start, start + 1600);
    expect(body).toMatch(/try\s*\{/);
    expect(body).toMatch(/\}\s*catch\s*\{/);
  });
});
