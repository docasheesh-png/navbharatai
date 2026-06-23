import { AIRouter } from '../AI/Router/AIRouter';
import { GrokProvider } from '../AI/Router/providers/GrokProvider';
import { AnthropicProvider } from '../AI/Router/providers/AnthropicProvider';
import { VertexProvider } from '../AI/Router/providers/VertexProvider';
import { GeminiProvider } from '../AI/Router/providers/GeminiProvider';

// Standalone router for Engineer AI.
// Priority order: Grok → Anthropic → Vertex → Gemini
// Grok is the primary provider (fast, xAI). The others are automatic fallbacks
// so Engineer AI keeps working when Grok is down/throttled.
//
// Keys: GROK_API_KEY/XAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_APPLICATION_CREDENTIALS, GEMINI_API_KEY
// Set these in Cloud Run → Edit & Deploy → Variables & Secrets.
//
// Deliberately NOT routed through AIRouterManager: that manager's 'pro'/'free'
// singletons are shared, high-traffic infra for every other AI feature.
// Engineer AI keeps its own isolated router so provider failures here never
// bleed into the main chat and vice-versa.
//
// The aicredits proxy provider has been removed app-wide; user builds run only
// on the user's own provider keys (Grok/Vertex/Gemini), never on NavBharatAI's
// account credits.
export function buildEngineerRouter(): AIRouter {
  const router = new AIRouter();

  // Priority 1 — Grok (xAI): fast inference, primary model for all builds.
  try {
    const grok = new GrokProvider();
    grok.priority = 1;
    router.registerProvider(grok);
  } catch {}

  // Priority 2 — Anthropic (Claude): strong coding model, first fallback.
  try {
    const anthropic = new AnthropicProvider();
    anthropic.priority = 2;
    router.registerProvider(anthropic);
  } catch {}

  // Priority 3 — Vertex AI (Gemini 2.5 Pro): Google cloud fallback.
  try {
    const vertex = new VertexProvider();
    vertex.priority = 3;
    router.registerProvider(vertex);
  } catch {}

  // Priority 4 — Gemini direct API: last resort, no GCP service account needed.
  try {
    const gemini = new GeminiProvider();
    gemini.priority = 4;
    router.registerProvider(gemini);
  } catch {}

  return router;
}
