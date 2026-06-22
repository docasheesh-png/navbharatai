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

// Maximum time a single AI reasoning step may take before we abort it.
// Without this, a single Claude Opus + extended-thinking call can block
// the agentic loop for 10-12 minutes, outlasting Cloud Run's request timeout
// and causing "Build stream ended without a result" on the client.
const THINKING_STEP_TIMEOUT_MS = 150_000; // 2.5 min — thinking calls are slow but bounded
const REGULAR_STEP_TIMEOUT_MS  =  90_000; // 90 s  — non-thinking calls should be fast

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

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
        const response = await withTimeout(
          this.thinkingProvider.execute(prompt, undefined, undefined, systemPrompt),
          THINKING_STEP_TIMEOUT_MS,
          'Extended-thinking AI step',
        );
        const latency = Date.now() - start;
        return {
          response: { ...response, provider: 'ANTHROPIC' },
          telemetry: { provider: 'ANTHROPIC', retries: 0, latency, success: true },
        };
      } catch {
        // Fall through to callModel on any error (network, rate-limit, timeout, etc.)
      }
    }
    const content = await withTimeout(
      this.callModel(systemPrompt ?? '', prompt),
      REGULAR_STEP_TIMEOUT_MS,
      'AI step',
    );
    const latency = Date.now() - start;
    return {
      response: { content, latencyMs: latency, provider: 'PRO', model: 'navbharat-pro' },
      telemetry: { provider: 'PRO', retries: 0, latency, success: true },
    };
  }
}
