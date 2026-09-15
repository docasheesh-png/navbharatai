import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  floorTimeoutForTokens, floorMaxTokensForTimeout, reconcileFloorBudget, floorMsPerOutputToken,
  FLOOR_TIMEOUT_CAP_MS, FLOOR_TIMEOUT_MIN_MS, FLOOR_CALL_OVERHEAD_MS, FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT,
} from '../src/server/AgentV3/floorBudget';

/**
 * 🔴 "BUILDER NE EK BHI FILE KYU NAHI BANAYI?" — the admin's question about build 4efab9d7, answered.
 *
 * The build loop authorised 32,000 output tokens a turn. The cheap-floor rung gave it 60 seconds. From
 * that build's own two successful turns (111 tokens → 7,466 ms; 182 tokens → 9,631 ms) the model was
 * emitting ~30.5 ms/token, so 60 seconds could carry about 1,830 tokens — seventeen times less than
 * what we had authorised, and 32,000 tokens would have taken about sixteen minutes.
 *
 * Turns 1 and 2 survived because they emitted 111 and 182 tokens. Turn 3 was the turn that writes the
 * files, and it could not fit on any key: the eight GLM failures are 60,006 / 60,010 / 60,007 / 60,005 /
 * 60,003 / 60,004 / 60,004 ms apart — a seven-millisecond spread, which is our own clock firing, not a
 * provider failing.
 */

const REPORT_MS_PER_TOKEN = (9631 - 7466) / (182 - 111); // 30.5, from the report itself

describe('the report’s own arithmetic — pinned so the reasoning cannot rot', () => {
  it('the measured rate is what the default is set to, within a token-time of slack', () => {
    expect(REPORT_MS_PER_TOKEN).toBeGreaterThan(29);
    expect(REPORT_MS_PER_TOKEN).toBeLessThan(31);
    expect(FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT).toBeLessThanOrEqual(Math.ceil(REPORT_MS_PER_TOKEN));
  });

  it('🔴 60 seconds could carry ~1,830 tokens while the loop authorised 32,000', () => {
    expect(floorMaxTokensForTimeout(60_000)).toBeLessThan(2_000);
    expect(32_000 / floorMaxTokensForTimeout(60_000)).toBeGreaterThan(15); // >15× over-authorised
  });
});

describe('floorTimeoutForTokens — the clock is derived from the ask', () => {
  it('a small ask gets a small clock, never below the minimum', () => {
    expect(floorTimeoutForTokens(100)).toBe(FLOOR_TIMEOUT_MIN_MS);
    expect(floorTimeoutForTokens(0)).toBe(FLOOR_TIMEOUT_MIN_MS);
  });

  it('a real build ask (32,000 tokens) is capped, not left at 60s', () => {
    const t = floorTimeoutForTokens(32_000);
    expect(t).toBe(FLOOR_TIMEOUT_CAP_MS);
    expect(t).toBeGreaterThan(60_000); // the value that produced the zero-file build
  });

  it('the cap leaves room for the bench to reach the next vendor inside a 480s turn', () => {
    // PR #2951 benches a provider FAMILY after 2 consecutive timeouts. Two of those plus the vendor
    // behind them must fit the turn, or a slow floor eats the whole build again.
    expect(2 * FLOOR_TIMEOUT_CAP_MS).toBeLessThan(480_000);
    expect(480_000 - 2 * FLOOR_TIMEOUT_CAP_MS).toBeGreaterThanOrEqual(150_000);
  });

  it('is tunable by env, and junk falls back to the measured rate', () => {
    expect(floorMsPerOutputToken({ AGENTV3_FLOOR_MS_PER_TOKEN: '10' } as never)).toBe(10);
    for (const bad of ['', '  ', 'fast', '-5', '0']) {
      expect(floorMsPerOutputToken({ AGENTV3_FLOOR_MS_PER_TOKEN: bad } as never)).toBe(FLOOR_MS_PER_OUTPUT_TOKEN_DEFAULT);
    }
  });
});

describe('🔑 reconcileFloorBudget — never authorise more output than the clock can carry', () => {
  it('🔴 the exact 4efab9d7 pair: 32,000 tokens asked, 60s clock → clamped to what 60s can deliver', () => {
    const b = reconcileFloorBudget(32_000, 60_000);
    expect(b.clamped).toBe(true);
    expect(b.requested).toBe(32_000);
    expect(b.maxTokens).toBe(floorMaxTokensForTimeout(60_000));
    expect(b.maxTokens).toBeLessThan(2_000);
  });

  it('an ask that already fits is passed through untouched', () => {
    const b = reconcileFloorBudget(1_000, 150_000);
    expect(b).toEqual({ maxTokens: 1_000, clamped: false, requested: 1_000 });
  });

  it('🔒 a lane with almost no clock left cannot authorise a huge answer either', () => {
    // turnDeadline hands the runner the REMAINING budget, and that is what this must size from.
    const b = reconcileFloorBudget(32_000, 30_000);
    expect(b.maxTokens).toBeLessThan(1_000);
    expect(b.clamped).toBe(true);
  });

  it('a clock too short to deliver anything yields zero rather than a negative or a lie', () => {
    expect(floorMaxTokensForTimeout(FLOOR_CALL_OVERHEAD_MS)).toBe(0);
    expect(floorMaxTokensForTimeout(0)).toBe(0);
    expect(floorMaxTokensForTimeout(-1)).toBe(0);
  });

  it('a caller that asks for nothing gets what the clock affords', () => {
    expect(reconcileFloorBudget(0, 150_000).maxTokens).toBe(floorMaxTokensForTimeout(150_000));
  });

  it('the pair is self-consistent: the clock derived from an ask can always carry that ask', () => {
    for (const ask of [200, 1_000, 4_000, 4_833, 8_000]) {
      const clock = floorTimeoutForTokens(ask);
      if (clock < FLOOR_TIMEOUT_CAP_MS) {
        expect(reconcileFloorBudget(ask, clock).clamped, `${ask}`).toBe(false);
      }
    }
  });
});

describe('🔒 the wiring — the two numbers can never drift apart again', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const runner = readFileSync('src/server/AgentV3/providers/OpenAiToolRunner.ts', 'utf8');

  it('the floor timeout DEFAULT is derived from the loop’s own token ask, not typed in', () => {
    expect(route).toContain('floorTimeoutForTokens(buildMaxTokensPerTurn())');
    expect(route).not.toContain("Number(process.env.AGENTV3_CHEAP_FLOOR_TIMEOUT_MS) || 60_000");
  });

  it('the SDK bound and the runner bound are ONE number', () => {
    expect(route).toContain('new OpenAiToolRunner(client as unknown as OpenAiChatClient, { model, ...runnerOpts, timeoutMs })');
  });

  it('the ask is clamped from the EFFECTIVE clock (after the lane deadline), not the configured one', () => {
    expect(runner).toContain('reconcileFloorBudget(params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000, timeoutMs)');
    expect(runner).toContain('max_tokens: budget.maxTokens,');
    expect(runner).not.toContain('max_tokens: params.maxTokens ?? this.opts.defaultMaxTokens ?? 8000');
    // `timeoutMs` here is `bound.timeoutMs` — the reconciled one.
    expect(runner).toContain('const timeoutMs = bound.timeoutMs;');
  });
});
