import { AIRouter } from '../AI/Router/AIRouter';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';
import { AiCreditsProvider } from '../AI/Router/providers/AiCreditsProvider';

// Standalone router for Engineer AI.
// PRIMARY: Grok (xAI). Fast, reliable, no 90-second proxy hang.
// FALLBACK: AiCredits (claude proxy) — used only if GROK_API_KEY is absent.
//
// Set GROK_API_KEY (or XAI_API_KEY) in Cloud Run → Edit & Deploy → Variables & Secrets.
// Get your key at: https://console.x.ai/
//
// Deliberately NOT routed through AIRouterManager: that manager's 'pro'/'free'
// singletons are shared, high-traffic infra for every other AI feature.
export function buildEngineerRouter(): AIRouter {
  const router = new AIRouter();

  const grok = new GrokProvider();
  grok.priority = 1;
  router.registerProvider(grok);

  try {
    const aicredits = new AiCreditsProvider();
    aicredits.priority = 2;
    router.registerProvider(aicredits);
  } catch {}

  return router;
}
