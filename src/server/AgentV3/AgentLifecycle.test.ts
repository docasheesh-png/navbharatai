import { describe, it, expect, beforeEach } from 'vitest';
import { agentLifecycle } from './AgentLifecycle';

describe('AgentLifecycle (Agent Health Monitor)', () => {
  beforeEach(() => agentLifecycle.reset());

  it('records a successful run with timing and success rate', () => {
    const token = agentLifecycle.start('frontend');
    agentLifecycle.finish(token, true);

    const h = agentLifecycle.healthOf('frontend')!;
    expect(h.runs).toBe(1);
    expect(h.successes).toBe(1);
    expect(h.failures).toBe(0);
    expect(h.active).toBe(0);
    expect(h.phase).toBe('completed');
    expect(h.successRate).toBe(1);
    expect(h.lastDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('records failures and computes a partial success rate', () => {
    agentLifecycle.finish(agentLifecycle.start('backend'), true);
    agentLifecycle.finish(agentLifecycle.start('backend'), false);

    const h = agentLifecycle.healthOf('backend')!;
    expect(h.runs).toBe(2);
    expect(h.successes).toBe(1);
    expect(h.failures).toBe(1);
    expect(h.successRate).toBe(0.5);
    expect(h.phase).toBe('failed');
  });

  it('tracks parallel active runs of the same role', () => {
    const a = agentLifecycle.start('tester');
    const b = agentLifecycle.start('tester');
    expect(agentLifecycle.healthOf('tester')!.active).toBe(2);
    expect(agentLifecycle.healthOf('tester')!.phase).toBe('running');

    agentLifecycle.finish(a, true);
    // Still one active → phase stays running.
    expect(agentLifecycle.healthOf('tester')!.active).toBe(1);
    expect(agentLifecycle.healthOf('tester')!.phase).toBe('running');

    agentLifecycle.finish(b, true);
    expect(agentLifecycle.healthOf('tester')!.active).toBe(0);
    expect(agentLifecycle.healthOf('tester')!.phase).toBe('completed');
  });

  it('snapshot returns every role that ran, newest first', () => {
    agentLifecycle.finish(agentLifecycle.start('frontend'), true);
    agentLifecycle.finish(agentLifecycle.start('security'), false);

    const snap = agentLifecycle.snapshot();
    const roles = snap.map((h) => h.role);
    expect(roles).toContain('frontend');
    expect(roles).toContain('security');
    // Most-recently-updated first.
    expect(snap[0].role).toBe('security');
  });
});
