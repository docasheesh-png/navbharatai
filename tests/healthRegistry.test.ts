import { describe, it, expect, vi } from 'vitest';
import { ModelHealthRegistry } from '../src/server/AI/HealthRegistry';

describe('ModelHealthRegistry', () => {
  it('reports a new model as healthy', () => {
    const r = new ModelHealthRegistry('test');
    expect(r.isHealthy('grok-3')).toBe(true);
  });

  it('marks a model as unstable after the first failure', () => {
    const r = new ModelHealthRegistry('test');
    r.reportFailure('grok-3');
    expect(r.isHealthy('grok-3')).toBe(false);
  });

  it('blacklists a model after a second failure', () => {
    const r = new ModelHealthRegistry('test');
    r.reportFailure('model-a');
    r.reportFailure('model-a'); // second failure → blacklisted
    const entry = r.getRegistry()['test:model-a'];
    expect(entry.status).toBe('blacklisted');
    expect(r.isHealthy('model-a')).toBe(false);
  });

  it('namespaces entries correctly — same model in different namespaces is independent', () => {
    const r1 = new ModelHealthRegistry('ns-1');
    const r2 = new ModelHealthRegistry('ns-2');
    r1.reportFailure('modelX');
    expect(r1.isHealthy('modelX')).toBe(false);
    expect(r2.isHealthy('modelX')).toBe(true); // ns-2 unaffected
  });

  it('recovers a blacklisted model after the cooldown period', () => {
    const r = new ModelHealthRegistry('test');
    r.reportFailure('model-b');
    r.reportFailure('model-b'); // blacklisted, cooldown 60s

    // Simulate time passing beyond cooldown
    const entry = r.getRegistry()['test:model-b'];
    entry.lastFailure = Date.now() - 70_000; // 70s ago → past 60s cooldown

    expect(r.isHealthy('model-b')).toBe(true); // unstable but passable
  });

  it('getRegistry returns all tracked entries', () => {
    const r = new ModelHealthRegistry('prod');
    r.reportFailure('providerA');
    r.reportFailure('providerB');
    const reg = r.getRegistry();
    expect(Object.keys(reg)).toContain('prod:providerA');
    expect(Object.keys(reg)).toContain('prod:providerB');
  });
});
