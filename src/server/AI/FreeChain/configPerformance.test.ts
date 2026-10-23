import { describe, expect, it, vi } from 'vitest';
import { freeChainConfig } from './config';
describe('configuration timezone validation is independent of per-request quota windows', () => {
  it('does not recompute civil-day boundaries for the same unchanged timezone', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const env = { FREE_CHAIN_GEMINI_TIME_ZONE: 'Europe/Paris' };
    const started = performance.now(); freeChainConfig(env); const warm = spy.mock.calls.length;
    for (let i = 0; i < 100; i++) freeChainConfig(env);
    const repeated = spy.mock.calls.length - warm;
    console.info('[CONFIG_PROFILE]', JSON.stringify({ calls: 100, repeatedFormatOperations: repeated, elapsedMs: performance.now() - started }));
    spy.mockRestore(); expect(repeated).toBe(0);
    expect(freeChainConfig({ ...env, FREE_CHAIN_GEMINI_TIME_ZONE: 'invalid/zone' }).errors).toContain('FREE_CHAIN_GEMINI_TIME_ZONE');
  });
});
