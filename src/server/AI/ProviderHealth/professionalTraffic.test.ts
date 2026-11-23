import { afterEach, describe, expect, it } from 'vitest';
import { orderProfessionalProviders, professionalTrafficEnabled } from './professionalTraffic';
import { noteProviderCall, resetTrafficHealthForTests } from './trafficHealth';

afterEach(() => resetTrafficHealthForTests());

const rung = (id: string, provider: string, priceIn: number | null, lastResort = false) => ({ id, provider, priceIn, lastResort });

describe('Professional AI health order', () => {
  it('is on unless the kill switch says off', () => {
    expect(professionalTrafficEnabled()).toBe(true);
    expect(professionalTrafficEnabled({ AGENTV3_PROFESSIONAL_TRAFFIC: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps the ladder and the last resort when nothing is unhealthy', () => {
    const order = [
      rung('grok', 'GROK', 3),
      rung('gemini', 'GEMINI', 0.15),
      rung('vertex', 'VERTEX', 0.15),
      rung('haiku', 'ANTHROPIC', 1, true),
    ];
    expect(orderProfessionalProviders(order).map((row) => row.id)).toEqual(['grok', 'gemini', 'vertex', 'haiku']);
  });

  it('tries healthy rungs before a suspended one, and still leaves the last resort last', () => {
    noteProviderCall({ provider: 'GROK', surface: 'professional', ok: false, error: new Error('account is suspended due to insufficient balance'), at: 1_000 });
    const order = [
      rung('grok', 'GROK', 3),
      rung('gemini', 'GEMINI', 0.15),
      rung('vertex', 'VERTEX', 0.15),
      rung('haiku', 'ANTHROPIC', 1, true),
    ];
    expect(orderProfessionalProviders(order, 1_000).map((row) => row.id)).toEqual(['gemini', 'vertex', 'grok', 'haiku']);
  });

  it('inside one price, prefers the faster rung', () => {
    noteProviderCall({ provider: 'VERTEX', surface: 'professional', ok: true, totalMs: 100, at: 1 });
    noteProviderCall({ provider: 'GEMINI', surface: 'professional', ok: true, totalMs: 400, at: 2 });
    const order = [rung('gemini', 'GEMINI', 0.15), rung('vertex', 'VERTEX', 0.15)];
    expect(orderProfessionalProviders(order).map((row) => row.id)).toEqual(['vertex', 'gemini']);
  });
});
