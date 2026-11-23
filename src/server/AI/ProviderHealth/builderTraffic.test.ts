import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { builderTrafficEnabled, orderBuilderRungs } from './builderTraffic';
import { noteProviderCall, resetTrafficHealthForTests } from './trafficHealth';

afterEach(() => resetTrafficHealthForTests());

describe('builder ladder health order', () => {
  it('is on unless the kill switch says off', () => {
    expect(builderTrafficEnabled()).toBe(true);
    expect(builderTrafficEnabled({ AGENTV3_BUILDER_TRAFFIC: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('keeps a dearer rung behind a cheaper one', () => {
    const order = [
      { provider: 'GLM', model: 'glm-4.7-flashx' },
      { provider: 'KIMI', model: 'kimi-k2.7-code' },
      { provider: 'GLM', model: 'glm-5.3' },
    ];
    const priced = orderBuilderRungs(order).map((rung) => rung.model);
    const flash = priced.indexOf('glm-4.7-flashx');
    const flagship = priced.indexOf('glm-5.3');
    expect(flash).toBeGreaterThanOrEqual(0);
    expect(flagship).toBeGreaterThan(flash);
  });

  it('moves a suspended rung to the end of the tier', () => {
    noteProviderCall({ provider: 'GLM', surface: 'builder', ok: false, error: new Error('account is suspended due to insufficient balance'), at: 1_000 });
    const ordered = orderBuilderRungs([
      { provider: 'GLM', model: 'glm-4.7-flashx' },
      { provider: 'KIMI', model: 'kimi-k2.7-code' },
    ], 1_000);
    expect(ordered.map((rung) => rung.provider)).toEqual(['KIMI', 'GLM']);
  });

  it('the tier ladder is ordered before runners are built, and the kill switch is the gate', () => {
    const source = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(source).toContain('if (builderTrafficEnabled()) rungs = orderBuilderRungs(rungs);');
  });
});
