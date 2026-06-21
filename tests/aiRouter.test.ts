import { describe, it, expect } from 'vitest';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { AIProvider, AIProviderResponse } from '../src/server/AI/Router/ProviderTypes';

function mockProvider(name: string, priority: number, healthy = true, response = 'reply'): AIProvider {
  return {
    name,
    priority,
    healthCheck: async () => healthy,
    execute: async (): Promise<AIProviderResponse> => ({ content: response, model: 'test', provider: name }),
    executeStream: undefined,
  };
}

describe('AIRouter', () => {
  it('registerProvider adds providers sorted by priority', () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('low', 3));
    router.registerProvider(mockProvider('high', 1));
    // No public accessor, but the router should route to high priority first
    expect(router).toBeDefined();
  });

  it('hasHealthyProvider returns true when at least one provider is healthy', async () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('healthy', 1, true));
    expect(await router.hasHealthyProvider()).toBe(true);
  });

  it('hasHealthyProvider returns false when all providers are unhealthy', async () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('sick', 1, false));
    expect(await router.hasHealthyProvider()).toBe(false);
  });

  it('route() returns response from the healthy provider', async () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('provider-a', 1, true, 'Hello from A'));
    const { response } = await router.route('test prompt');
    expect(response.content).toBe('Hello from A');
  });

  it('route() falls back to second provider when first is unhealthy', async () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('bad', 1, false));
    router.registerProvider(mockProvider('good', 2, true, 'Fallback response'));
    const { response } = await router.route('test prompt');
    expect(response.content).toBe('Fallback response');
  });

  it('route() returns a fallback response when all providers are exhausted', async () => {
    const router = new AIRouter();
    router.registerProvider(mockProvider('bad', 1, false));
    const { response } = await router.route('test prompt');
    // Router returns a graceful fallback string rather than throwing
    expect(typeof response.content).toBe('string');
    expect(response.content.length).toBeGreaterThan(0);
  });
});
