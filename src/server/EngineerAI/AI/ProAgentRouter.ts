/**
 * A minimal AIRouter that drives the EngineerAI agentic loop directly off Pro's
 * own resilient model call (`ModelCall`).
 *
 * Why a subclass instead of registering an AIProvider: the base AIRouter routes
 * every call through a module-level concurrency gate (`MAX_IN_FLIGHT`) and a
 * shared per-provider cooldown map. Those are correct for real remote providers,
 * but wrong for a per-request, always-available local delegate — they'd impose a
 * global 8-concurrent ceiling on Pro's agentic engine (silently degrading it to
 * the fallback pipeline under load) and couple every request to shared mutable
 * state. Overriding just the two methods the loop uses (`route`,
 * `hasHealthyProvider`) bypasses that global state entirely: deterministic,
 * unbounded by other requests, and isolated from the rest of the router.
 *
 * Pro keeps its OWN model here — the loop never touches Grok.
 */
import { AIRouter } from '../../AI/Router/AIRouter';
import type { AIProviderResponse, ProviderTelemetry } from '../../AI/Router/ProviderTypes';
import type { ModelCall } from '../../project/aiEdits';

export class ProAgentRouter extends AIRouter {
  constructor(private callModel: ModelCall) {
    super();
  }

  async hasHealthyProvider(): Promise<boolean> {
    return true;
  }

  async route(
    prompt: string,
    systemPrompt?: string,
  ): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const start = Date.now();
    const content = await this.callModel(systemPrompt ?? '', prompt);
    const latency = Date.now() - start;
    return {
      response: { content, latencyMs: latency, provider: 'PRO', model: 'navbharat-pro' },
      telemetry: { provider: 'PRO', retries: 0, latency, success: true },
    };
  }
}
