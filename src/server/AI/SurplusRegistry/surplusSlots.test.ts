/** Owner 2026-11-16: the per-build Surplus queue is a bounded slot pool, not a one-at-a-time line. */
import { describe, expect, it } from 'vitest';
import { createSurplusSlots, surplusParallelCallsPerBuild, SURPLUS_PARALLEL_CALLS_DEFAULT, SURPLUS_PARALLEL_CALLS_MAX } from './buildSession';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createSurplusSlots', () => {
  it('admits at most `limit` holders and hands freed slots out in FIFO order', async () => {
    const slots = createSurplusSlots(2); const order: number[] = [];
    const a = await slots.acquire(); const b = await slots.acquire();
    const waiters = [3, 4].map(n => slots.acquire().then(release => { order.push(n); return release; }));
    await tick();
    expect(slots.active).toBe(2); expect(slots.waiting).toBe(2); expect(order).toEqual([]);
    a(); await tick(); expect(order).toEqual([3]);
    b(); await tick(); expect(order).toEqual([3, 4]);
    (await Promise.all(waiters)).forEach(release => release());
    expect(slots.active).toBe(0);
  });

  it('a double release never admits an extra caller', async () => {
    const slots = createSurplusSlots(1);
    const release = await slots.acquire();
    release(); release();
    const again = await slots.acquire();
    expect(slots.active).toBe(1);
    let third = false; void slots.acquire().then(() => { third = true; });
    await tick(); expect(third).toBe(false);
    again();
  });

  it('a stopped waiter leaves the line without taking a slot', async () => {
    const slots = createSurplusSlots(1);
    const hold = await slots.acquire();
    const stop = new AbortController();
    const stopped = slots.acquire(stop.signal);
    await tick(); expect(slots.waiting).toBe(1);
    stop.abort();
    await expect(stopped).rejects.toThrow();
    expect(slots.waiting).toBe(0);
    hold(); expect(slots.active).toBe(0);
    const next = await slots.acquire(); expect(slots.active).toBe(1); next();
  });

  it('an already stopped caller never takes a slot', async () => {
    const slots = createSurplusSlots(4); const stop = new AbortController(); stop.abort();
    await expect(slots.acquire(stop.signal)).rejects.toThrow();
    expect(slots.active).toBe(0);
  });

  it('150 callers on a 128-slot pool: peak is exactly 128 and everyone finishes', async () => {
    const slots = createSurplusSlots(128); let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 150 }, async () => {
      const release = await slots.acquire();
      active++; peak = Math.max(peak, active); await tick(); active--; release();
    }));
    expect(peak).toBe(128); expect(slots.active).toBe(0);
  });
});

describe('surplusParallelCallsPerBuild', () => {
  it('defaults to 128, honours a positive integer, caps at the max, ignores junk', () => {
    expect(SURPLUS_PARALLEL_CALLS_DEFAULT).toBe(128);
    expect(surplusParallelCallsPerBuild({})).toBe(128);
    expect(surplusParallelCallsPerBuild({ SURPLUS_PARALLEL_CALLS_PER_BUILD: '1' })).toBe(1);
    expect(surplusParallelCallsPerBuild({ SURPLUS_PARALLEL_CALLS_PER_BUILD: ' 300 ' })).toBe(300);
    expect(surplusParallelCallsPerBuild({ SURPLUS_PARALLEL_CALLS_PER_BUILD: '99999' })).toBe(SURPLUS_PARALLEL_CALLS_MAX);
    for (const junk of ['0', '-4', '2.5', 'many', '']) expect(surplusParallelCallsPerBuild({ SURPLUS_PARALLEL_CALLS_PER_BUILD: junk })).toBe(128);
  });
});
