import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { orderChatByHealth, chatTrafficEnabled } from './chatTrafficOrder';
import { noteProviderCall, providerInFlight, resetTrafficHealthForTests, TRAFFIC_RECOVERY_MS } from './trafficHealth';

afterEach(() => {
  resetTrafficHealthForTests();
  delete process.env.AGENTV3_CHAT_TRAFFIC;
});

const rung = (id: string, provider: string, priceIn: number | null) => ({ id, provider, priceIn });

describe('AI Chat health order', () => {
  it('is on unless the kill switch says off', () => {
    expect(chatTrafficEnabled()).toBe(true);
    expect(chatTrafficEnabled({ AGENTV3_CHAT_TRAFFIC: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps the ladder when nothing has been measured', () => {
    const order = [rung('glm47', 'GLM', 0), rung('groq', 'GROQ', 0), rung('deepseek', 'DEEPSEEK', 0.1)];
    expect(orderChatByHealth(order).map((row) => row.id)).toEqual(['glm47', 'groq', 'deepseek']);
  });

  it('moves a suspended rung behind the healthy ones and does not open its recovery probe', () => {
    noteProviderCall({ provider: 'GROQ', surface: 'chat', ok: false, error: new Error('account is suspended due to insufficient balance'), at: 1_000 });
    const order = [rung('groq', 'GROQ', 0), rung('glm47', 'GLM', 0)];
    expect(orderChatByHealth(order, 1_000).map((row) => row.id)).toEqual(['glm47', 'groq']);
    expect(orderChatByHealth(order, 1_000 + TRAFFIC_RECOVERY_MS).map((row) => row.id)).toEqual(['groq', 'glm47']);
  });

  it('among one price, prefers the faster rung and then the less loaded one', () => {
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: true, totalMs: 900, at: 1 });
    noteProviderCall({ provider: 'GROQ', surface: 'chat', ok: true, totalMs: 200, at: 2 });
    const order = [rung('glm47', 'GLM', 0), rung('groq', 'GROQ', 0), rung('deepseek', 'DEEPSEEK', 0.2)];
    expect(orderChatByHealth(order).map((row) => row.id)).toEqual(['groq', 'glm47', 'deepseek']);
    resetTrafficHealthForTests();
    providerInFlight('GLM', 1);
    providerInFlight('GROQ', 4);
    expect(orderChatByHealth([rung('glm47', 'GLM', 0), rung('groq', 'GROQ', 0)]).map((row) => row.id)).toEqual(['glm47', 'groq']);
  });

  it('never puts a paid rung ahead of a free one', () => {
    noteProviderCall({ provider: 'DEEPSEEK', surface: 'chat', ok: true, totalMs: 50, at: 1 });
    noteProviderCall({ provider: 'GLM', surface: 'chat', ok: true, totalMs: 800, at: 2 });
    expect(orderChatByHealth([rung('glm47', 'GLM', 0), rung('deepseek', 'DEEPSEEK', 0.14)]).map((row) => row.id)).toEqual(['glm47', 'deepseek']);
  });

  it('a failed chat rung retries the same trimmed history', () => {
    const source = readFileSync('src/server/AI/FreeChain/runtime.ts', 'utf8');
    const uses = source.match(/trimForRung\(input\.message, history,/g) ?? [];
    expect(uses.length).toBeGreaterThan(1);
    expect(source).toContain('const history = historyForChain(cfg, input.history)');
    expect(source).toContain('orderChatByHealth');
  });
});
