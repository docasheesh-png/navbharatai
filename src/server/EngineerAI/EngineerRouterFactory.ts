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

  // GROK ONLY (hard product rule). AiCreditsProvider defaults to a Claude model,
  // so registering it as a *live* fallback would silently route Engineer AI to
  // Claude on ANY transient Grok failure/cooldown (429, timeout, 503) — exactly
  // what's forbidden. Register it ONLY when no Grok key exists, purely so the
  // feature isn't dead in dev/CI. In production (Grok key set) Claude is never
  // even registered, so it can never be reached.
  const hasGrok = !!(process.env.GROK_API_KEY || process.env.XAI_API_KEY);
  if (!hasGrok) {
    try {
      const aicredits = new AiCreditsProvider();
      aicredits.priority = 2;
      router.registerProvider(aicredits);
    } catch {}
  }

  return router;
}
