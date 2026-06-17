import { AIRouter } from '../AI/Router/AIRouter';
import { AiCreditsProvider } from '../AI/Router/providers/AiCreditsProvider';
import { AnthropicProvider } from '../AI/Router/providers/AnthropicProvider';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';

// Standalone router for Engineer AI — AiCredits first, then Anthropic, then Grok.
// Deliberately NOT routed through AIRouterManager: that manager's 'pro'/'free'
// singletons are shared, high-traffic infra for every other AI feature.
export function buildEngineerRouter(): AIRouter {
  const router = new AIRouter();

  try {
    const aicredits = new AiCreditsProvider();
    aicredits.priority = 1;
    router.registerProvider(aicredits);
  } catch {}

  try {
    const claude = new AnthropicProvider();
    claude.priority = 2;
    router.registerProvider(claude);
  } catch {}

  try {
    const grok = new GrokProvider();
    grok.priority = 3;
    router.registerProvider(grok);
  } catch {}

  return router;
}
