import { describe, it, expect, afterEach } from 'vitest';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';

describe('AIRouterManager', () => {
  afterEach(() => {
    AIRouterManager.reset();
  });

  it('getRouter("free") returns an AIRouter instance', () => {
    const router = AIRouterManager.getRouter('free');
    expect(router).toBeDefined();
    expect(typeof router.route).toBe('function');
  });

  it('getRouter("pro") returns an AIRouter instance', () => {
    const router = AIRouterManager.getRouter('pro');
    expect(router).toBeDefined();
    expect(typeof router.route).toBe('function');
  });

  it('getRouter("free") returns the same instance on repeated calls (singleton)', () => {
    const r1 = AIRouterManager.getRouter('free');
    const r2 = AIRouterManager.getRouter('free');
    expect(r1).toBe(r2);
  });

  it('reset() causes a new instance to be created on next call', () => {
    const r1 = AIRouterManager.getRouter('free');
    AIRouterManager.reset();
    const r2 = AIRouterManager.getRouter('free');
    expect(r1).not.toBe(r2);
  });

  it('free and pro routers are separate instances', () => {
    const free = AIRouterManager.getRouter('free');
    const pro = AIRouterManager.getRouter('pro');
    expect(free).not.toBe(pro);
  });
});
