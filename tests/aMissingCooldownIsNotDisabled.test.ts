import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimitCooldownMs, type RateLimitCooldowns } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

let activeCooldowns: RateLimitCooldowns | undefined;
afterEach(() => {
  activeCooldowns?.reset();
  activeCooldowns = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function freshProductionRunner(raw?: string) {
  vi.stubEnv('AGENTV3_RATE_LIMIT_COOLDOWN_MS', raw);
  vi.stubEnv('AGENTV3_RATE_LIMIT_BENCH_AFTER', undefined);
  vi.stubEnv('AGENTV3_RATE_LIMIT_COOLDOWN_MAX_MS', undefined);
  // Isolate the short cooldown, rather than accidentally proving the separate sustained breaker.
  vi.stubEnv('AGENTV3_CIRCUIT_BREAKER', 'off');
  vi.resetModules();
  const runner = await import('../src/server/AgentV3/providers/MultiProviderTurnRunner');
  activeCooldowns = runner.sharedRateLimitCooldowns;
  activeCooldowns.reset();
  return runner;
}

describe('missing shared cooldown configuration is not an explicit disable', () => {
  it.each([
    [undefined, 60_000], ['', 60_000], [' \t\n', 60_000],
    ['0', 0], [' 0 ', 0], ['off', 0], [' OFF ', 0],
    ['60000', 60_000], ['1250', 1250], ['1.5', 1.5],
    ['bad', 60_000], ['-1', 60_000], ['Infinity', 60_000],
  ])('resolves %s to %s milliseconds without changing explicit overrides', (raw, expected) => {
    expect(rateLimitCooldownMs(raw === undefined ? {} : { AGENTV3_RATE_LIMIT_COOLDOWN_MS: raw })).toBe(expected);
  });

  describe.each(['429 Rate limit reached for requests', 'OpenAI-compatible call (GLM/Kimi) timed out after 60000ms'])('%s', failure => {
    it.each([undefined, '', ' \t ', '0', 'off'])('the production singleton honors %s across fresh runners', async raw => {
      const { makeMultiProviderTurnRunner, sharedRateLimitCooldowns } = await freshProductionRunner(raw);
      const result: TurnResult = { text: 'ok', toolUses: [], stopReason: 'end_turn', rawContent: [],
        usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
      const failed: TurnRunner = { runTurn: vi.fn().mockRejectedValue(new Error(failure)) };
      const recovered: TurnRunner = { runTurn: vi.fn().mockResolvedValue(result) };
      const backstop: TurnRunner = { runTurn: vi.fn().mockResolvedValue({ ...result, text: 'backstop' }) };
      let clock = 1_000_000;
      const first = makeMultiProviderTurnRunner([{ name: 'GLM', runner: failed }, { name: 'CLAUDE', runner: backstop }], { now: () => clock });
      await first.runTurn({ model: 'test', messages: [] });
      const enabled = raw !== '0' && raw !== 'off';
      expect(sharedRateLimitCooldowns.until('GLM')).toBe(enabled ? clock + 60_000 : 0);
      const next = makeMultiProviderTurnRunner([{ name: 'GLM', runner: recovered }, { name: 'CLAUDE', runner: backstop }], { now: () => clock });
      expect((await next.runTurn({ model: 'test', messages: [] })).text).toBe(enabled ? 'backstop' : 'ok');
      expect(recovered.runTurn).toHaveBeenCalledTimes(enabled ? 0 : 1);
      if (enabled) {
        clock += 59_999;
        expect((await next.runTurn({ model: 'test', messages: [] })).text).toBe('backstop');
        clock++;
        expect((await next.runTurn({ model: 'test', messages: [] })).text).toBe('ok');
        expect(recovered.runTurn).toHaveBeenCalledTimes(1);
        expect(sharedRateLimitCooldowns.until('GLM')).toBe(0);
      }
      expect(failed.runTurn).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    ['OpenAI-compatible call (GLM/Kimi) timed out after 60000ms', true],
    ['429 service may be temporarily overloaded', true],
    ['429 Rate limit reached for requests', false],
  ] as const)('default-on scope for %s: pool-wide = %s', async (failure, poolWide) => {
    const { makeMultiProviderTurnRunner, sharedRateLimitCooldowns } = await freshProductionRunner();
    const result: TurnResult = { text: 'healthy', toolUses: [], stopReason: 'end_turn', rawContent: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
    const fail = { runTurn: vi.fn().mockRejectedValue(new Error(failure)) };
    const sameModel = { runTurn: vi.fn().mockResolvedValue(result) };
    const otherModel = { runTurn: vi.fn().mockResolvedValue(result) };
    const otherFamily = { runTurn: vi.fn().mockResolvedValue({ ...result, text: 'other family' }) };
    let clock = 1_000_000;
    const chain = [
      { name: 'GLM', modelId: 'model-a', runner: fail },
      { name: 'GLM#2', reportAs: 'GLM', modelId: 'model-a', runner: sameModel },
      { name: 'GLM#3', reportAs: 'GLM', modelId: 'model-b', runner: otherModel },
      { name: 'PROXY', modelId: 'model-a', runner: otherFamily },
    ];
    const options = { now: () => clock, deadRungs: new Map<string, string>() };
    const params = { model: 'test', messages: [] };
    expect((await makeMultiProviderTurnRunner(chain, options).runTurn(params)).text).toBe(poolWide ? 'other family' : 'healthy');
    expect(sharedRateLimitCooldowns.until('GLM')).toBe(clock + 60_000);
    expect(sharedRateLimitCooldowns.until('pool:GLM')).toBe(poolWide ? clock + 60_000 : 0);
    expect(sameModel.runTurn).toHaveBeenCalledTimes(poolWide ? 0 : 1);
    expect(otherModel.runTurn).not.toHaveBeenCalled();
    expect(otherFamily.runTurn).toHaveBeenCalledTimes(poolWide ? 1 : 0);
    expect(options.deadRungs.size).toBe(0); // neither service saturation nor quota is starvation

    if (poolWide) {
      const nextFile = () => makeMultiProviderTurnRunner(chain.slice(1), options);
      clock += 59_999;
      expect((await nextFile().runTurn(params)).text).toBe('other family');
      expect(sameModel.runTurn).not.toHaveBeenCalled();
      clock++;
      expect((await nextFile().runTurn(params)).text).toBe('healthy');
      expect(sameModel.runTurn).toHaveBeenCalledTimes(1);
      expect(sharedRateLimitCooldowns.until('pool:GLM')).toBe(0);
    }
    expect(fail.runTurn).toHaveBeenCalledTimes(1);
  });
});
