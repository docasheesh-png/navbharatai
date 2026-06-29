import { describe, it, expect } from 'vitest';
import { DecisionTrace } from '../src/server/AgentV3/DecisionTraceManager';

/** P-AI.9 — explainability decision trace (pure core). */

describe('DecisionTrace — record/snapshot', () => {
  it('starts empty', () => {
    const t = new DecisionTrace('ws-1');
    expect(t.workspaceId).toBe('ws-1');
    expect(t.snapshot()).toEqual([]);
    expect(t.format()).toBe('No decisions recorded.');
  });

  it('records decisions in order', () => {
    const t = new DecisionTrace('ws-2');
    t.record('intent', 'new_build', 'user asked to build a fresh app', '2026-06-29T00:00:00.000Z');
    t.record('tier', 'opus', 'high complexity blueprint', '2026-06-29T00:00:01.000Z');
    const snap = t.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]).toEqual({
      stage: 'intent',
      decision: 'new_build',
      reason: 'user asked to build a fresh app',
      at: '2026-06-29T00:00:00.000Z',
    });
    expect(snap[1].stage).toBe('tier');
  });

  it('snapshot returns a copy (mutating it does not affect the trace)', () => {
    const t = new DecisionTrace('ws-3');
    t.record('intent', 'edit_existing', 'workspace already has files', '2026-06-29T00:00:00.000Z');
    const snap = t.snapshot();
    snap.push({ stage: 'x', decision: 'y', reason: 'z', at: 'now' });
    expect(t.snapshot()).toHaveLength(1);
  });

  it('coerces and bounds field lengths; tolerates empties', () => {
    const t = new DecisionTrace('ws-4');
    t.record('s'.repeat(200), 'd'.repeat(400), 'r'.repeat(600), '2026-06-29T00:00:00.000Z');
    const [d] = t.snapshot();
    expect(d.stage.length).toBe(80);
    expect(d.decision.length).toBe(200);
    expect(d.reason.length).toBe(300);
    t.record('', '', '', 'now');
    expect(t.snapshot()).toHaveLength(2);
  });
});

describe('DecisionTrace — format', () => {
  it('renders a numbered human-readable trace', () => {
    const t = new DecisionTrace('ws-5');
    t.record('intent', 'new_build', 'fresh app', '2026-06-29T00:00:00.000Z');
    t.record('model', 'grok', 'primary provider available', '2026-06-29T00:00:01.000Z');
    const out = t.format();
    expect(out).toContain('1. [intent] new_build — fresh app');
    expect(out).toContain('2. [model] grok — primary provider available');
  });
});
