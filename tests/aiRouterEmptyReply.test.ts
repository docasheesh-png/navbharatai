import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import { resetAllBreakers } from '../src/server/AI/Router/CircuitBreaker';
import type { AIProvider, AIProviderResponse } from '../src/server/AI/Router/ProviderTypes';

/**
 * Round-10 — a provider returning HTTP 200 with EMPTY content must be treated as a failure so the
 * router falls through to the next provider, on EVERY path (sequential route() + raced routeRaced()).
 * Previously the sequential path accepted an empty reply as success → blank user reply + skipped
 * fallback + falsely-healthy breaker.
 */
function provider(
  name: AIProvider['name'],
  priority: number,
  content: string,
  spy?: () => void,
  opts: { lastResort?: boolean } = {},
): AIProvider {
  return {
    name,
    priority,
    lastResort: opts.lastResort,
    healthCheck: async () => true,
    execute: async (): Promise<AIProviderResponse> => {
      spy?.();
      return { content, latencyMs: 1, provider: name, model: 'test' };
    },
  };
}

describe('AIRouter — empty reply is not success', () => {
  beforeEach(() => resetAllBreakers());

  it('route() (sequential) falls through an empty-content provider to the next one', async () => {
    const emptySpy = vi.fn();
    const okSpy = vi.fn();
    const router = new AIRouter('test-seq');
    router.registerProvider(provider('GEMINI', 1, '   ', emptySpy)); // 200 but whitespace-only
    router.registerProvider(provider('VERTEX', 2, 'real answer', okSpy));

    const { response, telemetry } = await router.route('hi');
    expect(emptySpy).toHaveBeenCalled();          // the empty provider WAS tried
    expect(response.content).toBe('real answer'); // ...and we fell through to the next
    expect(telemetry.provider).toBe('VERTEX');
  });

  it('routeRaced() ignores an empty racer and returns the non-empty one', async () => {
    const router = new AIRouter('test-race');
    router.registerProvider(provider('GEMINI', 1, ''));            // empty racer
    router.registerProvider(provider('GROK', 2, 'grok answer'));   // real racer
    const { response } = await router.routeRaced('hi');
    expect(response.content).toBe('grok answer');
  });

  it('route() surfaces the graceful last-resort message when EVERY provider is empty', async () => {
    const router = new AIRouter('test-allempty');
    router.registerProvider(provider('GEMINI', 1, ''));
    router.registerProvider(provider('VERTEX', 2, '   '));
    const { telemetry } = await router.route('hi');
    // No provider answered → not reported as a provider success.
    expect(telemetry.success).toBe(false);
  });
});
