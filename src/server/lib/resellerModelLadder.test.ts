/** Owner 2026-11-17: a reseller gateway tries up to three of its own models, cheapest-and-good first. */
import { describe, expect, it, vi } from 'vitest';
import { resellerGatewayState, resellerModelLadder, RESELLER_MODEL_LADDER_MAX } from './resellerGateways';

const ready = (env: NodeJS.ProcessEnv) => {
  const state = resellerGatewayState('discountedtokens', { DISCOUNTEDTOKENS_API_KEY: 'k', ...env });
  if (!state.ready) throw new Error('not ready');
  return state;
};

describe('resellerModelLadder', () => {
  it('keeps the owner-listed order first, de-duplicates, fills from the key list, stops at three', async () => {
    const list = vi.fn(async () => ({ models: ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-nova'] }));
    expect(await resellerModelLadder(ready({ DISCOUNTEDTOKENS_MODEL: 'gpt-6-luna, gpt-6-sol' }), list)).toEqual(['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra']);
    expect(RESELLER_MODEL_LADDER_MAX).toBe(3);
  });

  it('with no owner list it starts with the default model (gpt-6-sol)', async () => {
    const list = vi.fn(async () => ({ models: ['gpt-6-astra', 'gpt-6-sol'] }));
    expect(await resellerModelLadder(ready({}), list)).toEqual(['gpt-6-sol', 'gpt-6-astra']);
  });

  it('three owner-listed models need no list call; a failing list keeps what the owner named', async () => {
    const list = vi.fn(async () => ({ models: ['x'] }));
    expect(await resellerModelLadder(ready({ DISCOUNTEDTOKENS_MODEL: 'a,b,c,d' }), list)).toEqual(['a', 'b', 'c']);
    expect(list).not.toHaveBeenCalled();
    const broken = vi.fn(async () => { throw new Error('list down'); });
    expect(await resellerModelLadder(ready({ DISCOUNTEDTOKENS_MODEL: 'a' }), broken)).toEqual(['a']);
  });

  it('the first listed model is still the one the status row shows', () => {
    expect(ready({ DISCOUNTEDTOKENS_MODEL: 'gpt-6-luna,gpt-6-sol' }).model).toBe('gpt-6-luna');
  });
});
