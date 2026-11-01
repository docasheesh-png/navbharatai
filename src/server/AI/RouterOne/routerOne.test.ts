import { describe, it, expect } from 'vitest';
import { routerOnePinnedFor, routerOnePublicFallbackEnabled, routerOneModels, routerOneBaseUrl, ROUTER_ONE_DEFAULT_BASE_URL } from './routerOne';

describe('Router One routing flags', () => {
  it('pins z@gmail.com only (no flag needed), kill-switch ROUTER_ONE_PIN=off', () => {
    expect(routerOnePinnedFor('z@gmail.com', null, {})).toBe(true);
    expect(routerOnePinnedFor(' Z@Gmail.com ', null, {})).toBe(true);
    expect(routerOnePinnedFor('someone@gmail.com', null, {})).toBe(false);
    expect(routerOnePinnedFor('z@gmail.com', null, { ROUTER_ONE_PIN: 'off' })).toBe(false);
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
