import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';

/**
 * P0.1 — Isolated PROFESSIONAL universe router chain.
 *
 * The professional universe covers EVERY professional AI — Doctor AI (SDA),
 * Teacher, Lawyer, CA, Astrologer, Kisan, … — which all share one isolated
 * 'professional' router namespace.
 *
 * Proves the three core-law guarantees:
 *   1. PROFESSIONAL is its own router instance, isolated from FREE and PRO.
 *   2. PROFESSIONAL tries Grok FIRST and reaches Claude only as the LAST resort.
 *   3. FREE never reaches Claude/Anthropic.
 *
 * Dummy keys are set so the Grok/Anthropic providers instantiate (their
 * constructors make no network calls), making the chain deterministic.
 */
describe('Professional universe isolated router (P0.1)', () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = process.env.GROK_API_KEY || 'xai-test-key';
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key';
    AIRouterManager.reset();
  });

  afterEach(() => {
    AIRouterManager.reset();
  });

  it('getRouter("professional") returns a distinct instance, isolated from free and pro', () => {
    const professional = AIRouterManager.getRouter('professional');
    const free = AIRouterManager.getRouter('free');
    const pro = AIRouterManager.getRouter('pro');
    expect(professional).toBeDefined();
    expect(typeof professional.route).toBe('function');
    expect(professional).not.toBe(free);
    expect(professional).not.toBe(pro);
  });

  it('getRouter("professional") is a singleton (same instance on repeat calls)', () => {
    const a = AIRouterManager.getRouter('professional');
    const b = AIRouterManager.getRouter('professional');
    expect(a).toBe(b);
  });

  it('PROFESSIONAL chain uses Grok FIRST and Claude only as the LAST resort', () => {
    const chain = AIRouterManager.getRouter('professional').getProviderChain();
    expect(chain.length).toBeGreaterThan(1);

    // Grok must be the highest-priority (first) provider.
    expect(chain[0].name).toBe('GROK');

    // Claude (ANTHROPIC) must be present and strictly last.
    const names = chain.map(p => p.name);
    expect(names).toContain('ANTHROPIC');
    expect(chain[chain.length - 1].name).toBe('ANTHROPIC');

    // No Anthropic provider may appear before a non-Anthropic one.
    const firstAnthropic = names.indexOf('ANTHROPIC');
    const lastNonAnthropic = names.map((n, i) => (n !== 'ANTHROPIC' ? i : -1)).filter(i => i >= 0).pop()!;
    expect(firstAnthropic).toBeGreaterThan(lastNonAnthropic);
  });

  it('FREE chain never reaches Claude/Anthropic', () => {
    const chain = AIRouterManager.getRouter('free').getProviderChain();
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.some(p => p.name === 'ANTHROPIC')).toBe(false);
  });

  it('PRO chain still leads with Claude (regression — PRO is Claude-first)', () => {
    const chain = AIRouterManager.getRouter('pro').getProviderChain();
    expect(chain[0].name).toBe('ANTHROPIC');
  });
});
