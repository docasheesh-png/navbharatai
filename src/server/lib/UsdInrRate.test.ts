import { describe, it, expect, afterEach, vi } from 'vitest';
import { usdInrRate, setUsdInrRate, usdToInr, refreshUsdInrRate, usdInrRateUpdatedAt } from './UsdInrRate';

describe('UsdInrRate', () => {
  afterEach(() => {
    setUsdInrRate(85); // reset to a known value
  });

  it('returns a positive default rate synchronously', () => {
    expect(usdInrRate()).toBeGreaterThan(0);
  });

  it('setUsdInrRate updates the rate; ignores non-positive', () => {
    setUsdInrRate(90);
    expect(usdInrRate()).toBe(90);
    setUsdInrRate(0);
    expect(usdInrRate()).toBe(90);
    setUsdInrRate(-5);
    expect(usdInrRate()).toBe(90);
  });

  it('usdToInr converts at the current rate and clamps negatives', () => {
    setUsdInrRate(85);
    expect(usdToInr(2)).toBe(170);
    expect(usdToInr(-3)).toBe(0);
  });

  it('refreshUsdInrRate updates the cache from a live source (injected)', async () => {
    const fetchJson = vi.fn().mockResolvedValue({ rates: { INR: 84.2 } });
    const rate = await refreshUsdInrRate(fetchJson);
    expect(rate).toBe(84.2);
    expect(usdInrRate()).toBe(84.2);
    expect(usdInrRateUpdatedAt()).toBeGreaterThan(0);
    expect(fetchJson).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD');
  });

  it('keeps the last good rate when the FX source fails or returns garbage (never throws)', async () => {
    setUsdInrRate(83);
    await expect(refreshUsdInrRate(vi.fn().mockRejectedValue(new Error('network down')))).resolves.toBe(83);
    expect(usdInrRate()).toBe(83);
    await refreshUsdInrRate(vi.fn().mockResolvedValue({ rates: { INR: 'not-a-number' } }));
    expect(usdInrRate()).toBe(83);
    await refreshUsdInrRate(vi.fn().mockResolvedValue({}));
    expect(usdInrRate()).toBe(83);
  });
});
