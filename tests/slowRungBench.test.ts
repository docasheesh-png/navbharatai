import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EMPTY_SLOW_RUNG_STATE, SLOW_RUNG_MIN_CALLS, SLOW_RUNG_MIN_OBSERVED_MS, SLOW_RUNG_RATIO_DEFAULT,
  canBenchAnother, describeSlowRung, expectedMsForOutput, isRungTooSlow, recordSlowSample, slownessRatio,
  slowRungBenchEnabled, slowRungMinCalls, slowRungRatio,
} from '../src/server/AgentV3/slowRungBench';
import { FLOOR_CALL_OVERHEAD_MS, FLOOR_TIMEOUT_CAP_MS } from '../src/server/AgentV3/floorBudget';
import { makeMultiProviderTurnRunner, sharedRateLimitCooldowns, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { RunTurnParams, TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

/**
 * THE REAL BUILD THIS MODULE EXISTS FOR — autopsy dd1f5f60, 2026-09-16.
 *
 * A free-tier edit that ran 30 minutes, wrote 2 files and never produced a preview. Every one of
 * these eleven GLM calls SUCCEEDED, which is why no bench in the runner could see them: the whole
 * escalation stack lives inside a `catch`. Taken verbatim from the report's `llmCalls`.
 */
const REPORT_CALLS: ReadonlyArray<{ outputTokens: number; observedMs: number }> = [
  { outputTokens: 1176, observedMs: 40_490 },
  { outputTokens: 1515, observedMs: 277_781 },
  { outputTokens: 191, observedMs: 29_327 },
  { outputTokens: 1920, observedMs: 56_184 },
  { outputTokens: 1729, observedMs: 247_890 },
  { outputTokens: 2267, observedMs: 147_321 },
  { outputTokens: 1512, observedMs: 302_479 },
  { outputTokens: 1688, observedMs: 297_558 },
  { outputTokens: 1537, observedMs: 151_388 },
  { outputTokens: 914, observedMs: 46_403 },
  { outputTokens: 881, observedMs: 174_673 },
];

const ENV_KEYS = ['AGENTV3_SLOW_RUNG_BENCH', 'AGENTV3_SLOW_RUNG_RATIO', 'AGENTV3_SLOW_RUNG_MIN_CALLS', 'AGENTV3_FLOOR_MS_PER_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

function fold(samples: ReadonlyArray<{ outputTokens: number; observedMs: number; measured?: boolean }>) {
  return samples.reduce((s, x) => recordSlowSample(s, x), EMPTY_SLOW_RUNG_STATE);
}

describe('expectedMsForOutput — our own budget arithmetic, reused rather than reinvented', () => {
  it('is the floor overhead plus the measured per-token rate', () => {
    expect(expectedMsForOutput(1000)).toBe(FLOOR_CALL_OVERHEAD_MS + 1000 * 30);
    expect(expectedMsForOutput(0)).toBe(FLOOR_CALL_OVERHEAD_MS);
  });

  it('follows AGENTV3_FLOOR_MS_PER_TOKEN, so retuning the rate retunes the judgement too', () => {
    process.env.AGENTV3_FLOOR_MS_PER_TOKEN = '10';
    expect(expectedMsForOutput(1000)).toBe(FLOOR_CALL_OVERHEAD_MS + 10_000);
  });

  it('is NOT clamped like floorTimeoutForTokens — a large healthy turn must not read as slow', () => {
    // floorTimeoutForTokens caps at 150s because it is SIZING a request. Judging must not: a 20,000
    // token turn legitimately needs ~605s, and clamping the expectation to 150s would score a
    // perfectly healthy provider at 4x.
    expect(expectedMsForOutput(20_000)).toBeGreaterThan(FLOOR_TIMEOUT_CAP_MS);
    expect(expectedMsForOutput(20_000)).toBe(FLOOR_CALL_OVERHEAD_MS + 20_000 * 30);
  });
});

describe('the reference build (dd1f5f60) — the exact failure this encodes', () => {
  it('delivered 15,330 output tokens in 1,771s: 8.65 tokens/sec against a 33 tok/s floor', () => {
    const totalTokens = REPORT_CALLS.reduce((n, c) => n + c.outputTokens, 0);
    const totalMs = REPORT_CALLS.reduce((n, c) => n + c.observedMs, 0);
    expect(totalTokens).toBe(15_330); // matches the report's providerTokens.GLM.outputTokens
    expect(totalTokens / (totalMs / 1000)).toBeLessThan(9);
  });

  it('is judged too slow by its THIRD call — 26 minutes before the build was killed', () => {
    expect(isRungTooSlow(fold(REPORT_CALLS.slice(0, 2)))).toBe(false); // sample too small to be a trend
    const atThree = fold(REPORT_CALLS.slice(0, 3));
    expect(isRungTooSlow(atThree)).toBe(true);
    expect(slownessRatio(atThree)).toBeGreaterThan(3);
    // The build's own clock: call 3 ended 5.8 min in, against a 29 min cap. Everything after it was
    // spent on a rung we could already prove was not going to finish the app.
    expect(atThree.observedMs).toBeLessThan(6 * 60_000);
  });

  it('stays judged slow for the whole run, so the verdict cannot flicker back', () => {
    for (let n = 3; n <= REPORT_CALLS.length; n++) {
      expect(isRungTooSlow(fold(REPORT_CALLS.slice(0, n)))).toBe(true);
    }
  });

  it('LATCHES: the real call-4 dip below the line does not un-retire the rung', () => {
    // This exact sequence is why SlowRungState.tooSlow exists. Recomputed instantaneously the
    // cumulative ratio goes 3.43x (call 3) → 2.46x (call 4) → 2.95x (call 5): one better-than-usual
    // response would have handed the rest of the build back to a provider already proven ruinous.
    const four = fold(REPORT_CALLS.slice(0, 4));
    expect(slownessRatio(four)).toBeLessThan(SLOW_RUNG_RATIO_DEFAULT); // the dip is real…
    expect(isRungTooSlow(four)).toBe(true); // …and the verdict survives it
  });
});

describe('a HEALTHY provider is never retired — the property that makes this safe', () => {
  it('does not fire at the budgeted rate, however many calls and however long the build', () => {
    const healthy = Array.from({ length: 20 }, () => ({ outputTokens: 2000, observedMs: expectedMsForOutput(2000) }));
    const state = fold(healthy);
    expect(state.observedMs).toBeGreaterThan(SLOW_RUNG_MIN_OBSERVED_MS);
    expect(slownessRatio(state)).toBeCloseTo(1, 5);
    expect(isRungTooSlow(state)).toBe(false);
  });

  it('does not fire at twice the budgeted rate — 2.5x is a wide margin on purpose', () => {
    const state = fold(Array.from({ length: 5 }, () => ({ outputTokens: 2000, observedMs: expectedMsForOutput(2000) * 2 })));
    expect(isRungTooSlow(state)).toBe(false);
  });

  it('is not dragged over the line by ONE bad call among many good ones', () => {
    const state = fold([
      ...Array.from({ length: 9 }, () => ({ outputTokens: 2000, observedMs: expectedMsForOutput(2000) })),
      { outputTokens: 2000, observedMs: expectedMsForOutput(2000) * 12 },
    ]);
    expect(isRungTooSlow(state)).toBe(false);
  });
});

describe('a turn we cannot measure is DISCARDED, never guessed at', () => {
  it('ignores a turn the provider reported no usage for (measured: false)', () => {
    // The exact shape a stream produces when include_usage is not honoured: 0 tokens, huge latency.
    // Counted, it would score 60x and retire a healthy vendor on a number nobody measured.
    const state = fold([
      { outputTokens: 0, observedMs: 300_000, measured: false },
      { outputTokens: 0, observedMs: 300_000, measured: false },
      { outputTokens: 0, observedMs: 300_000, measured: false },
    ]);
    expect(state).toEqual(EMPTY_SLOW_RUNG_STATE);
    expect(isRungTooSlow(state)).toBe(false);
  });

  it('ignores a measured turn that produced no output tokens at all', () => {
    expect(fold([{ outputTokens: 0, observedMs: 300_000 }])).toEqual(EMPTY_SLOW_RUNG_STATE);
  });

  it('ignores a non-finite or negative observation rather than poisoning the running total', () => {
    const state = fold([
      { outputTokens: 1000, observedMs: Number.NaN },
      { outputTokens: 1000, observedMs: -5 },
      { outputTokens: Number.NaN, observedMs: 1000 },
    ]);
    expect(state).toEqual(EMPTY_SLOW_RUNG_STATE);
  });
});

describe('the two thresholds that keep one unlucky moment from retiring a provider', () => {
  it('needs a real sample — two calls at 10x still do not fire', () => {
    const state = fold(Array.from({ length: 2 }, () => ({ outputTokens: 2000, observedMs: expectedMsForOutput(2000) * 10 })));
    expect(state.calls).toBeLessThan(SLOW_RUNG_MIN_CALLS);
    expect(isRungTooSlow(state)).toBe(false);
  });

  it('needs the rung to have actually cost the build time — tiny slow calls do not fire', () => {
    const state = fold(Array.from({ length: 3 }, () => ({ outputTokens: 50, observedMs: 25_000 })));
    expect(slownessRatio(state)).toBeGreaterThan(SLOW_RUNG_RATIO_DEFAULT);
    expect(state.observedMs).toBeLessThan(SLOW_RUNG_MIN_OBSERVED_MS);
    expect(isRungTooSlow(state)).toBe(false); // 3.8x of almost nothing is still almost nothing
  });
});

describe('configuration fails toward KEEPING a provider, never toward retiring one', () => {
  it('falls back to the default on junk', () => {
    for (const bad of ['', '   ', 'fast', 'NaN', '2.5x']) {
      process.env.AGENTV3_SLOW_RUNG_RATIO = bad;
      expect(slowRungRatio()).toBe(SLOW_RUNG_RATIO_DEFAULT);
    }
  });

  it('REFUSES a ratio of 1 or below — at 1.0 it would retire every provider on earth', () => {
    for (const dangerous of ['1', '0', '0.5', '-3']) {
      process.env.AGENTV3_SLOW_RUNG_RATIO = dangerous;
      expect(slowRungRatio()).toBe(SLOW_RUNG_RATIO_DEFAULT);
    }
    // ...and proves the point: a healthy 1.0x rung survives whatever the operator typed.
    process.env.AGENTV3_SLOW_RUNG_RATIO = '1';
    expect(isRungTooSlow(fold(Array.from({ length: 5 }, () => ({ outputTokens: 2000, observedMs: expectedMsForOutput(2000) }))))).toBe(false);
  });

  it('accepts a deliberate widening', () => {
    process.env.AGENTV3_SLOW_RUNG_RATIO = '5';
    expect(slowRungRatio()).toBe(5);
    expect(isRungTooSlow(fold(REPORT_CALLS.slice(0, 3)))).toBe(false); // 3.4x no longer crosses 5x
  });

  it('refuses a minimum sample below 2, and accepts a larger one', () => {
    process.env.AGENTV3_SLOW_RUNG_MIN_CALLS = '1';
    expect(slowRungMinCalls()).toBe(SLOW_RUNG_MIN_CALLS);
    process.env.AGENTV3_SLOW_RUNG_MIN_CALLS = '6';
    expect(slowRungMinCalls()).toBe(6);
    expect(isRungTooSlow(fold(REPORT_CALLS.slice(0, 3)))).toBe(false);
  });

  it('is ON by default and OFF reverts to the pre-2026-09-16 behaviour exactly', () => {
    expect(slowRungBenchEnabled()).toBe(true);
    expect(isRungTooSlow(fold(REPORT_CALLS))).toBe(true);
    process.env.AGENTV3_SLOW_RUNG_BENCH = 'off';
    expect(slowRungBenchEnabled()).toBe(false);
    expect(isRungTooSlow(fold(REPORT_CALLS))).toBe(false);
  });
});

describe('describeSlowRung — one sentence, two outcomes, no string surgery between them', () => {
  const state = fold(REPORT_CALLS.slice(0, 3));

  it('says what actually happened, and the two outcomes never bleed into each other', () => {
    const skipped = describeSlowRung(state, 'glm-5.3-flash', 'skipped');
    const kept = describeSlowRung(state, 'glm-5.3-flash', 'kept');
    expect(skipped).toContain('skipped for the rest of this build');
    expect(skipped).not.toContain('KEPT anyway');
    expect(kept).toContain('KEPT anyway');
    // The guard: the first version built `kept` by regex-stripping `skipped`, so a reworded tail
    // would have produced a line claiming both at once.
    expect(kept).not.toContain('skipped');
  });

  it('carries the numbers an admin needs to check the verdict', () => {
    const line = describeSlowRung(state, 'glm-5.3-flash', 'skipped');
    expect(line).toContain('glm-5.3-flash');
    expect(line).toContain('3.4×');
    expect(line).toContain('over 3 calls');
  });
});

describe('canBenchAnother — slowness may never empty the ladder', () => {
  it('always leaves one survivor, whatever the chain length', () => {
    expect(canBenchAnother(0, 1)).toBe(false); // a single-rung chain is never retired
    expect(canBenchAnother(0, 2)).toBe(true);
    expect(canBenchAnother(1, 2)).toBe(false);
    expect(canBenchAnother(2, 4)).toBe(true);
    expect(canBenchAnother(3, 4)).toBe(false);
  });
});

// ─────────────────────────── the behaviour, through the real runner ───────────────────────────

const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };

function turn(text: string, outputTokens: number): TurnResult {
  return {
    text, toolUses: [], stopReason: 'end_turn', rawContent: [{ type: 'text', text }],
    usage: { inputTokens: 10, outputTokens, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  };
}

describe('MultiProviderTurnRunner — a slow rung is stepped past, a slow LAST rung is not', () => {
  beforeEach(() => sharedRateLimitCooldowns.reset());

  /** A runner that succeeds while consuming `ms` of the injected clock. */
  function timed(text: string, outputTokens: number, ms: number, clock: { t: number }): TurnRunner {
    return { runTurn: vi.fn(async () => { clock.t += ms; return turn(text, outputTokens); }) };
  }

  it('reaches the next vendor after three slow successes — the build dd1f5f60 could not', async () => {
    const clock = { t: 0 };
    const slow = timed('from glm', 1500, 280_000, clock); // ~5.6x budgeted
    const fast = timed('from kimi', 1500, 45_000, clock);
    const benched: Array<[string, string]> = [];
    const chain: NamedRunner[] = [
      { name: 'GLM', runner: slow, modelId: 'glm-5.3-flash' },
      { name: 'KIMI', runner: fast, modelId: 'kimi-k2.7-code' },
    ];
    const runner = makeMultiProviderTurnRunner(chain, {
      now: () => clock.t,
      onProviderBenched: (n, why) => { benched.push([n, why]); },
    });

    for (let i = 0; i < 3; i++) expect((await runner.runTurn(PARAMS)).text).toBe('from glm');
    expect(benched.map(([n]) => n)).toEqual(['GLM']);
    expect(benched[0][1]).toContain('glm-5.3-flash');
    expect(benched[0][1]).toContain('slower than budgeted');

    // The turn that used to keep grinding GLM now lands on the vendor that was one rung away.
    expect((await runner.runTurn(PARAMS)).text).toBe('from kimi');
    expect(slow.runTurn).toHaveBeenCalledTimes(3); // never called again
    expect(fast.runTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps a slow rung when it is the LAST engine — a slow app beats no app', async () => {
    const clock = { t: 0 };
    const slow = timed('from glm', 1500, 280_000, clock);
    const benched: Array<[string, string]> = [];
    const runner = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: slow, modelId: 'glm-5.3-flash' }],
      { now: () => clock.t, onProviderBenched: (n, why) => { benched.push([n, why]); } },
    );

    for (let i = 0; i < 5; i++) expect((await runner.runTurn(PARAMS)).text).toBe('from glm');
    expect(slow.runTurn).toHaveBeenCalledTimes(5);
    // It is REPORTED once — the admin must be able to see we knew — and never repeated per call.
    expect(benched).toHaveLength(1);
    expect(benched[0][1]).toContain('KEPT anyway');
  });

  it('retires by FAMILY+MODEL, so a key pool benches once and a sibling model survives', async () => {
    const clock = { t: 0 };
    const k1 = timed('glm key 1', 1500, 280_000, clock);
    const k2 = timed('glm key 2', 1500, 280_000, clock);
    const strong = timed('glm strong', 1500, 45_000, clock);
    const chain: NamedRunner[] = [
      { name: 'GLM', reportAs: 'GLM', runner: k1, modelId: 'glm-5.3-flash' },
      { name: 'GLM#2', reportAs: 'GLM', runner: k2, modelId: 'glm-5.3-flash' },
      { name: 'GLM#3', reportAs: 'GLM', runner: strong, modelId: 'glm-5.3' },
    ];
    const runner = makeMultiProviderTurnRunner(chain, { now: () => clock.t });

    for (let i = 0; i < 3; i++) await runner.runTurn(PARAMS);
    // Both flash KEYS share one verdict (they are one service running one model)...
    const after = await runner.runTurn(PARAMS);
    expect(after.text).toBe('glm strong');
    expect(k2.runTurn).not.toHaveBeenCalled();
    // ...and the same vendor's DIFFERENT model, a later rung of the weak ladder, is untouched.
    expect(strong.runTurn).toHaveBeenCalledTimes(1);
  });

  it('never judges a provider that reports no usage — the streamed-without-include_usage case', async () => {
    const clock = { t: 0 };
    const unmeasured: TurnRunner = {
      runTurn: vi.fn(async () => {
        clock.t += 300_000;
        const t = turn('from glm', 0);
        return { ...t, usage: { ...t.usage, measured: false } };
      }),
    };
    const fast = timed('from kimi', 1500, 45_000, clock);
    const runner = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: unmeasured, modelId: 'glm-5.3-flash' }, { name: 'KIMI', runner: fast }],
      { now: () => clock.t },
    );

    for (let i = 0; i < 5; i++) expect((await runner.runTurn(PARAMS)).text).toBe('from glm');
    expect(fast.runTurn).not.toHaveBeenCalled(); // no measurement ⇒ no verdict ⇒ no action
  });

  it('OFF restores the old behaviour: the slow rung keeps every turn', async () => {
    process.env.AGENTV3_SLOW_RUNG_BENCH = 'off';
    const clock = { t: 0 };
    const slow = timed('from glm', 1500, 280_000, clock);
    const fast = timed('from kimi', 1500, 45_000, clock);
    const runner = makeMultiProviderTurnRunner(
      [{ name: 'GLM', runner: slow, modelId: 'glm-5.3-flash' }, { name: 'KIMI', runner: fast }],
      { now: () => clock.t },
    );
    for (let i = 0; i < 6; i++) expect((await runner.runTurn(PARAMS)).text).toBe('from glm');
    expect(fast.runTurn).not.toHaveBeenCalled();
  });
});
