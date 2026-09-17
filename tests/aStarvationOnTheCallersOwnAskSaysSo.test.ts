/**
 * 🔴 AUTOPSY 57875eb3 (2026-09-17) — THE STARVATION LINE BLAMED THE WRONG KNOBS, FIFTEEN TIMES.
 *
 * A fast-lane repair asked `glm-5.3` for 8,000 output tokens. The 300 s streamed clock could carry
 * ~9,800, so `reconcileFloorBudget` granted the ask unchanged — and the model spent all 8,000 on
 * reasoning, thirteen calls in a row (plus once on Kimi). Every one was reported as:
 *
 *     "Our own ceiling, not this provider … The ceiling is FLOOR_TIMEOUT_CAP_MS /
 *      AGENTV3_FLOOR_MS_PER_TOKEN (see floorBudget.ts)"
 *
 * Neither knob bounded that call. #3052 had just split the sentence into "our own cap" and "the
 * lane's clock"; this is the THIRD case — the caller's own ask was the ceiling and nothing reduced
 * it — and it is derivable from the two numbers the error already carries.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  starvedBudgetError, isStarvedBudgetError, isAskBoundStarvation, isLaneBoundStarvation,
  isUnclampedStarvation, reconcileFloorBudget, floorMaxTokensForTimeout, STARVED_BY_ASK_MARK,
} from '../src/server/AgentV3/floorBudget';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

/** The report's numbers: the fast lane's ask, and the streamed hard cap that clock ran under. */
const ASK = 8_000;
const STREAM_CLOCK_MS = 300_000;

describe('the arithmetic is the report\'s: the ask fitted the clock, so nothing reduced it', () => {
  it('300 s carries more than 8,000 tokens, so reconcileFloorBudget grants the ask unchanged', () => {
    expect(floorMaxTokensForTimeout(STREAM_CLOCK_MS, {})).toBeGreaterThan(ASK);
    const b = reconcileFloorBudget(ASK, STREAM_CLOCK_MS, {}, { alwaysReasons: true });
    expect(b.maxTokens).toBe(ASK);
    expect(b.clamped).toBe(false);
    expect(b.reasoningUnclamped).toBeUndefined(); // the unclamp branch never fired — nothing to unclamp
  });
});

describe('🔑 a starvation on the caller\'s own ask says so', () => {
  it('granted === requested (not unclamped) is marked as ask-bound, and names no knob of this module', () => {
    const err = starvedBudgetError(ASK, ASK);
    expect(isStarvedBudgetError(err)).toBe(true);
    expect(isAskBoundStarvation(err)).toBe(true);
    expect(err.message).toContain(STARVED_BY_ASK_MARK);
    expect(err.message).toContain("the caller's own per-call ask");
    // REVERSION GUARD: the exact sentence the report printed fifteen times.
    expect(err.message).not.toContain('Our own ceiling, not this provider');
  });

  it('⚠️ the three markers are mutually exclusive by construction', () => {
    const ask = starvedBudgetError(ASK, ASK);
    expect(isUnclampedStarvation(ask)).toBe(false);
    expect(isLaneBoundStarvation(ask)).toBe(false);
    // A lane clock that did not reduce the ask did not bound it — the ask still wins, no lane text.
    const askUnderLane = starvedBudgetError(ASK, ASK, false, 74_420);
    expect(isAskBoundStarvation(askUnderLane)).toBe(true);
    expect(isLaneBoundStarvation(askUnderLane)).toBe(false);
    // The other two cases are untouched.
    const clamped = starvedBudgetError(4_833, ASK);
    expect(isAskBoundStarvation(clamped)).toBe(false);
    expect(clamped.message).toContain('Our own ceiling, not this provider');
    const lane = starvedBudgetError(2_314, ASK, false, 74_420);
    expect(isAskBoundStarvation(lane)).toBe(false);
    expect(isLaneBoundStarvation(lane)).toBe(true);
    const unclamped = starvedBudgetError(ASK, ASK, true);
    expect(isAskBoundStarvation(unclamped)).toBe(false);
    expect(isUnclampedStarvation(unclamped)).toBe(true);
  });

  it('a zero or absent ask is not "the ask was the ceiling"', () => {
    for (const [g, r] of [[4_833, 0], [0, 0], [1, 2]] as const) {
      expect(isAskBoundStarvation(starvedBudgetError(g, r)), `${g}/${r}`).toBe(false);
    }
  });

  it('🔒 the new sentence survives the failure classifiers it must not match', () => {
    const text = starvedBudgetError(ASK, ASK).message.toLowerCase();
    expect(text).not.toMatch(/timed? ?out|timeout/);              // would bench the provider for our budgeting
    expect(text).not.toMatch(/max tokens|token limit|too long/);   // would blame the prompt's size
    expect(text).not.toMatch(/model.{0,20}(?:unavailable|deprecated|retired)/); // would retire a reachable rung
  });
});

describe('🔒 the report prints the ask-bound explanation, and stops pointing at floorBudget\'s knobs', () => {
  const starvedLine = (reason: Error): string => {
    const d = new BuildDiagnostics('w', 'b');
    d.recordProviderFailure('GLM', reason);
    const hit = d.report().issues.find((i) => i.code === 'OUTPUT_BUDGET_STARVED');
    expect(hit, 'OUTPUT_BUDGET_STARVED not recorded').toBeTruthy();
    return hit!.message;
  };

  it('ask-bound ⇒ names the CALLER\'S OWN ASK, never FLOOR_TIMEOUT_CAP_MS', () => {
    const msg = starvedLine(starvedBudgetError(ASK, ASK));
    expect(msg).toContain("CALLER'S OWN ASK");
    expect(msg).not.toContain('FLOOR_TIMEOUT_CAP_MS');
    expect(msg).not.toContain('REMAINING BUDGET OF THE LANE');
  });

  it('the other three explanations are unchanged', () => {
    expect(starvedLine(starvedBudgetError(4_833, ASK))).toContain('FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN');
    expect(starvedLine(starvedBudgetError(2_314, ASK, false, 74_420))).toContain('REMAINING BUDGET OF THE LANE');
    expect(starvedLine(starvedBudgetError(ASK, ASK, true))).toContain('NOT reduced by us');
  });

  it('still a real finding, never auto-resolved', () => {
    const d = new BuildDiagnostics('w', 'b');
    d.recordProviderFailure('GLM', starvedBudgetError(ASK, ASK));
    expect(d.report().issues.find((i) => i.code === 'OUTPUT_BUDGET_STARVED')?.autoResolved).toBe(false);
  });

  it('🔒 the ask-bound branch is consulted BEFORE the lane and own-cap branches (source order)', () => {
    const src = readFileSync(resolve(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const ask = code.indexOf('isAskBoundStarvation(reason)');
    const lane = code.indexOf('isLaneBoundStarvation(reason)');
    const own = code.indexOf('FLOOR_TIMEOUT_CAP_MS / AGENTV3_FLOOR_MS_PER_TOKEN (see floorBudget.ts)');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(lane);
    expect(lane).toBeLessThan(own);
  });
});
