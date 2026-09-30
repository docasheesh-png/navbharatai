// Autopsy 876afca9 (2026-09-30, "Create a calculation app", Weak) — open item closed. GLM flashx answered
// the plan in 2.4 s, crawled ONCE on the contract, and was benched for the whole build: every later call
// went to the reasoning rung for ten minutes. A crawl bench now lasts a window (default 180 s); the rung is
// re-probed once, and only a second crawl benches it for the rest of the build. The throughput bench
// (three measured calls, latched) is untouched.
import { describe, it, expect } from 'vitest';
import {
  crawlBenchWindowMs, mayAbandonCrawl, crawlBenchUntil, CRAWL_BENCH_DEFAULT_SECONDS,
} from '../src/server/AgentV3/crawlBench';
import { makeMultiProviderTurnRunner, createBuildBenchRegistry, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { SLOW_STREAM_MESSAGE } from '../src/server/AgentV3/turnDeadline';

describe('the window', () => {
  it('defaults to 180 s, clamps, and reads `off` as the old whole-build bench', () => {
    expect(crawlBenchWindowMs({})).toBe(CRAWL_BENCH_DEFAULT_SECONDS * 1000);
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: '600' })).toBe(600_000);
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: '5' })).toBe(30_000);
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: '99999' })).toBe(1_800_000);
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: 'off' })).toBeNull();
    // Unreadable is never "for ever" and never "zero": it is the default.
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: '3m' })).toBe(180_000);
    expect(crawlBenchWindowMs({ AGENTV3_CRAWL_BENCH_SECONDS: '' })).toBe(180_000);
  });

  it('first abandon benches for the window; the second for the build', () => {
    expect(crawlBenchUntil(1, 1_000, 180_000)).toBe(181_000);
    expect(crawlBenchUntil(2, 1_000, 180_000)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlBenchUntil(1, 1_000, null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('who may be abandoned', () => {
  const base = { hasNextRung: true, abandonsSoFar: 0, abandonsOfThisRung: 0, isReprobe: false, windowMs: 180_000 };
  it('never the last engine', () => {
    expect(mayAbandonCrawl({ ...base, hasNextRung: false })).toBe(false);
  });
  it('the first crawl of the build', () => {
    expect(mayAbandonCrawl(base)).toBe(true);
  });
  it('a second time only the RE-PROBE of the same rung — never a concurrent call, never another rung', () => {
    expect(mayAbandonCrawl({ ...base, abandonsSoFar: 1, abandonsOfThisRung: 1, isReprobe: true })).toBe(true);
    expect(mayAbandonCrawl({ ...base, abandonsSoFar: 1, abandonsOfThisRung: 1, isReprobe: false })).toBe(false);
    expect(mayAbandonCrawl({ ...base, abandonsSoFar: 1, abandonsOfThisRung: 0, isReprobe: false })).toBe(false);
  });
  it('never a third', () => {
    expect(mayAbandonCrawl({ ...base, abandonsSoFar: 2, abandonsOfThisRung: 2, isReprobe: true })).toBe(false);
  });
  it('`off` keeps the old once-per-build rule', () => {
    expect(mayAbandonCrawl({ ...base, windowMs: null })).toBe(true);
    expect(mayAbandonCrawl({ ...base, windowMs: null, abandonsSoFar: 1, abandonsOfThisRung: 1, isReprobe: true })).toBe(false);
  });
});

describe('the runner, end to end', () => {
  const params = { model: 'x', system: '', messages: [], tools: [], maxTokens: 10 } as never;
  const ok = (who: string) => ({ text: `from ${who}`, toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } });

  function ladder(calls: string[], glmCrawls: () => boolean): NamedRunner[] {
    return [
      {
        name: 'GLM', reportAs: 'GLM', modelId: 'glm-4.7-flashx',
        runner: { runTurn: async (p: { canAbandonSlowStream?: () => boolean }) => {
          calls.push('GLM');
          if (glmCrawls() && p.canAbandonSlowStream?.()) throw new Error(SLOW_STREAM_MESSAGE);
          return ok('GLM');
        } },
      },
      { name: 'KIMI', reportAs: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => { calls.push('KIMI'); return ok('KIMI'); } } },
    ] as unknown as NamedRunner[];
  }

  it('🔴 the calculator: one crawl, then GLM is back after the window and serves the build again', async () => {
    let t = 0;
    let crawling = true;
    const calls: string[] = [];
    const benched: string[] = [];
    const bench = createBuildBenchRegistry();
    const r = makeMultiProviderTurnRunner(ladder(calls, () => crawling), { bench, now: () => t, onProviderBenched: (_f, why) => benched.push(why) });

    expect((await r.runTurn(params)).text).toBe('from KIMI'); // GLM crawled, abandoned, KIMI answered
    expect(benched[0]).toMatch(/skipped for 180s, then tried once more/);
    t = 60_000;
    expect((await r.runTurn(params)).text).toBe('from KIMI'); // still inside the window: GLM is not asked
    expect(calls.filter((c) => c === 'GLM').length).toBe(1);

    crawling = false; // the weather cleared
    t = 181_000;
    expect((await r.runTurn(params)).text).toBe('from GLM'); // re-probed, and it answers
    expect((await r.runTurn(params)).text).toBe('from GLM');
  });

  it('a rung that crawls AGAIN on its re-probe is benched for the rest of the build', async () => {
    let t = 0;
    const calls: string[] = [];
    const benched: string[] = [];
    const r = makeMultiProviderTurnRunner(ladder(calls, () => true), { bench: createBuildBenchRegistry(), now: () => t, onProviderBenched: (_f, why) => benched.push(why) });
    await r.runTurn(params);
    t = 181_000;
    expect((await r.runTurn(params)).text).toBe('from KIMI'); // re-probe crawled too
    expect(benched[1]).toMatch(/rest of this build \(it crawled again when tried once more\)/);
    t = 10_000_000;
    await r.runTurn(params);
    expect(calls.filter((c) => c === 'GLM').length).toBe(2); // never a third attempt
  });

  it('`off` restores the whole-build bench exactly', async () => {
    const prev = process.env.AGENTV3_CRAWL_BENCH_SECONDS;
    process.env.AGENTV3_CRAWL_BENCH_SECONDS = 'off';
    try {
      let t = 0;
      const calls: string[] = [];
      const r = makeMultiProviderTurnRunner(ladder(calls, () => true), { bench: createBuildBenchRegistry(), now: () => t });
      await r.runTurn(params);
      t = 10_000_000;
      expect((await r.runTurn(params)).text).toBe('from KIMI');
      expect(calls.filter((c) => c === 'GLM').length).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_CRAWL_BENCH_SECONDS; else process.env.AGENTV3_CRAWL_BENCH_SECONDS = prev;
    }
  });
});
