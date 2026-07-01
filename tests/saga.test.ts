import { describe, it, expect } from 'vitest';
import { Saga } from '../src/server/AppMakerLab/generator/Saga';

/** P-ORCH.3 — saga/compensation: reverse-order compensation, best-effort, structured result. */

describe('Saga.register + compensate', () => {
  it('runs registered compensations in REVERSE (LIFO) order', async () => {
    const order: string[] = [];
    const saga = new Saga();
    saga.register('a', () => { order.push('a'); });
    saga.register('b', () => { order.push('b'); });
    saga.register('c', () => { order.push('c'); });
    const res = await saga.compensate();
    expect(order).toEqual(['c', 'b', 'a']);
    expect(res.compensated).toEqual(['c', 'b', 'a']);
    expect(res.compensationErrors).toEqual([]);
    expect(saga.size).toBe(0); // cleared after compensating
  });
  it('is best-effort: one throwing compensation does not stop the others', async () => {
    const order: string[] = [];
    const saga = new Saga();
    saga.register('a', () => { order.push('a'); });
    saga.register('b', () => { throw new Error('boom'); });
    const res = await saga.compensate();
    expect(order).toEqual(['a']);
    expect(res.compensated).toEqual(['a']);
    expect(res.compensationErrors).toEqual([{ step: 'b', error: 'boom' }]);
  });
});

describe('Saga.run', () => {
  it('runs all steps forward and reports ok when none fail', async () => {
    const res = await Saga.run([
      { name: 's1', execute: () => 1 },
      { name: 's2', execute: async () => 2 },
    ]);
    expect(res.ok).toBe(true);
    expect(res.completed).toEqual(['s1', 's2']);
  });
  it('on failure, compensates completed steps in reverse and reports the failed step', async () => {
    const undone: string[] = [];
    const res = await Saga.run([
      { name: 'deploy', execute: () => 'deployed', compensate: () => { undone.push('deploy'); } },
      { name: 'verify', execute: () => { throw new Error('verify failed'); }, compensate: () => { undone.push('verify'); } },
    ]);
    expect(res.ok).toBe(false);
    expect(res.failedStep).toBe('verify');
    expect(res.error).toBe('verify failed');
    // Only completed steps are compensated (verify never completed), reverse order.
    expect(res.compensated).toEqual(['deploy']);
    expect(undone).toEqual(['deploy']);
  });
  it('passes each step result to its own compensation', async () => {
    let seen: unknown;
    await Saga.run([
      { name: 'make', execute: () => ({ id: 42 }), compensate: (r) => { seen = r; } },
      { name: 'boom', execute: () => { throw new Error('x'); } },
    ]);
    expect(seen).toEqual({ id: 42 });
  });
});
