import { describe, it, expect, vi } from 'vitest';
import { ModelHealthRegistry } from '../src/server/AI/HealthRegistry';

describe('ModelHealthRegistry', () => {
  it('returns healthy for unknown model', () => {
    const registry = new ModelHealthRegistry('test');
    expect(registry.isHealthy('grok-3')).toBe(true);
  });

  it('marks model as unstable after first failure', () => {
    const registry = new ModelHealthRegistry('test');
    registry.reportFailure('grok-3');
    // unstable status → isHealthy returns false
    expect(registry.isHealthy('grok-3')).toBe(false);
  });

  it('marks model as blacklisted after second failure', () => {
    const registry = new ModelHealthRegistry('test');
    registry.reportFailure('grok-3');
    registry.reportFailure('grok-3');
    const entry = registry.getRegistry()['test:grok-3'];
    expect(entry.status).toBe('blacklisted');
  });

  it('separates namespaces correctly', () => {
    const reg1 = new ModelHealthRegistry('ns1');
    const reg2 = new ModelHealthRegistry('ns2');
    reg1.reportFailure('modelA');
    // reg2 should not be affected
    expect(reg2.isHealthy('modelA')).toBe(true);
  });

  it('recovers from blacklist after cooldown expires', () => {
    const registry = new ModelHealthRegistry('test');
    registry.reportFailure('modelX');
    registry.reportFailure('modelX');
    // Force past the cooldown by setting lastFailure in the past
    const key = 'test:modelX';
    registry.getRegistry()[key].lastFailure = Date.now() - 70000; // > 60s cooldown
    expect(registry.isHealthy('modelX')).toBe(true);
  });
});
