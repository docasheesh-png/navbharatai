/**
 * 🔴 AUTOPSY d98dae01, HALF 2 — the rung was starved by a clock nobody named, and the report blamed
 * the wrong module for it.
 *
 * The timeline, from the report's own timestamps:
 *
 *     t+0.0s   "Planning the file list…"      the fast lane's manifest call, 90s plan cap
 *     t+15.5s  GLM abandoned for crawling     glm-4.7-flashx, benched for the build
 *     t+49.5s  KIMI starved                   authorised 2,314 tokens, cut down from 8,000
 *
 * 2,314 × 30 ms + 5,000 = **74,420 ms** — exactly the 90-second plan cap minus the 15.5 seconds the
 * crawling rung had already spent. So the ceiling was decided by the CALLING LANE's remaining budget,
 * and the finding printed *"the ceiling is FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN"* —
 * pointing an autopsy at a 150,000 ms cap that had nothing to do with it.
 *
 * Two changes, and they are independent on purpose: one removes the starvation, the other makes it
 * legible if it happens anyway.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  modelAlwaysReasons, MEASURED_ALWAYS_REASONS, glmCanDisableThinking,
} from '../src/server/AgentV3/providers/glmThinking';
import {
  reconcileFloorBudget, starvedBudgetError, isStarvedBudgetError, isUnclampedStarvation,
  isLaneBoundStarvation, floorMaxTokensForTimeout, FLOOR_TIMEOUT_CAP_MS,
} from '../src/server/AgentV3/floorBudget';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/** The real build's numbers, so every assertion below is anchored to evidence and not to a scenario. */
const LANE_MS = 74_420;
const GRANTED = 2_314;
const ASKED = 8_000;

describe('the arithmetic is the report\'s, not this test\'s', () => {
  it('74,420 ms of lane buys exactly the 2,314 tokens the report recorded', () => {
    expect(floorMaxTokensForTimeout(LANE_MS, {})).toBe(GRANTED);
  });

  it('…and that is nothing like the cap the finding blamed', () => {
    expect(LANE_MS).toBeLessThan(FLOOR_TIMEOUT_CAP_MS);
    expect(floorMaxTokensForTimeout(FLOOR_TIMEOUT_CAP_MS, {})).toBeGreaterThan(GRANTED * 2);
  });
});

describe('🔑 the rung that starved is no longer clamped — a MEASURED id, not a vendor claim', () => {
  it('kimi-k2.7-code always reasons, on four starvations across two reports', () => {
    expect(modelAlwaysReasons('kimi-k2.7-code')).toBe(true);
  });

  it('the highspeed variant is the SAME model served faster, so it is covered', () => {
    expect(modelAlwaysReasons('kimi-k2.7-code-highspeed')).toBe(true);
  });

  it('🔒 nothing unmeasured is claimed — not another Kimi, not another vendor', () => {
    for (const id of ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5', 'grok-4', 'gpt-5.4-nano', 'claude-haiku-4-5']) {
      expect(modelAlwaysReasons(id), id).toBe(false);
    }
  });

  it('🔒 the measured set is EXACTLY what has been measured', () => {
    // A guard against a future session adding an id on a hunch: changing this list means having a
    // report that shows that model starving a clamped budget.
    expect([...MEASURED_ALWAYS_REASONS]).toEqual(['kimi-k2.7-code']);
  });

  it('the GLM family rule is untouched, in both directions', () => {
    expect(modelAlwaysReasons('glm-5.3')).toBe(true);
    expect(modelAlwaysReasons('glm-5.3-flash')).toBe(true);
    expect(modelAlwaysReasons('glm-4.7-flashx')).toBe(false);
    expect(modelAlwaysReasons('glm-5.2')).toBe(false);
    expect(modelAlwaysReasons('')).toBe(false);
    expect(modelAlwaysReasons(undefined)).toBe(false);
  });

  it('⚠️ and it is still NOT the negation of glmCanDisableThinking — the two answer different questions', () => {
    // Denial-on-unknown is right for "may we send `disabled`?" and wrong for "will it reason anyway?".
    expect(glmCanDisableThinking('kimi-k2.7-code')).toBe(false);
    expect(glmCanDisableThinking('grok-4')).toBe(false);
    expect(modelAlwaysReasons('grok-4')).toBe(false); // …so the negation would have been TRUE here
  });

  it('ids are matched case- and whitespace-insensitively', () => {
    expect(modelAlwaysReasons('  KIMI-K2.7-Code ')).toBe(true);
  });

  it('🔴 THE CONSEQUENCE, on the report\'s own numbers: the ceiling is no longer cut', () => {
    const budget = reconcileFloorBudget(ASKED, LANE_MS, {}, { alwaysReasons: modelAlwaysReasons('kimi-k2.7-code') });
    expect(budget.maxTokens).toBe(ASKED);
    expect(budget.clamped).toBe(false);
    expect(budget.reasoningUnclamped).toBe(true);
  });

  it('REVERSION GUARD: without the measured id that same call is clamped to the starving 2,314', () => {
    const budget = reconcileFloorBudget(ASKED, LANE_MS, {}, { alwaysReasons: false });
    expect(budget.maxTokens).toBe(GRANTED);
    expect(budget.clamped).toBe(true);
  });

  it('🔒 unclamping cannot make the worst case worse — the clock still bounds the call', () => {
    // The whole safety argument in one assertion: nothing here lengthens a call. The ask changes; the
    // clock the caller passed is untouched, so a slow rung is cut at exactly the moment it is today.
    const budget = reconcileFloorBudget(ASKED, LANE_MS, {}, { alwaysReasons: true });
    expect(floorMaxTokensForTimeout(LANE_MS, {})).toBe(GRANTED);
    expect(budget.maxTokens).toBeGreaterThan(GRANTED);
  });
});

describe('🔒 a starvation says WHICH clock cut the ceiling', () => {
  it('a lane-bound starvation is marked as one, with the lane\'s own milliseconds', () => {
    const err = starvedBudgetError(GRANTED, ASKED, false, LANE_MS);
    expect(isStarvedBudgetError(err)).toBe(true);
    expect(isLaneBoundStarvation(err)).toBe(true);
    expect(err.message).toContain(String(LANE_MS));
    expect(err.message).toContain('not our own cap');
  });

  it('our OWN cap bounding the call is unmarked — today\'s wording exactly', () => {
    const err = starvedBudgetError(4833, ASKED, false);
    expect(isStarvedBudgetError(err)).toBe(true);
    expect(isLaneBoundStarvation(err)).toBe(false);
    expect(err.message).toContain('Our own ceiling, not this provider.');
  });

  it('⚠️ the two markers are mutually exclusive by construction', () => {
    // An unclamped rung keeps the caller's full ask, so no clock reduced its ceiling. Two markers on
    // one error would make the report choose between two contradictory explanations.
    const unclamped = starvedBudgetError(ASKED, ASKED, true, LANE_MS);
    expect(isUnclampedStarvation(unclamped)).toBe(true);
    expect(isLaneBoundStarvation(unclamped)).toBe(false);
    const lane = starvedBudgetError(GRANTED, ASKED, false, LANE_MS);
    expect(isUnclampedStarvation(lane)).toBe(false);
  });

  it('an unmeasured lane clock makes no claim — "we do not know" is not "the lane did it"', () => {
    for (const ms of [0, -1, NaN, undefined]) {
      expect(isLaneBoundStarvation(starvedBudgetError(GRANTED, ASKED, false, ms as number)), String(ms)).toBe(false);
    }
  });

  it('🔒 the new sentence still survives the failure classifiers it must not match', () => {
    const text = starvedBudgetError(GRANTED, ASKED, false, LANE_MS).message.toLowerCase();
    // isTimeoutProviderError would bench the provider for OUR budgeting.
    expect(text).not.toMatch(/timed? ?out|timeout/);
    // classifyProviderFailure's context-length test would blame the PROMPT's size.
    expect(text).not.toMatch(/max tokens|token limit|too long/);
    // isModelUnavailableError would retire a reachable rung as dead for ever.
    expect(text).not.toMatch(/model.{0,20}(?:unavailable|deprecated|retired)/);
  });
});

describe('🔒 the report prints the right one of three explanations', () => {
  const starvedLine = (reason: Error): string => {
    const d = new BuildDiagnostics('w', 'b');
    d.recordProviderFailure('KIMI', reason);
    const hit = d.report().issues.find((i) => i.code === 'OUTPUT_BUDGET_STARVED');
    expect(hit, 'OUTPUT_BUDGET_STARVED not recorded').toBeTruthy();
    return hit!.message;
  };

  it('lane-bound ⇒ names the LANE, and no longer points at this engine\'s cap or rate constant', () => {
    const msg = starvedLine(starvedBudgetError(GRANTED, ASKED, false, LANE_MS));
    expect(msg).toContain('REMAINING BUDGET OF THE LANE');
    // REVERSION GUARD: this is the exact sentence that sent the autopsy to the wrong module.
    expect(msg).not.toContain('FLOOR_TIMEOUT_CAP_MS');
  });

  it('our own cap ⇒ the original sentence, unchanged', () => {
    const msg = starvedLine(starvedBudgetError(4833, ASKED, false));
    expect(msg).toContain('FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN');
  });

  it('unclamped ⇒ still says the ceiling was NOT reduced by us', () => {
    const msg = starvedLine(starvedBudgetError(ASKED, ASKED, true));
    expect(msg).toContain('NOT reduced by us');
    expect(msg).not.toContain('FLOOR_TIMEOUT_CAP_MS');
  });

  it('all three are still recorded as a real finding, never auto-resolved', () => {
    for (const err of [
      starvedBudgetError(GRANTED, ASKED, false, LANE_MS),
      starvedBudgetError(4833, ASKED, false),
      starvedBudgetError(ASKED, ASKED, true),
    ]) {
      const d = new BuildDiagnostics('w', 'b');
      d.recordProviderFailure('KIMI', err);
      const hit = d.report().issues.find((i) => i.code === 'OUTPUT_BUDGET_STARVED');
      expect(hit?.autoResolved).toBe(false);
    }
  });
});

/**
 * 🔒 THE WIRING, read out of the source with comments stripped.
 *
 * `bound.source` is the ONLY place the "whose clock was it?" fact exists, and it lives in the runner
 * rather than in either pure module — so nothing either suite above can assert would notice if the
 * argument stopped being passed. This is the guard for that seam, anchored on real syntax (the
 * statement's own closing paren) rather than a byte window, which this repo has now paid for four
 * times.
 */
describe('🔒 the runner hands the clock source to the error', () => {
  const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/providers/OpenAiToolRunner.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

  const statementAt = (anchor: string): string => {
    const at = code.indexOf(anchor);
    expect(at, `${anchor} not found`).toBeGreaterThan(-1);
    const end = code.indexOf(');', at);
    expect(end).toBeGreaterThan(at);
    return code.slice(at, end);
  };

  it('the starvation throw passes the lane clock, and only when the LANE bound the call', () => {
    // ⚠️ The anchor lost its `throw ` on 2026-09-18: the call is now WRAPPED in `markAbandonedTurn`,
    // which carries the doomed turn's usage to the chain so it is recorded as OUR cost and kept off
    // the user's bill (unbilledTurns.ts). What this case guards — that the LANE's clock reaches the
    // error — is untouched, and that it is still THROWN is asserted on its own line below rather
    // than left to the anchor.
    const stmt = statementAt('starvedBudgetError(');
    expect(stmt).toContain("bound.source === 'deadline'");
    expect(stmt).toContain('timeoutMs');
    expect(stmt).toContain('undefined');
    expect(code).toContain('throw markAbandonedTurn(');
  });

  it('and the unclamp still consults BOTH the known-in-advance rule and the learned one', () => {
    // Either one alone would silently halve this fix: the measured id covers the first call of a
    // process, the learned memo covers every model nobody has measured yet.
    const stmt = statementAt('const budget = reconcileFloorBudget(');
    expect(stmt).toContain('modelAlwaysReasons(thinkingModel)');
    expect(stmt).toContain('modelStarvedWhileClamped(thinkingModel)');
  });
});
