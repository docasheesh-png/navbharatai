import { describe, it, expect } from 'vitest';
import { routerOnePinnedFor, routerOnePublicFallbackEnabled, routerOneModels, routerOneBaseUrl, ROUTER_ONE_DEFAULT_BASE_URL } from './routerOne';

describe('Router One routing flags', () => {
  it('no profile pin: z@gmail.com routes same as any user (2026-11-02)', () => {
    for (const env of [{}, { ROUTER_ONE_PIN: 'on' }, { ROUTER_ONE_PIN: 'off' }] as NodeJS.ProcessEnv[]) {
      expect(routerOnePinnedFor('z@gmail.com', null, env)).toBe(false);
      expect(routerOnePinnedFor(' Z@Gmail.com ', 'GiYNmFcDMVYSWW48Nrurm7j41gv1', env)).toBe(false);
      expect(routerOnePinnedFor('someone@gmail.com', null, env)).toBe(false);
      expect(routerOnePinnedFor('z@gmail.com', null, env)).toBe(routerOnePinnedFor('someone@gmail.com', null, env));
    }
  });
  it('public fallback needs flag ON and a key; default OFF', () => {
    expect(routerOnePublicFallbackEnabled({})).toBe(false);
    expect(routerOnePublicFallbackEnabled({ ROUTER_ONE_API_KEY: 'k' })).toBe(false);
    expect(routerOnePublicFallbackEnabled({ ROUTER_ONE_ENABLED: 'on' })).toBe(false);
    expect(routerOnePublicFallbackEnabled({ ROUTER_ONE_ENABLED: 'on', ROUTER_ONE_API_KEY: 'k' })).toBe(true);
  });
  it('models list + base url defaults', () => {
    expect(routerOneModels({ ROUTER_ONE_MODEL: 'a, b' })).toEqual(['a', 'b']);
    expect(routerOneModels({}).length).toBe(1);
    expect(routerOneBaseUrl({})).toBe(ROUTER_ONE_DEFAULT_BASE_URL);
  });
});
