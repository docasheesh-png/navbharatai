import { describe, expect, it, vi } from 'vitest';
import { admitWithRouterOnePin, scopeAskWithRouterOnePin } from './admission';

describe('existing Router One pin admission remains lazy', () => {
  it('skips Surplus entirely for pinned requests', async () => {
    const admit = vi.fn();
    expect(await admitWithRouterOnePin(true, admit)).toEqual({ ok: true, session: undefined, diag: undefined });
    expect(admit).not.toHaveBeenCalled();
  });
  it('preserves non-pinned refusal and errors', async () => {
    const refusal = { ok: false as const, diag: undefined, afterSurplusFallback: true };
    expect(await admitWithRouterOnePin(false, async () => refusal)).toBe(refusal);
    await expect(admitWithRouterOnePin(false, async () => { throw Error('admission failed'); })).rejects.toThrow('admission failed');
  });
  it.each([true, false])('constructs only the selected scope ask, pinned=%s', pinned => {
    const router = vi.fn(() => 'router'); const surplus = vi.fn(() => 'surplus');
    expect(scopeAskWithRouterOnePin(pinned, router, surplus)).toBe(pinned ? 'router' : 'surplus');
    expect(router).toHaveBeenCalledTimes(pinned ? 1 : 0);
    expect(surplus).toHaveBeenCalledTimes(pinned ? 0 : 1);
  });
});
