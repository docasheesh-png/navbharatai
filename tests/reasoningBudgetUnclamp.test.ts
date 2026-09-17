// 🔴 THE CLAMP IS INVERTED FOR A MODEL THAT ALWAYS REASONS — autopsy f5351721, 2026-09-17.
//
// Build f5351721 ran on Strong (`glm-5.3`) for 35.6 minutes. Three of its 30 model calls returned
// reasoning and nothing else, each authorised exactly 9,833 output tokens, and the first of them
// finished 131 seconds into a 300-second clock — it ran out of CEILING with 58% of its time unused.
//
// These cases pin the fix and, just as importantly, pin the two things that must NOT change with it:
// the rate constant (measured as well calibrated across 73 real calls) and the behaviour of every
// vendor whose reasoning we have never measured.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  reconcileFloorBudget,
  floorMaxTokensForTimeout,
  starvedBudgetError,
  isStarvedBudgetError,
  isUnclampedStarvation,
  reasoningUnclampEnabled,
  STARVED_UNCLAMPED_MARK,
} from '../src/server/AgentV3/floorBudget';
import { modelAlwaysReasons, glmCanDisableThinking, MEASURED_ALWAYS_REASONS } from '../src/server/AgentV3/providers/glmThinking';

/** The build loop's real per-turn ask (`buildMaxTokensPerTurn`). */
const LOOP_ASK = 32_000;
/** The streamed hard cap (`streamHardCapMs`) — the clock these calls really had. */
const STREAM_CAP_MS = 300_000;
const on = {} as NodeJS.ProcessEnv;

describe('modelAlwaysReasons — a POSITIVE capability test, not a negation', () => {
  it('is true for the GLM families that always reason', () => {
    for (const id of ['glm-5.3', 'glm-5.3-flash', 'glm-5.4', 'glm-6', 'GLM-5.3']) {
      expect(modelAlwaysReasons(id), id).toBe(true);
    }
  });

  it('is false for the GLM families that can be told to stop', () => {
    for (const id of ['glm-4.7', 'glm-4.7-flashx', 'glm-5.2', 'glm-5.0']) {
      expect(modelAlwaysReasons(id), id).toBe(false);
    }
  });

  // 🔒 THE INVERSION GUARD, and the reason this predicate exists at all instead of a `!`.
  // `glmCanDisableThinking` denies on ANYTHING it does not recognise, because sending an unsupported
  // field is a hard 400 — denial-on-unknown is the safe answer there. Negating it would assert that
  // every Kimi and Grok id always reasons, purely because the id failed a startsWith('glm-') check,
  // and that claim would hand an unbounded budget to a vendor nobody has measured.
  //
  // ⚠️ `kimi-k2.7-code` WAS one of the ids in this list, and it was moved out on 2026-09-17 (autopsy
  // d98dae01) — not by loosening this guard but because the measurement arrived: four starvations of
  // that one id across reports 58fe8254 (outputTokens 4833, three times) and d98dae01 (2,314, twice).
  // The principle this case protects is exactly what admits it, and is unchanged: a MEASURED id may
  // be listed; a vendor may never be assumed. The ids below are the ones still unmeasured.
  it('🔒 both are FALSE for a vendor we have not measured — the two are not opposites', () => {
    for (const id of ['kimi-k3', 'kimi-k2.6', 'grok-4', 'claude-sonnet-4-6', '', undefined, null]) {
      expect(glmCanDisableThinking(id as string), `canDisable ${id}`).toBe(false);
      expect(modelAlwaysReasons(id as string), `alwaysReasons ${id}`).toBe(false);
    }
  });

  it('🔒 …and the one id that IS true is true by MEASUREMENT, not by a negated prefix test', () => {
    expect(MEASURED_ALWAYS_REASONS).toContain('kimi-k2.7-code');
    expect(modelAlwaysReasons('kimi-k2.7-code')).toBe(true);
    // Still false in the OTHER predicate — sending `disabled` to it is still a hard 400. The two
    // answer different questions, which is the whole point of the case above.
    expect(glmCanDisableThinking('kimi-k2.7-code')).toBe(false);
  });
});

describe('reconcileFloorBudget — the forced-reasoning branch', () => {
  // Pins the exact arithmetic that produced the bug, so a change to either constant is visible here.
  it('the old ceiling on a streamed call really is 9,833 — the number in the report', () => {
    expect(floorMaxTokensForTimeout(STREAM_CAP_MS, on)).toBe(9_833);
  });

  it('a normal rung is still clamped to what the clock carries', () => {
    const b = reconcileFloorBudget(LOOP_ASK, STREAM_CAP_MS, on);
    expect(b.maxTokens).toBe(9_833);
    expect(b.clamped).toBe(true);
    expect(b.reasoningUnclamped).toBeFalsy();
  });

  it('a forced-reasoning rung keeps the full ask, and says so', () => {
    const b = reconcileFloorBudget(LOOP_ASK, STREAM_CAP_MS, on, { alwaysReasons: true });
    expect(b.maxTokens).toBe(LOOP_ASK);
    expect(b.clamped).toBe(false);
    expect(b.reasoningUnclamped).toBe(true);
    expect(b.requested).toBe(LOOP_ASK);
  });

  it('🔒 the three starved calls would now have had room — 9,833 was the binding constraint', () => {
    // Their observed spend was 8,651 / 9,199 / 9,746 on the calls that survived; the ceiling was 9,833.
    const clamped = reconcileFloorBudget(LOOP_ASK, STREAM_CAP_MS, on).maxTokens;
    const unclamped = reconcileFloorBudget(LOOP_ASK, STREAM_CAP_MS, on, { alwaysReasons: true }).maxTokens;
    expect(clamped).toBeLessThan(10_000);
    expect(unclamped).toBeGreaterThan(clamped * 3);
  });

  it('an ask that already fits is untouched and is NOT marked unclamped', () => {
    const b = reconcileFloorBudget(500, STREAM_CAP_MS, on, { alwaysReasons: true });
    expect(b.maxTokens).toBe(500);
    expect(b.clamped).toBe(false);
    expect(b.reasoningUnclamped).toBeFalsy();
  });

  it('a zero/absent ask still falls back to the clock, never to "unlimited"', () => {
    for (const bad of [0, -1, Number.NaN]) {
      const b = reconcileFloorBudget(bad, STREAM_CAP_MS, on, { alwaysReasons: true });
      expect(b.maxTokens).toBe(9_833);
      expect(b.reasoningUnclamped).toBeFalsy();
    }
  });

  it('the kill switch restores the clamp exactly', () => {
    const env = { AGENTV3_REASONING_UNCLAMP: 'off' } as unknown as NodeJS.ProcessEnv;
    expect(reasoningUnclampEnabled(env)).toBe(false);
    const b = reconcileFloorBudget(LOOP_ASK, STREAM_CAP_MS, env, { alwaysReasons: true });
    expect(b.maxTokens).toBe(9_833);
    expect(b.clamped).toBe(true);
    expect(b.reasoningUnclamped).toBeFalsy();
  });

  it('unset or junk means ON — only an explicit "off" disables it', () => {
    expect(reasoningUnclampEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(reasoningUnclampEnabled({ AGENTV3_REASONING_UNCLAMP: '' } as NodeJS.ProcessEnv)).toBe(true);
    expect(reasoningUnclampEnabled({ AGENTV3_REASONING_UNCLAMP: 'yes' } as NodeJS.ProcessEnv)).toBe(true);
    expect(reasoningUnclampEnabled({ AGENTV3_REASONING_UNCLAMP: ' OFF ' } as NodeJS.ProcessEnv)).toBe(false);
  });

  // 🔒 A SLOW rung must still be bounded. The unclamp is about WHOSE tokens they are, not about
  // removing the clock — a lane with seconds left still authorises seconds' worth.
  it('a nearly-exhausted lane still bounds a forced-reasoning rung', () => {
    const b = reconcileFloorBudget(LOOP_ASK, 20_000, on, { alwaysReasons: true });
    expect(b.maxTokens).toBe(LOOP_ASK); // the ask stands …
    expect(b.reasoningUnclamped).toBe(true);
    // … because the CLOCK, not this function, is what ends the call. Proven by the clamped twin:
    expect(reconcileFloorBudget(LOOP_ASK, 20_000, on).maxTokens).toBe(500);
  });
});

describe('🔒 honesty — an unclamped starvation must not blame "our own ceiling"', () => {
  const clampedErr = starvedBudgetError(9_833, 32_000);
  const unclampedErr = starvedBudgetError(32_000, 32_000, true);

  it('the clamped wording is unchanged', () => {
    expect(clampedErr.message).toContain('Our own ceiling, not this provider');
    expect(clampedErr.message).toContain('cut down from 32000');
    expect(isUnclampedStarvation(clampedErr)).toBe(false);
  });

  it('the unclamped wording says the ceiling was not reduced, and never claims it was ours', () => {
    expect(unclampedErr.message).toContain(STARVED_UNCLAMPED_MARK);
    expect(unclampedErr.message).not.toContain('Our own ceiling');
    expect(unclampedErr.message).toContain('32000');
    expect(isUnclampedStarvation(unclampedErr)).toBe(true);
  });

  it('BOTH are still recognised as starvation, so the ledger bucket cannot change', () => {
    expect(isStarvedBudgetError(clampedErr)).toBe(true);
    expect(isStarvedBudgetError(unclampedErr)).toBe(true);
    expect(isUnclampedStarvation(new Error('some unrelated failure'))).toBe(false);
  });

  // The discipline STARVED_BUDGET_MESSAGE's own docblock demands, applied to the new sentence.
  it('the new sentence survives the failure classifiers it must not trip', () => {
    const t = unclampedErr.message.toLowerCase();
    expect(/timed? ?out|timeout|deadline/.test(t)).toBe(false);
    expect(/context length|too long|max tokens|token limit/.test(t)).toBe(false);
    expect(/model.{0,20}(?:unavailable|deprecated|retired)/.test(t)).toBe(false);
    expect(/\b429\b|rate.?limit|quota/.test(t)).toBe(false);
  });
});

describe('🔒 reversion guards — the wiring, not just the helpers', () => {
  const runner = readFileSync(
    join(process.cwd(), 'src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8',
  );

  it('the runner asks the capability module rather than testing the id itself', () => {
    expect(runner).toContain('alwaysReasons: modelAlwaysReasons(thinkingModel)');
    // It must not re-derive "does this model reason?" from a string match of its own.
    expect(runner).not.toMatch(/startsWith\(\s*'glm-5\.3'/);
  });

  it('the throw carries the unclamped flag, so the report cannot mis-state the cause', () => {
    // ⚠️ The pinned literal gained a FOURTH argument on 2026-09-17 (autopsy d98dae01) — the lane's
    // remaining clock, when the LANE bounded the call rather than this engine's own cap. The flag this
    // case exists for is untouched and is still asserted; both are pinned together so neither can be
    // dropped while the other stands.
    expect(runner).toContain(`starvedBudgetError(
        budget.maxTokens,
        budget.requested,
        budget.reasoningUnclamped,
        bound.source === 'deadline' ? timeoutMs : undefined,
      )`);
  });

  // 🔴 THE RATE CONSTANT WAS MEASURED AND DELIBERATELY LEFT ALONE. Across 73 real calls in the reports
  // to hand, kimi-k2.6 aggregates to 30.5 ms/token against our 30 and the fleet median is 25.1 — it is
  // well calibrated. Lowering it to suit the one fast model would under-bound every slow one and
  // re-open the class floorBudget.ts was written for. This pins that it stayed put.
  it('🔒 the fix did NOT quietly retune the measured rate constant', () => {
    const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/floorBudget.ts'), 'utf8');
    expect(src).toContain('export const FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT = 30;');
    expect(src).toContain('export const FLOOR_CALL_OVERHEAD_MS = 5_000;');
  });
});
