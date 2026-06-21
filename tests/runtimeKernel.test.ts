import { describe, it, expect } from 'vitest';
import { RuntimeKernel, KernelState } from '../src/server/AppMakerLab/kernel/RuntimeKernel';
import { IKernelService, ServiceState, HealthReport } from '../src/server/AppMakerLab/kernel/IKernelService';

function makeService(name: string, deps: string[] = []): IKernelService {
  let state = ServiceState.UNINITIALIZED;
  return {
    name,
    dependencies: deps,
    getState: () => state,
    start: async () => { state = ServiceState.RUNNING; },
    stop: async () => { state = ServiceState.STOPPED; },
    healthCheck: async (): Promise<HealthReport> => ({ serviceName: name, serviceState: state, healthy: state === ServiceState.RUNNING }),
  };
}

describe('RuntimeKernel', () => {
  it('starts in UNINITIALIZED state', () => {
    const kernel = new RuntimeKernel([]);
    expect(kernel.getState()).toBe(KernelState.UNINITIALIZED);
  });

  it('transitions to RUNNING after start()', async () => {
    const kernel = new RuntimeKernel([makeService('svc-a')]);
    await kernel.start();
    expect(kernel.getState()).toBe(KernelState.RUNNING);
  });

  it('transitions to STOPPED after stop()', async () => {
    const kernel = new RuntimeKernel([makeService('svc-a')]);
    await kernel.start();
    await kernel.stop();
    expect(kernel.getState()).toBe(KernelState.STOPPED);
  });

  it('throws KernelStateError when starting from RUNNING state', async () => {
    const kernel = new RuntimeKernel([makeService('svc-a')]);
    await kernel.start();
    await expect(kernel.start()).rejects.toThrow('Cannot start from state RUNNING');
  });

  it('throws KernelStateError when stopping from UNINITIALIZED state', async () => {
    const kernel = new RuntimeKernel([]);
    await expect(kernel.stop()).rejects.toThrow('Cannot stop from state UNINITIALIZED');
  });

  it('hasService() returns true for a registered service', () => {
    const kernel = new RuntimeKernel([makeService('my-svc')]);
    expect(kernel.hasService('my-svc')).toBe(true);
  });

  it('hasService() returns false for an unknown service', () => {
    const kernel = new RuntimeKernel([]);
    expect(kernel.hasService('ghost')).toBe(false);
  });

  it('healthCheck() reports healthy when all services are running', async () => {
    const kernel = new RuntimeKernel([makeService('svc-a'), makeService('svc-b')]);
    await kernel.start();
    const report = await kernel.healthCheck();
    expect(report.healthy).toBe(true);
    expect(report.services).toHaveLength(2);
  });

  it('getRegisteredServices() returns all services', () => {
    const kernel = new RuntimeKernel([makeService('a'), makeService('b')]);
    expect(kernel.getRegisteredServices()).toHaveLength(2);
  });
});
