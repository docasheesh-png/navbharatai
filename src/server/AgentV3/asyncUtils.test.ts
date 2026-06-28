import { describe, it, expect } from 'vitest';
import { mapWithConcurrency, withTimeout } from './asyncUtils';

describe('mapWithConcurrency', () => {
  it('preserves order and maps every item', async () => {
    const r = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => n * 10);
    expect(r).toEqual([10, 20, 30, 40]);
  });

  it('never runs more than `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // actually parallel
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async (n) => n)).toEqual([]);
  });
});

describe('withTimeout', () => {
  it('resolves with the value when in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
  });
  it('rejects with a labelled timeout when it hangs', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'readFile')).rejects.toThrow(/readFile timed out after 20ms/);
  });
  it('propagates a rejection unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });
  it('supports the .catch sentinel pattern (a hung read degrades to "")', async () => {
    const content = await withTimeout(new Promise<string>(() => {}), 20, 'readFile').catch(() => '');
    expect(content).toBe('');
  });
});
