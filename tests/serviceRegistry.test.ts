import { describe, it, expect } from 'vitest';
import { ServiceRegistry } from '../src/server/AppMakerLab/kernel/ServiceRegistry';
import { DependencyError } from '../src/server/AppMakerLab/kernel/KernelErrors';
import type { IKernelService, HealthReport } from '../src/server/AppMakerLab/kernel/IKernelService';
import { ServiceState } from '../src/server/AppMakerLab/kernel/IKernelService';

function stubService(name: string): IKernelService {
  return {
    name,
    dependencies: [],
    start: async () => {},
    stop: async () => {},
    healthCheck: async (): Promise<HealthReport> => ({ serviceName: name, serviceState: ServiceState.RUNNING, healthy: true }),
    getState: () => ServiceState.RUNNING,
  };
}

describe('ServiceRegistry', () => {
  it('isLocked() is false on a fresh registry', () => {
    const r = new ServiceRegistry();
    expect(r.isLocked()).toBe(false);
  });

  it('lock() makes isLocked() return true', () => {
    const r = new ServiceRegistry();
    r.lock();
    expect(r.isLocked()).toBe(true);
  });

  it('register() then get() returns the registered service', () => {
    const r = new ServiceRegistry();
    const svc = stubService('logger');
    r.register(svc);
    expect(r.get('logger')).toBe(svc);
  });

  it('get() throws DependencyError for an unregistered service', () => {
    const r = new ServiceRegistry();
    expect(() => r.get('nonexistent')).toThrow(DependencyError);
  });

  it('register() throws DependencyError when registry is locked', () => {
    const r = new ServiceRegistry();
    r.lock();
    expect(() => r.register(stubService('db'))).toThrow(DependencyError);
  });

  it('register() throws DependencyError for a duplicate service name', () => {
    const r = new ServiceRegistry();
    r.register(stubService('cache'));
    expect(() => r.register(stubService('cache'))).toThrow(DependencyError);
  });
});
