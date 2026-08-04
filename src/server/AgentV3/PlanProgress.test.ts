import { describe, it, expect } from 'vitest';
import { computePlanProgress } from './PlanProgress';
import type { TodoItem } from './types';

const todos = (...statuses: string[]): TodoItem[] =>
  statuses.map((s, i) => ({ id: `t${i}`, title: `step ${i}`, status: s as TodoItem['status'] }));

describe('computePlanProgress — live spinner + green ticks driven by REAL build progress', () => {
  it('marks the first item in_progress at the start (so the spinner spins)', () => {
    const r = computePlanProgress(todos('pending', 'pending', 'pending'), 0, false);
    expect(r.map((t) => t.status)).toEqual(['in_progress', 'pending', 'pending']);
  });

  it('advances done → in_progress → pending as steps complete (the spinner moves, ticks accumulate)', () => {
    const r = computePlanProgress(todos('pending', 'pending', 'pending', 'pending'), 2, false);
    expect(r.map((t) => t.status)).toEqual(['done', 'done', 'in_progress', 'pending']);
  });

  it('never marks the LAST item done until finished (no premature 100%)', () => {
    // completedSteps far exceeds the count — still holds the last item as in_progress.
    const r = computePlanProgress(todos('pending', 'pending', 'pending'), 99, false);
    expect(r.map((t) => t.status)).toEqual(['done', 'done', 'in_progress']);
  });

  it('finished → every item is done (green ticks on a successful build)', () => {
    const r = computePlanProgress(todos('in_progress', 'pending', 'pending'), 1, true);
    expect(r.every((t) => t.status === 'done')).toBe(true);
  });

  it('preserves a real blocked status (a genuine signal, not progress)', () => {
    const r = computePlanProgress(todos('blocked', 'pending', 'pending'), 1, false);
    expect(r[0].status).toBe('blocked');
    const f = computePlanProgress(todos('blocked', 'pending'), 0, true);
    expect(f[0].status).toBe('blocked');
    expect(f[1].status).toBe('done');
  });

  it('empty plan → no change, no crash', () => {
    expect(computePlanProgress([], 3, true)).toEqual([]);
  });

  it('preserves titles and ids — only status changes', () => {
    const r = computePlanProgress(todos('pending', 'pending'), 1, false);
    expect(r.map((t) => t.title)).toEqual(['step 0', 'step 1']);
    expect(r.map((t) => t.id)).toEqual(['t0', 't1']);
  });

  it('NEVER downgrades a done item (the "green ticks vanish mid-build" reset bug)', () => {
    // The agent marked item 2 done via update_todo; the per-file positional tick (completedSteps=1)
    // used to stomp it back to pending. It must stay done.
    const r = computePlanProgress(todos('done', 'done', 'pending', 'pending'), 1, false);
    expect(r[0].status).toBe('done');
    expect(r[1].status).toBe('done');
  });

  it('moves the live spinner to the first pending item when the positional slot is already done', () => {
    const r = computePlanProgress(todos('done', 'done', 'pending', 'pending'), 1, false);
    expect(r[2].status).toBe('in_progress'); // exactly one spinner, on real remaining work
    expect(r[3].status).toBe('pending');
    expect(r.filter((t) => t.status === 'in_progress')).toHaveLength(1);
  });
});
