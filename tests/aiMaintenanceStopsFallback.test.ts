import { afterEach, describe, expect, it, vi } from 'vitest';
const injected = vi.hoisted(() => ({ store: null as any }));
vi.mock('../src/server/lib/aiMaintenance', async original => {
  const actual = await original<typeof import('../src/server/lib/aiMaintenance')>();
  return {
    ...actual,
    aiMaintenanceStore: { recordFailure: (...args: [string, unknown]) => injected.store.recordFailure(...args) },
    assertAiAvailable: async () => { if ((await injected.store.read()).enabled) throw new actual.AiMaintenanceError(); },
  };
});
import { AiMaintenanceStore, MAINTENANCE_MESSAGE, maintenanceState } from '../src/server/lib/aiMaintenance';
import { OpenAiToolRunner } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import type { TurnResult } from '../src/server/AgentV3/ClaudeClient';
afterEach(() => vi.unstubAllEnvs());
describe('automatic pause stops the real provider ladder', () => {
  it('the third real Kimi quota refusal cannot fall through to a paid provider; resumed builds can run again', async () => {
    let state = maintenanceState({});
    injected.store = new AiMaintenanceStore(() => ({ read: async () => state, change: async fn => { state = fn(state); return state; } }));
    // Exercise the production error observer without any real provider or credentials.
    vi.stubEnv('VITEST', ''); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('AGENTV3_BUILD_STREAM', 'off');
    const create = vi.fn().mockRejectedValue(new Error('insufficient_quota: out of tokens'));
    const kimi = new OpenAiToolRunner({ chat: { completions: { create } } }, { model: 'kimi-k2.6' });
    const result: TurnResult = { text: 'paid answer', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }, rawContent: [] };
    const paid = { runTurn: vi.fn().mockResolvedValue(result) };
    const freshLadder = () => makeMultiProviderTurnRunner([{ name: 'KIMI', runner: kimi, modelId: 'kimi-k2.6' }, { name: 'CLAUDE', runner: paid }]);
    const params = { model: 'm', messages: [{ role: 'user' as const, content: 'hello' }] };
    for (let i = 0; i < 2; i++) expect((await freshLadder().runTurn(params)).text).toBe('paid answer');
    await expect(freshLadder().runTurn(params)).rejects.toThrow(MAINTENANCE_MESSAGE);
    expect(create).toHaveBeenCalledTimes(3); expect(paid.runTurn).toHaveBeenCalledTimes(2);
    await expect(freshLadder().runTurn(params)).rejects.toThrow(MAINTENANCE_MESSAGE);
    expect(create).toHaveBeenCalledTimes(3); expect(paid.runTurn).toHaveBeenCalledTimes(2);
    await injected.store.set({ enabled: false, autoEnabled: false });
    expect((await freshLadder().runTurn(params)).text).toBe('paid answer');
  });
});
