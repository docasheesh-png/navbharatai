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

  // professional-free universe (admin 2026-07-09): the free GLM-flash first-attempt tier
  // for the config-driven professionals. It must stay a SINGLE-provider universe — the
  // paid fallback lives in professionals/engine.ts, not in this chain — so a successful
  // free answer can never fire a paid provider call.
  it('getRouter("professional-free") holds ONLY the GLM provider', () => {
    const router = AIRouterManager.getRouter('professional-free');
    const chain = router.getProviderChain();
    expect(chain.map((p) => p.name)).toEqual(['GLM']);
  });

  it('professional-free and professional (paid) are separate instances', () => {
    const free = AIRouterManager.getRouter('professional-free');
    const paid = AIRouterManager.getRouter('professional');
    expect(free).not.toBe(paid);
  });

  it('the paid professional universe is unchanged: race trio + Claude Haiku last resort', () => {
    const chain = AIRouterManager.getRouter('professional').getProviderChain();
    expect(chain.filter((p) => !p.lastResort).map((p) => p.name)).toEqual(['GROK', 'GEMINI', 'VERTEX']);
    expect(chain.filter((p) => p.lastResort).map((p) => p.name)).toEqual(['ANTHROPIC']);
  });
});
