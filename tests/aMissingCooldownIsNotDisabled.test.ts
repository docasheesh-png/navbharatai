import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimitCooldownMs } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnResult, TurnRunner } from '../src/server/AgentV3/ClaudeClient';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('missing shared cooldown configuration is not an explicit disable', () => {
  it.each([
    [undefined, 60_000], ['', 60_000], [' \t\n', 60_000],
    ['0', 0], [' 0 ', 0], ['off', 0], [' OFF ', 0],
    ['60000', 60_000], ['1250', 1250], ['1.5', 1.5],
    ['bad', 60_000], ['-1', 60_000], ['Infinity', 60_000],
  ])('resolves %s to %s milliseconds without changing explicit overrides', (raw, expected) => {
    expect(rateLimitCooldownMs(raw === undefined ? {} : { AGENTV3_RATE_LIMIT_COOLDOWN_MS: raw })).toBe(expected);
  });

  it.each([undefined, '', ' \t ', '0', 'off'])('the production singleton honors %s across fresh runners', async raw => {
    vi.stubEnv('AGENTV3_RATE_LIMIT_COOLDOWN_MS', raw);
    vi.stubEnv('AGENTV3_RATE_LIMIT_BENCH_AFTER', undefined);
    vi.stubEnv('AGENTV3_RATE_LIMIT_COOLDOWN_MAX_MS', undefined);
    // Isolate the short cooldown, rather than accidentally proving the separate sustained breaker.
    vi.stubEnv('AGENTV3_CIRCUIT_BREAKER', 'off');
    vi.resetModules();
    const { makeMultiProviderTurnRunner, sharedRateLimitCooldowns } =
      await import('../src/server/AgentV3/providers/MultiProviderTurnRunner');
    sharedRateLimitCooldowns.reset();
    const result: TurnResult = { text: 'ok', toolUses: [], stopReason: 'end_turn', rawContent: [],
      usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } };
    const failed: TurnRunner = { runTurn: vi.fn().mockRejectedValue(new Error('429 Rate limit reached for requests')) };
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
    sharedRateLimitCooldowns.reset();
  });
});
