import { describe, it, expect, vi } from 'vitest';
import { ServiceRegistry } from '../src/server/AppMakerLab/kernel/ServiceRegistry';
import type { IKernelService, HealthReport } from '../src/server/AppMakerLab/kernel/IKernelService';
import { ServiceState } from '../src/server/AppMakerLab/kernel/IKernelService';
import { DependencyError } from '../src/server/AppMakerLab/kernel/KernelErrors';

function makeService(name: string, dependencies: string[] = []): IKernelService {
  return {
    name,
    dependencies,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ serviceName: name, serviceState: ServiceState.RUNNING, healthy: true } as HealthReport),
    getState: vi.fn().mockReturnValue(ServiceState.RUNNING),
  };
}

describe('ServiceRegistry', () => {
  it('registers and retrieves a service', () => {
    const registry = new ServiceRegistry();
    const svc = makeService('auth');
    registry.register(svc);
    expect(registry.get('auth')).toBe(svc);
  });

  it('has() returns true for registered service', () => {
    const registry = new ServiceRegistry();
    registry.register(makeService('db'));
    expect(registry.has('db')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });

  it('throws DependencyError when registering duplicate service', () => {
    const registry = new ServiceRegistry();
    registry.register(makeService('auth'));
    expect(() => registry.register(makeService('auth'))).toThrowError(DependencyError);
  });

  it('throws DependencyError when registering after lock', () => {
    const registry = new ServiceRegistry();
    registry.lock();
    expect(() => registry.register(makeService('auth'))).toThrowError(DependencyError);
  });

  it('throws DependencyError when getting non-existent service', () => {
    const registry = new ServiceRegistry();
    expect(() => registry.get('missing')).toThrowError(DependencyError);
  });

  it('validateDependencies throws when dep is missing', () => {
    const registry = new ServiceRegistry();
    registry.register(makeService('auth', ['db'])); // db not registered
    expect(() => registry.validateDependencies()).toThrowError(DependencyError);
  });

  it('getStartupOrder returns deps before dependents', () => {
    const registry = new ServiceRegistry();
    registry.register(makeService('db', []));
    registry.register(makeService('auth', ['db']));
    const order = registry.getStartupOrder();
    const dbIdx = order.findIndex(s => s.name === 'db');
    const authIdx = order.findIndex(s => s.name === 'auth');
    expect(dbIdx).toBeLessThan(authIdx);
  });

  it('getAll returns all registered services', () => {
    const registry = new ServiceRegistry();
    registry.register(makeService('a'));
    registry.register(makeService('b'));
    expect(registry.getAll()).toHaveLength(2);
  });
});
