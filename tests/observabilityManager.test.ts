import { describe, it, expect } from 'vitest';
import { ObservabilityManager } from '../src/server/ObservabilityManager';

describe('ObservabilityManager', () => {
  it('starts with empty metrics', () => {
    const manager = new ObservabilityManager();
    expect(manager.getMetrics()).toEqual({});
  });

  it('tracks latency by provider', () => {
    const manager = new ObservabilityManager();
    manager.trackLatency('openai', 250);
    expect(manager.getMetrics()['latency_openai']).toBe(250);
  });

  it('overwrites latency on second call for same provider', () => {
    const manager = new ObservabilityManager();
    manager.trackLatency('grok', 100);
    manager.trackLatency('grok', 200);
    expect(manager.getMetrics()['latency_grok']).toBe(200);
  });

  it('logs crashes with error message', () => {
    const manager = new ObservabilityManager();
    manager.logCrash('Connection timeout');
    const crashes = manager.getMetrics().crashes;
    expect(Array.isArray(crashes)).toBe(true);
    expect(crashes[0].error).toBe('Connection timeout');
  });

  it('accumulates multiple crashes', () => {
    const manager = new ObservabilityManager();
    manager.logCrash('error 1');
    manager.logCrash('error 2');
    expect(manager.getMetrics().crashes).toHaveLength(2);
  });
});
