import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { AIProvider, AIProviderResponse } from '../src/server/AI/Router/ProviderTypes';

// Minimal fake provider for behavioral race tests.
function fakeProvider(
  name: AIProvider['name'],
  priority: number,
  behavior: 'ok' | 'fail',
  opts: { lastResort?: boolean; delayMs?: number; spy?: () => void } = {},
): AIProvider {
  return {
    name,
    priority,
    lastResort: opts.lastResort,
    healthCheck: async () => true,
    execute: async (): Promise<AIProviderResponse> => {
      opts.spy?.();
      if (opts.delayMs) await new Promise(r => setTimeout(r, opts.delayMs));
      if (behavior === 'fail') throw new Error(`${name} down`);
      return { content: `reply from ${name}`, latencyMs: 1, provider: name, model: 'test' };
    },
  };
}

/**
 * P0.1 — Isolated PROFESSIONAL universe router chain.
 *
 * The professional universe covers EVERY professional AI — Doctor AI (SDA),
 * Teacher, Lawyer, CA, Astrologer, Kisan, … — which all share one isolated
 * 'professional' router namespace.
 *
 * Routing shape: RACE Grok × Gemini × Vertex concurrently; Claude Haiku is a
 * LAST-RESORT provider, reached only if the whole race fails.
 *
 * Proves the core-law guarantees:
 *   1. PROFESSIONAL is its own router instance, isolated from FREE and PRO.
 *   2. The race participants are Grok / Gemini / Vertex (no Claude in the race).
 *   3. Claude is the ONLY last-resort provider.
 *   4. FREE never reaches Claude/Anthropic.
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

  it('PROFESSIONAL races Grok × Gemini × Vertex; Claude is the ONLY last resort', () => {
    const chain = AIRouterManager.getRouter('professional').getProviderChain();

    // Race participants = everything that is NOT last-resort. Claude must not race.
    const racers = chain.filter(p => !p.lastResort).map(p => p.name);
    expect(racers).toContain('GROK');
    expect(racers).not.toContain('ANTHROPIC');
    // Grok leads the race (highest priority among racers).
    expect(chain.filter(p => !p.lastResort)[0].name).toBe('GROK');

    // Claude (ANTHROPIC) is present and is the ONLY last-resort provider.
    const lastResorts = chain.filter(p => p.lastResort).map(p => p.name);
    expect(lastResorts).toEqual(['ANTHROPIC']);
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

describe('routeRaced behavior (P0.1 — race + Claude last resort)', () => {
  it('returns a race winner WITHOUT touching the last-resort Claude', async () => {
    const claudeSpy = vi.fn();
    const router = new AIRouter();
    router.registerProvider(fakeProvider('GROK', 1, 'ok'));                                  // racer, wins
    router.registerProvider(fakeProvider('ANTHROPIC', 99, 'ok', { lastResort: true, spy: claudeSpy }));

    const { response, telemetry } = await router.routeRaced('hi', 'sys');
    expect(telemetry.success).toBe(true);
    expect(response.content).toBe('reply from GROK');
    expect(claudeSpy).not.toHaveBeenCalled(); // Claude must NOT run when a racer succeeds
  });

  it('falls back to Claude Haiku ONLY when every racer fails', async () => {
    const claudeSpy = vi.fn();
    const router = new AIRouter();
    router.registerProvider(fakeProvider('VERTEX', 1, 'fail'));                              // racer fails
    router.registerProvider(fakeProvider('ANTHROPIC', 99, 'ok', { lastResort: true, spy: claudeSpy }));

    const { response, telemetry } = await router.routeRaced('hi', 'sys');
    expect(claudeSpy).toHaveBeenCalledTimes(1); // race failed → Claude reached
    expect(telemetry.success).toBe(true);
    expect(telemetry.provider).toBe('ANTHROPIC');
    expect(response.content).toBe('reply from ANTHROPIC');
  });

  it('returns a graceful failure when the race AND Claude both fail', async () => {
    const router = new AIRouter();
    router.registerProvider(fakeProvider('GEMINI', 1, 'fail'));                              // racer fails
    router.registerProvider(fakeProvider('ANTHROPIC', 99, 'fail', { lastResort: true }));   // last resort fails

    const { telemetry } = await router.routeRaced('hi', 'sys');
    expect(telemetry.success).toBe(false);
    expect(telemetry.provider).toBe('NONE');
  });
});
