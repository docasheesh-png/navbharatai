import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canFinishAfterPreamble, preambleBailReason, tierEstimateMs, canFinishRemainingTiers,
} from '../src/server/AgentV3/FastLaneBudget';

/**
 * The estimate threw away its best measurement.
 *
 * 🔴 Autopsy 31dc61fd, and it CORRECTS my own first reading of that report. I wrote that the fast lane
 * "had the arithmetic before spending the 177 seconds". It did not have THAT arithmetic — it had a
 * different, more optimistic one, which it ran, and which passed:
 *
 *     plan call        34s    ← the only sample canFinishAfterPreamble used
 *     contract call   ~61s    ← ran to its cap and was killed; measured nowhere, ignored
 *     real tier cost  ~62.5s  ← what a file-writing stage actually took
 *
 *     projected: 95s elapsed + 3 tiers × 34s = 197s  ≤ 240s budget  → PROCEED
 *     reality:  167s elapsed + 2 tiers × 62.5s = 292s > 240s budget → bail, one file written
 *
 * A plan call emits a short FILE LIST; a tier writes whole files, and output tokens dominate latency.
 * So the plan systematically under-measures a tier — while the contract call, which also produces a
 * long body, predicted it almost exactly. The check had the better sample in hand and projected from
 * the cheapest one instead.
 */

const SEC = 1000;

describe('the projection uses the slowest real sample, not the cheapest', () => {
  it('🔴 the report\'s own numbers: plan-only says GO, the contract measurement says STOP', () => {
    const shared = { tiers: 3, elapsedMs: 95 * SEC, overallMs: 240 * SEC };
    // What actually happened: 34s plan, contract ignored.
    expect(canFinishAfterPreamble({ ...shared, preambleCallMs: 34 * SEC })).toBe(true);
    // What the lane already knew: a 61s call on the same chain.
    expect(canFinishAfterPreamble({ ...shared, preambleCallMs: 34 * SEC, contractCallMs: 61 * SEC })).toBe(false);
  });

  it('the estimate is the max of the two, never their sum and never the mean', () => {
    expect(tierEstimateMs({ preambleCallMs: 34 * SEC, contractCallMs: 61 * SEC, tiers: 3, elapsedMs: 0, overallMs: 240 * SEC })).toBe(61 * SEC);
    expect(tierEstimateMs({ preambleCallMs: 70 * SEC, contractCallMs: 20 * SEC, tiers: 3, elapsedMs: 0, overallMs: 240 * SEC })).toBe(70 * SEC);
  });

  it('a lane that skipped the contract keeps today\'s plan-only projection exactly', () => {
    const p = { preambleCallMs: 34 * SEC, tiers: 3, elapsedMs: 95 * SEC, overallMs: 240 * SEC };
    expect(canFinishAfterPreamble(p)).toBe(true);
    expect(canFinishAfterPreamble({ ...p, contractCallMs: 0 })).toBe(true);
    expect(canFinishAfterPreamble({ ...p, contractCallMs: undefined })).toBe(true);
  });

  it.each([NaN, Infinity, -1, 0])('an unusable contract measurement (%s) falls back to the plan', (v) => {
    expect(tierEstimateMs({ preambleCallMs: 34 * SEC, contractCallMs: v as number, tiers: 3, elapsedMs: 0, overallMs: 240 * SEC }))
      .toBe(34 * SEC);
  });

  /**
   * ⚠️ NEVER BAIL ON AN ABSENT SIGNAL — the rule this module already follows. Guessing "too slow" from
   * no evidence abandons healthy builds, and that error is invisible: the user just gets the slow path.
   */
  it('no measurement at all still proceeds', () => {
    expect(canFinishAfterPreamble({ preambleCallMs: 0, tiers: 3, elapsedMs: 0, overallMs: 240 * SEC })).toBe(true);
    expect(canFinishAfterPreamble({ preambleCallMs: NaN, contractCallMs: 900 * SEC, tiers: 3, elapsedMs: 0, overallMs: 240 * SEC })).toBe(true);
  });

  it('a fast lane with room still proceeds — this must not stop healthy builds', () => {
    expect(canFinishAfterPreamble({ preambleCallMs: 12 * SEC, contractCallMs: 15 * SEC, tiers: 3, elapsedMs: 30 * SEC, overallMs: 240 * SEC })).toBe(true);
  });

  it('zero tiers is always finishable', () => {
    expect(canFinishAfterPreamble({ preambleCallMs: 999 * SEC, contractCallMs: 999 * SEC, tiers: 0, elapsedMs: 0, overallMs: 1 })).toBe(true);
  });
});

describe('the bail reason names WHICH call it believed', () => {
  it('🔴 it says the contract when the contract is what decided', () => {
    const r = preambleBailReason({ preambleCallMs: 34 * SEC, contractCallMs: 61 * SEC, tiers: 3, elapsedMs: 95 * SEC, overallMs: 240 * SEC });
    expect(r).toContain('designing the shared contract took 61s');
    expect(r).not.toContain('planning alone');
  });

  it('…and still says planning when planning is what decided', () => {
    const r = preambleBailReason({ preambleCallMs: 87 * SEC, tiers: 3, elapsedMs: 95 * SEC, overallMs: 240 * SEC });
    expect(r).toContain('planning alone took 87s');
  });

  it('it names no vendor — White-Label Law, and this line reaches the report', () => {
    const r = preambleBailReason({ preambleCallMs: 34 * SEC, contractCallMs: 61 * SEC, tiers: 3, elapsedMs: 95 * SEC, overallMs: 240 * SEC });
    expect(r).not.toMatch(/kimi|glm|claude|gemini|grok|nemotron|openai/i);
  });
});

describe('the between-tiers check is untouched — it was already right', () => {
  it('the report\'s post-tier arithmetic still bails', () => {
    expect(canFinishRemainingTiers({ tiersRemaining: 2, lastTierMs: 62.5 * SEC, elapsedMs: 167 * SEC, overallMs: 240 * SEC })).toBe(false);
  });
});

describe('the wiring — asserted from source, comments stripped', () => {
  const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it('the contract call is timed on BOTH paths — a killed call is the measurement worth having', () => {
    expect(src).toContain('const contractStartedAt = Date.now();');
    expect(src).toContain('contractCallMs = Math.min(Math.max(0, Date.now() - contractStartedAt), contractCap);');
  });

  it('and the pre-check is given it', () => {
    expect(src).toContain('contractCallMs,');
    expect(src).toContain('canFinishAfterPreamble(preambleProgress)');
    // ONE object, so the check and the reason it prints can never disagree about the inputs.
    expect(src).toContain('preambleBailReason(preambleProgress)');
  });
});
