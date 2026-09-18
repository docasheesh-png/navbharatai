// Autopsy c6e4c6ff (2026-09-18) — the fast lane bailed having produced NOTHING, and the thing that
// doomed it was the optional pass it then threw away.
//
// Every number was already known when the decision was made:
//     plan call            49s    (measured, a real call on this build's own chain)
//     3 populated tiers  ~147s    (projected at the plan's latency)
//     after the plan      49 + 147 = 196s of 240s   → the lane could finish
//     contract cap         47s
//     after the contract  96 + 147 = 243s of 240s   → DOOMED
//
// The contract is already declared skippable ("an empty contract degrades per-file agreement, it does
// not break the build" / "a starved build phase produces no app at all"). That rule was simply never
// applied to the tier budget.
import { describe, it, expect } from 'vitest';
import {
  canAffordSharedContract,
  canFinishAfterPreamble,
  preambleCapMs,
  BUILD_PHASE_RESERVE,
} from '../src/server/AgentV3/FastLaneBudget';

const OVERALL = 240_000;

describe('the exact build that was doomed by its own optional pass', () => {
  const planCallMs = 49_000;
  const tiers = 3;
  const contractCapMs = preambleCapMs(OVERALL, planCallMs, 90_000);

  it('the contract cap the share allowed was 47s', () => {
    expect(Math.round(contractCapMs / 1000)).toBe(47);
  });

  it('after planning alone, the lane COULD still finish', () => {
    expect(canFinishAfterPreamble({ preambleCallMs: planCallMs, tiers, elapsedMs: planCallMs, overallMs: OVERALL })).toBe(true);
  });

  it('after paying for the contract it could NOT — which is what actually happened', () => {
    expect(canFinishAfterPreamble({
      preambleCallMs: planCallMs, tiers, elapsedMs: planCallMs + contractCapMs, overallMs: OVERALL,
    })).toBe(false);
  });

  it('so the contract is now refused, and the files get the time instead', () => {
    expect(canAffordSharedContract({
      preambleCallMs: planCallMs, tiers, elapsedMs: planCallMs, overallMs: OVERALL, contractCapMs,
    })).toBe(false);
  });
});

describe('a lane with room keeps its contract — this must not become "never run the contract"', () => {
  it('a fast plan with two tiers can afford it comfortably', () => {
    // 10s plan, 2 tiers → 20s of files, 10s contract. Nowhere near the budget.
    expect(canAffordSharedContract({
      preambleCallMs: 10_000, tiers: 2, elapsedMs: 10_000, overallMs: OVERALL, contractCapMs: 60_000,
    })).toBe(true);
  });

  it('a single-tier app can afford it even on a slowish plan', () => {
    expect(canAffordSharedContract({
      preambleCallMs: 40_000, tiers: 1, elapsedMs: 40_000, overallMs: OVERALL, contractCapMs: 50_000,
    })).toBe(true);
  });

  it('the boundary is the budget itself, not a new invented number', () => {
    // plan 50s, 3 tiers = 150s projected, elapsed 50s → 200s. A 40s contract fits exactly at 240s.
    const fits = canAffordSharedContract({
      preambleCallMs: 50_000, tiers: 3, elapsedMs: 50_000, overallMs: OVERALL, contractCapMs: 40_000,
    });
    expect(fits).toBe(true);
    // One second more of contract and it does not.
    expect(canAffordSharedContract({
      preambleCallMs: 50_000, tiers: 3, elapsedMs: 50_000, overallMs: OVERALL, contractCapMs: 41_000,
    })).toBe(false);
  });
});

describe('the expected cost is the MEASURED plan, not the cap', () => {
  it('a generous cap does not condemn the contract when the plan was fast', () => {
    // Cap 90s, but the plan took 5s — the contract is expected to cost about 5s, not 90s.
    // 5s plan, 3 tiers = 15s, elapsed 5s, +5s contract = 25s. Easily affordable.
    expect(canAffordSharedContract({
      preambleCallMs: 5_000, tiers: 3, elapsedMs: 5_000, overallMs: OVERALL, contractCapMs: 90_000,
    })).toBe(true);
  });

  it('but it can never be assumed cheaper than its own cap allows', () => {
    // Cap 10s with a 60s plan: the call cannot outlive the cap, so 10s is the cost used.
    // 60s plan, 3 tiers = 180s, elapsed 60s, +10s = 250s > 240s → refused.
    expect(canAffordSharedContract({
      preambleCallMs: 60_000, tiers: 3, elapsedMs: 60_000, overallMs: OVERALL, contractCapMs: 10_000,
    })).toBe(false);
  });
});

describe('it never bails on an absent signal', () => {
  it('a cap of 0 means the share already skipped it — nothing to decide', () => {
    expect(canAffordSharedContract({
      preambleCallMs: 49_000, tiers: 3, elapsedMs: 49_000, overallMs: OVERALL, contractCapMs: 0,
    })).toBe(false);
  });

  it('no measured plan duration ⇒ keep the contract', () => {
    expect(canAffordSharedContract({
      preambleCallMs: 0, tiers: 3, elapsedMs: 1_000, overallMs: OVERALL, contractCapMs: 60_000,
    })).toBe(true);
  });

  it('no tiers to build ⇒ keep the contract', () => {
    expect(canAffordSharedContract({
      preambleCallMs: 49_000, tiers: 0, elapsedMs: 49_000, overallMs: OVERALL, contractCapMs: 47_000,
    })).toBe(true);
  });
});

describe('the reserve this builds on is unchanged', () => {
  it('BUILD_PHASE_RESERVE is still 0.6', () => {
    // The contract's cap still comes from preambleCapMs; this change only asks a second question
    // about it. Moving the reserve would change every fast-lane build.
    expect(BUILD_PHASE_RESERVE).toBe(0.6);
  });
});

describe('REVERSION GUARD — the builder must ask before it spends', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const src = fs.readFileSync('src/server/AgentV3/SimpleBuilder.ts', 'utf8');

  it('the contract call is gated on affordability', () => {
    expect(src).toContain('canAffordSharedContract');
    expect(src).toContain('contractAffordable');
    expect(src).toContain('shareContract && contractCap > 0 && contractAffordable');
  });

  it('the tier projection is computed ONCE and shared with the doomed check', () => {
    const body = src.slice(src.indexOf('const contractCap ='), src.indexOf('const written: OneShotFile[]'));
    // One declaration only — two would be free to drift apart.
    expect(body.match(/const populatedTiers =/g) ?? []).toHaveLength(1);
    expect(body).toContain('canFinishAfterPreamble');
  });

  it('the skip is announced, never silent', () => {
    expect(src).toContain('Skipping the shared-contract pass — there is time to write your files');
  });
});
