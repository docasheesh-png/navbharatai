/**
 * Adapts Pro's resilient multi-provider model call (`ModelCall`) into an
 * `AIProvider` so the EngineerAI agentic loop's `AIRouter` can drive it WITHOUT
 * any change to the loop. This is what lets Pro keep its OWN model (not Grok):
 * the loop calls `router.route()`, the router calls this provider, and this
 * provider delegates to whatever model Pro already uses.
 *
 * `name` is its OWN `'PRO'` union member (not a reused one) so it gets a
 * dedicated cooldown / in-flight bucket in AIRouter and never collides with the
 * real AiCreditsProvider's shared module-level state. `healthCheck()` returns
 * true because the underlying `ModelCall` has its own internal provider fallback —
 * returning false here would make the loop emit its Grok-only "no provider"
 * error at startup.
 */
import type { AIProvider, AIProviderResponse } from '../../AI/Router/ProviderTypes';
import type { ModelCall } from '../../project/aiEdits';

export class ProModelProvider implements AIProvider {
  name = 'PRO' as const;
  priority = 0;

  constructor(private callModel: ModelCall) {}

  async execute(
    prompt: string,
    _schema?: any,
    _modelOverride?: string,
    systemPrompt?: string,
  ): Promise<AIProviderResponse> {
    const start = Date.now();
    const content = await this.callModel(systemPrompt ?? '', prompt);
    return {
      content,
      latencyMs: Date.now() - start,
      provider: 'PRO',
      model: 'navbharat-pro',
    };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
