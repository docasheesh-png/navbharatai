import { describe, it, expect } from 'vitest';
import { ObservabilityManager } from '../src/server/ObservabilityManager';

describe('ObservabilityManager', () => {
  it('getMetrics() returns empty object on a fresh instance', () => {
    const m = new ObservabilityManager();
    expect(m.getMetrics()).toEqual({});
  });

  it('trackLatency stores latency under "latency_<provider>"', () => {
    const m = new ObservabilityManager();
    m.trackLatency('grok', 120);
    expect(m.getMetrics()['latency_grok']).toBe(120);
  });

  it('trackLatency overwrites previous value for the same provider', () => {
    const m = new ObservabilityManager();
    m.trackLatency('anthropic', 200);
    m.trackLatency('anthropic', 150);
    expect(m.getMetrics()['latency_anthropic']).toBe(150);
  });

  it('logCrash creates a crashes array on first call', () => {
    const m = new ObservabilityManager();
    m.logCrash('Connection timeout');
    const crashes = m.getMetrics().crashes;
    expect(crashes).toHaveLength(1);
    expect(crashes[0].error).toBe('Connection timeout');
  });

  it('logCrash accumulates multiple crash entries', () => {
    const m = new ObservabilityManager();
    m.logCrash('Error A');
    m.logCrash('Error B');
    const crashes = m.getMetrics().crashes;
    expect(crashes).toHaveLength(2);
  });

  it('different providers are tracked independently', () => {
    const m = new ObservabilityManager();
    m.trackLatency('grok', 100);
    m.trackLatency('gemini', 300);
    expect(m.getMetrics()['latency_grok']).toBe(100);
    expect(m.getMetrics()['latency_gemini']).toBe(300);
  });
});
