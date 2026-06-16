import { AIRouter } from '../AI/Router/AIRouter';
import { AnthropicProvider } from '../AI/Router/providers/AnthropicProvider';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';

// Standalone router for Engineer AI — Claude first, Grok as fallback.
// Deliberately NOT routed through AIRouterManager: that manager's 'pro'/'free'
// singletons are shared, high-traffic infra for every other AI feature, and
// Engineer AI's agent loop has very different call shape (frequent, large,
// long-running JSON-plan requests) that has no business sharing those pools.
export function buildEngineerRouter(): AIRouter {
  const router = new AIRouter();

  const claude = new AnthropicProvider();
  claude.priority = 1;
  router.registerProvider(claude);

  const grok = new GrokProvider();
  grok.priority = 2;
  router.registerProvider(grok);

  return router;
}
