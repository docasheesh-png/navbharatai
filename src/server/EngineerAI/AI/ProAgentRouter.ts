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
 * Phase 73 — Extended thinking: when `thinkingBudget` is set, attempts a direct
 * AnthropicProvider call (Claude Opus with thinking enabled) before falling back
 * to the standard callModel path. This gives complex tasks deeper reasoning while
 * keeping simple tasks fast and cheap.
 *
 * Pro keeps its OWN model here — the loop never touches Grok.
 */
import { AIRouter } from '../../AI/Router/AIRouter';
import type { AIProviderResponse, ProviderTelemetry } from '../../AI/Router/ProviderTypes';
import type { ModelCall } from '../../project/aiEdits';
import { AnthropicProvider } from '../../AI/Router/providers/AnthropicProvider';

export class ProAgentRouter extends AIRouter {
  private thinkingProvider: AnthropicProvider | null = null;

  constructor(
    private callModel: ModelCall,
    thinkingBudget?: number,
  ) {
    super();
    if (thinkingBudget && process.env.ANTHROPIC_API_KEY) {
      const provider = new AnthropicProvider('claude-opus-4-8');
      provider.enableThinking = true;
      provider.thinkingBudget = thinkingBudget;
      this.thinkingProvider = provider;
    }
  }

  async hasHealthyProvider(): Promise<boolean> {
    return true;
  }

  async route(
    prompt: string,
    systemPrompt?: string,
  ): Promise<{ response: AIProviderResponse; telemetry: ProviderTelemetry }> {
    const start = Date.now();
    // Extended thinking path: use AnthropicProvider directly for deeper reasoning.
    if (this.thinkingProvider) {
      try {
        const response = await this.thinkingProvider.execute(prompt, undefined, undefined, systemPrompt);
        const latency = Date.now() - start;
        return {
          response: { ...response, provider: 'ANTHROPIC' },
          telemetry: { provider: 'ANTHROPIC', retries: 0, latency, success: true },
        };
      } catch {
        // Fall through to callModel on any error (network, rate-limit, etc.)
      }
    }
    const content = await this.callModel(systemPrompt ?? '', prompt);
    const latency = Date.now() - start;
    return {
      response: { content, latencyMs: latency, provider: 'PRO', model: 'navbharat-pro' },
      telemetry: { provider: 'PRO', retries: 0, latency, success: true },
    };
  }
}
