import { describe, expect, it, vi } from 'vitest';
import { runSequentialProviderFallback } from '../src/server/lib/sequentialProviderFallback';

describe('runSequentialProviderFallback', () => {
  it('stops after the first successful provider without starting later providers', async () => {
    const first = vi.fn().mockResolvedValue('answer');
    const second = vi.fn().mockResolvedValue('fallback');
    await expect(runSequentialProviderFallback([first, second])).resolves.toBe('answer');
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('starts the next provider only after the previous provider fails', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const first = async () => {
      order.push('first:start');
      active += 1; maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      order.push('first:fail');
      throw new Error('first unavailable');
    };
    const second = async () => {
      order.push('second:start');
      active += 1; maxActive = Math.max(maxActive, active);
      active -= 1;
      return 'second answer';
    };

    await expect(runSequentialProviderFallback([first, second])).resolves.toBe('second answer');
    expect(order).toEqual(['first:start', 'first:fail', 'second:start']);
    expect(maxActive).toBe(1);
  });

  it('returns null and reports each failure when all providers fail', async () => {
    const onError = vi.fn();
    const first = vi.fn().mockRejectedValue(new Error('one'));
    const second = vi.fn().mockRejectedValue(new Error('two'));
    await expect(runSequentialProviderFallback([first, second], onError)).resolves.toBeNull();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls.map((call) => call[1])).toEqual([0, 1]);
  });

  it('propagates caller cancellation and does not start later providers', async () => {
    const controller = new AbortController();
    const first = vi.fn(async () => {
      controller.abort(new Error('request cancelled'));
      throw new Error('provider aborted');
    });
    const second = vi.fn().mockResolvedValue('must not run');
    await expect(runSequentialProviderFallback([first, second], undefined, controller.signal))
      .rejects.toThrow('request cancelled');
    expect(second).not.toHaveBeenCalled();
  });
});
