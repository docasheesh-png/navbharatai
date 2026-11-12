import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIRouterManager } from '../src/server/AI/AIRouterManager';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { AIProvider, AIProviderResponse } from '../src/server/AI/Router/ProviderTypes';

// Minimal fake provider for routing behavior tests.
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
 * Routing shape: Grok → Gemini → Vertex → Claude Haiku, sequentially.
 * A provider is called only after the preceding provider fails, so one successful answer incurs one provider call.
 *
 * Proves the core-law guarantees:
 *   1. PROFESSIONAL is its own router instance, isolated from FREE and PRO.
 *   2. The ordered paid fallback rungs are Grok / Gemini / Vertex (no Claude before them).
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

  it('PROFESSIONAL orders Grok → Gemini → Vertex; Claude is the ONLY last resort', () => {
    const chain = AIRouterManager.getRouter('professional').getProviderChain();

    // The paid fallback ladder is ordered; Claude remains isolated at the end.
    const rungs = chain.filter(p => !p.lastResort).map(p => p.name);
    expect(rungs).toEqual(['GROK', 'GEMINI', 'VERTEX']);

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

describe('paid professional routing avoids speculative duplicate provider spend', () => {
  it('production callers use the sequential route for paid professional fallback', () => {
    const routing = readFileSync(join(process.cwd(), 'src/server/lib/professionalRouting.ts'), 'utf8');
    const sda = readFileSync(join(process.cwd(), 'src/server/routes/sda.ts'), 'utf8');
    expect(routing).toContain('router.route(prompt, systemPrompt, undefined, undefined, opts.signal)');
    expect(routing).not.toContain('router.routeRaced(prompt, systemPrompt, undefined, opts.signal)');
    expect(sda).toContain('professionalRouter.route(fallbackPrompt, SDA_SYSTEM_FINAL)');
    expect(sda).not.toContain('professionalRouter.routeRaced(');
    // Paid text is handled once by the shared chain; direct races and direct Vertex/Claude retries are multimodal-only.
    expect(sda).toContain('if (sdaGrokKey && isImage && sdaTier === \'paid\')');
    expect(sda).toContain('if (sdaGeminiKey && (isImage || isPDF))');
    expect(sda).toContain('if (!reply && (isImage || isPDF || sdaTier === \'free\'))');
    expect(sda).toContain('if (!reply && sdaTier === \'paid\' && (isImage || isPDF))');
  });

  it('a successful first rung does not call later providers', async () => {
    const grok = vi.fn(); const gemini = vi.fn(); const vertex = vi.fn(); const claude = vi.fn();
    const router = new AIRouter('professional');
    router.registerProvider(fakeProvider('GROK', 1, 'ok', { spy: grok }));
    router.registerProvider(fakeProvider('GEMINI', 2, 'ok', { spy: gemini }));
    router.registerProvider(fakeProvider('VERTEX', 3, 'ok', { spy: vertex }));
    router.registerProvider(fakeProvider('ANTHROPIC', 99, 'ok', { lastResort: true, spy: claude }));
    const { telemetry } = await router.route('hi', 'sys');
    expect(telemetry.success).toBe(true);
    expect(grok).toHaveBeenCalledTimes(1);
    expect(gemini).not.toHaveBeenCalled();
    expect(vertex).not.toHaveBeenCalled();
    expect(claude).not.toHaveBeenCalled();
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
