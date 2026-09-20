// "app kitne % ban gayi woh bhi likh kar aana chahiye … 100% done - tap on preview!" (admin 2026-09-20)
//
// What is locked here is not the arithmetic — it is the three refusals that make the number worth
// showing at all: it never moves without an event, it never falls back, and 100% is EARNED by a proven
// render rather than announced by a build that merely finished.

import { describe, it, expect } from 'vitest';
import { buildProgress, planShare } from '../src/components/agentv3/buildProgress';
import type { TodoItem } from '../src/components/agentv3/agentV3Types';

const todo = (status: TodoItem['status'], i: number): TodoItem =>
  ({ id: `t${i}`, title: `step ${i}`, status } as TodoItem);

const plan = (...statuses: TodoItem['status'][]) => statuses.map(todo);

const base = {
  started: true,
  todos: [] as TodoItem[],
  buildPhase: 'generating' as const,
  done: false,
};

describe('planShare', () => {
  it('counts ONLY what the engine marked done', () => {
    // Half a point for `in_progress` would be a convention, not a measurement — and this module is
    // worth nothing the moment it contains conventions.
    expect(planShare(plan('done', 'in_progress', 'pending', 'blocked'))).toBe(0.25);
    expect(planShare(plan('done', 'done'))).toBe(1);
    expect(planShare([])).toBeNull();
    expect(planShare(undefined as unknown as TodoItem[])).toBeNull();
  });
});

describe('🔒 100% is earned', () => {
  it('a finished, PROVEN-rendered build is the only thing that reaches 100', () => {
    const p = buildProgress({ ...base, todos: plan('done', 'done'), done: true, ok: true, appRendered: true });
    expect(p.pct).toBe(100);
    expect(p.complete).toBe(true);
    expect(p.label).toBe('100% done — tap Preview');
  });

  it('🔴 a build that says ok but was never proven to render does NOT reach 100', () => {
    // This is autopsy 697b38ee in the other direction: telling a user their app is done when the
    // screen would show them otherwise.
    const p = buildProgress({ ...base, todos: plan('done', 'done'), done: true, ok: true, appRendered: false });
    expect(p.pct).toBeLessThan(100);
    expect(p.complete).toBe(false);
    expect(p.label).toContain('preview not confirmed');
  });

  it('a failed build reports where it really got to, and that the work is kept', () => {
    const p = buildProgress({ ...base, todos: plan('done', 'pending'), done: true, ok: false, floor: 45 });
    expect(p.pct).toBe(45);
    expect(p.complete).toBe(false);
    expect(p.label).toContain('Your files are saved');
  });

  it('a RUNNING build can never show 100, whatever it has reached', () => {
    const p = buildProgress({ ...base, todos: plan('done', 'done'), previewUrl: 'https://x', appRendered: true, floor: 99 });
    expect(p.pct).toBeLessThan(100);
    expect(p.complete).toBe(false);
  });
});

describe('🔒 the number only moves on evidence', () => {
  it('is 0 before anything happens', () => {
    expect(buildProgress({ ...base, started: false }).pct).toBe(0);
  });

  it('rises through the stages the engine actually declares', () => {
    const started = buildProgress({ ...base });
    const planned = buildProgress({ ...base, todos: plan('pending', 'pending') });
    const settling = buildProgress({ ...base, buildPhase: 'settling' });
    const previewUp = buildProgress({ ...base, buildPhase: 'settling', previewUrl: 'https://x' });
    expect(started.pct).toBeLessThan(planned.pct);
    expect(planned.pct).toBeLessThan(settling.pct);
    expect(settling.pct).toBeLessThan(previewUp.pct);
  });

  it('tracks a real plan fraction between the plan and settle stages', () => {
    const none = buildProgress({ ...base, todos: plan('pending', 'pending', 'pending', 'pending') });
    const half = buildProgress({ ...base, todos: plan('done', 'done', 'pending', 'pending') });
    const all = buildProgress({ ...base, todos: plan('done', 'done', 'done', 'done') });
    expect(none.pct).toBe(15);
    expect(half.pct).toBe(45);
    expect(all.pct).toBe(75);
    expect(half.basis).toBe('plan');
  });

  it('⚠️ says so when it has no plan to count — the reading JUMPS and that is deliberate', () => {
    const p = buildProgress({ ...base, buildPhase: 'settling' });
    expect(p.basis).toBe('milestone');
    expect(p.pct).toBe(80); // 5 → 80: the in-between values do not exist, so they are not invented
  });

  it('two identical readings are identical — nothing drifts on its own', () => {
    // The whole point: call it a thousand times with the same facts and it does not creep upward the
    // way a timer-driven bar would.
    const once = buildProgress({ ...base, todos: plan('done', 'pending') });
    const again = buildProgress({ ...base, todos: plan('done', 'pending') });
    expect(again.pct).toBe(once.pct);
  });
});

describe('🔒 it never falls backwards', () => {
  it('holds the floor when the live evidence would read lower', () => {
    // A plan that GROWS mid-build (the engine adds steps) genuinely lowers the done/total fraction.
    // The user should not watch their app get less built.
    const p = buildProgress({ ...base, todos: plan('done', 'pending', 'pending', 'pending'), floor: 60 });
    expect(p.pct).toBe(60);
  });

  it('is clamped and total against nonsense', () => {
    expect(buildProgress({ ...base, floor: Number.NaN }).pct).toBe(5);
    expect(buildProgress({ ...base, floor: -50 }).pct).toBe(5);
    expect(buildProgress({ ...base, floor: 5000 }).pct).toBe(97);
    expect(buildProgress({ ...base, todos: undefined as unknown as TodoItem[] }).pct).toBe(5);
  });
});
