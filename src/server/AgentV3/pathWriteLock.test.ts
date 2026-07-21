import { describe, it, expect } from 'vitest';
import { PathWriteLock } from './pathWriteLock';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('PathWriteLock', () => {
  it('serializes same-key tasks IN ORDER (no interleaving)', async () => {
    const lock = new PathWriteLock();
    const log: string[] = [];
    const task = (label: string, delay: number) => lock.run('a.ts', async () => {
      log.push(`${label}:start`);
      await tick(delay);
      log.push(`${label}:end`);
      return label;
    });
    // Queue three writes to the SAME path; the first is slowest — order must still be 1,2,3.
    const all = Promise.all([task('1', 20), task('2', 1), task('3', 1)]);
    expect(await all).toEqual(['1', '2', '3']);
    expect(log).toEqual(['1:start', '1:end', '2:start', '2:end', '3:start', '3:end']);
  });

  it('runs DIFFERENT keys concurrently (they do not wait on each other)', async () => {
    const lock = new PathWriteLock();
    const order: string[] = [];
    const slow = lock.run('a.ts', async () => { await tick(30); order.push('a'); });
    const fast = lock.run('b.ts', async () => { await tick(1); order.push('b'); });
    await Promise.all([slow, fast]);
    // b (different key, faster) finishes before a — proof they ran in parallel.
    expect(order).toEqual(['b', 'a']);
  });

  it('isolates a rejected task — the next same-key task still runs', async () => {
    const lock = new PathWriteLock();
    const boom = lock.run('a.ts', async () => { throw new Error('boom'); });
    await expect(boom).rejects.toThrow('boom');
    const ok = await lock.run('a.ts', async () => 'recovered');
    expect(ok).toBe('recovered');
  });

  it('executes immediately when there is no contention (single-writer no-op)', async () => {
    const lock = new PathWriteLock();
    let ran = false;
    await lock.run('only.ts', () => { ran = true; return 1; });
    expect(ran).toBe(true);
  });

  it('cleans up finished keys so the map never grows unbounded', async () => {
    const lock = new PathWriteLock();
    await lock.run('x.ts', () => 1);
    await lock.run('y.ts', () => 2);
    await tick(0); // let the cleanup microtasks flush
    expect(lock.activeKeys()).toBe(0);
  });

  it('supports a synchronous fn', async () => {
    const lock = new PathWriteLock();
    expect(await lock.run('k', () => 42)).toBe(42);
  });
});
