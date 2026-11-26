/**
 * THE SECONDS SURPLUS LOST ARE ON THE ROW OF THE ANSWER THAT REPLACED IT (Q-3465, failedbr #2525).
 *
 * The first deepseek call read latencyMs 83888, answerMs 4378, fallbackMs 0: ~79 s spent on Surplus failing was recorded
 * as zero. The chain sums its own failed attempts, but both Surplus wrappers sit OUTSIDE the chain — the pre-write
 * fail-open (pre-v2 Weak builds) and the Pro Chain V2 agent runner. Both now add the lost time with withEarlierFallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { wrapSurplusRunnerPreWriteFailOpen } from '../src/server/AI/SurplusRegistry/surplusPreWriteFailOpen';
import { createProChainV2AgentRunner, createProChainV2BuildState } from '../src/server/AgentV3/proChainV2/agentRunner';
import { withEarlierFallback } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { PublicBuildEngineError } from '../src/server/lib/buildEngineError';

vi.mock('../src/server/AI/SurplusRegistry/surplusAdmitCircuit', () => ({ recordSurplusMidBuildDeath: vi.fn(), recordSurplusAdmitProbeSuccess: vi.fn() }));

const answer = (fallbackMs?: number) => ({ text: 'ok', rawContent: [], toolUses: [], stopReason: 'end_turn', model: 'deepseek-v4.1-flash',
  usage: { inputTokens: 1, outputTokens: 1 }, ...(fallbackMs !== undefined ? { fallbackMs } : {}) });
const failsAfter = (ms: number) => ({ runTurn: () => new Promise<never>((_, reject) => setTimeout(() => reject(new PublicBuildEngineError()), ms)) });
const PARAMS = { model: 'm', messages: [], tools: [], maxTokens: 10 } as never;

describe('the rule', () => {
  it('adds the lost time to what the inner chain already counted; nothing lost changes nothing', () => {
    expect(withEarlierFallback(answer(2_000), 79_000).fallbackMs).toBe(81_000);
    expect(withEarlierFallback(answer(), 79_000).fallbackMs).toBe(79_000);
    expect(withEarlierFallback(answer(), 0)).toEqual(answer());
    expect(withEarlierFallback(answer(), Number.NaN)).toEqual(answer());
  });
});

describe('failedbr #2525 replayed — Surplus fails after 79 s, the next engine answers', () => {
  it('the pre-write fail-open puts the 79 s on the answer', async () => {
    vi.useFakeTimers();
    const runner = wrapSurplusRunnerPreWriteFailOpen(failsAfter(79_000) as never, () => ({ runTurn: async () => answer() }) as never,
      { state: { dropped: false }, userFilesWritten: () => 1 });
    const p = runner.runTurn(PARAMS);
    await vi.advanceTimersByTimeAsync(79_000);
    expect((await p).fallbackMs).toBe(79_000);
    vi.useRealTimers();
  });
  it('the Pro Chain V2 agent runner does the same', async () => {
    let t = 0;
    const runner = createProChainV2AgentRunner({
      agent: 'builder#1', state: createProChainV2BuildState(), env: {}, now: () => t, surplusRecoverable: () => true,
      surplus: { runTurn: async () => { t += 79_000; throw new PublicBuildEngineError(); } } as never,
      makeChain: () => ({ runTurn: async () => answer() }) as never,
      providers: [{ label: 'ENGINE_R1', rungs: [{ name: 'ENGINE_R1', runner: { runTurn: async () => answer() } as never, modelId: 'deepseek-v4.1-flash' }] }],
    });
    expect((await runner.runTurn(PARAMS)).fallbackMs).toBe(79_000);
  });
  it('a healthy Surplus turn carries no fallback time', async () => {
    const runner = wrapSurplusRunnerPreWriteFailOpen({ runTurn: async () => answer() } as never, () => ({ runTurn: async () => answer() }) as never,
      { state: { dropped: false }, userFilesWritten: () => 0 });
    expect((await runner.runTurn(PARAMS)).fallbackMs).toBeUndefined();
  });
});
