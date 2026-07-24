// Shared Professional-AI model routing (admin 2026-07-24: "Other AI ki API call = Professional AI").
//
// WHY THIS EXISTS: the 70+ config-driven professionals (Doctor AI, Lawyer AI, …) answer through one
// resilient model chain, while the "Other AI" tools (AI Debugger, Design pass, …) used the flat 'free'
// router. The admin wants the Other-AI tools to use the SAME AI as Professional AI. Rather than copy the
// chain into every tool (which would drift — rule 2/3), the professional chain lives HERE, and BOTH the
// professionals engine and the Other-AI tools call this one function. One implementation, no drift.
//
// The chain (identical to what the professionals used):
//   1. professional-free  → GLM-4.7-Flash (leader, both tiers).
//   2. on failure: free tier → professional-free-fallback (Vertex Gemini flash / flash-lite);
//                  paid tier → professional (RACE Grok × Gemini × Vertex → Claude-Haiku last resort).
//
// WHITE-LABEL: this returns raw model content; callers keep their own white-label system prompts, so no
// provider identity ever leaks to the user.

import { AIRouterManager } from '../AI/AIRouterManager';

export type ProfessionalTier = 'free' | 'paid';

/**
 * Call the Professional-AI resilient chain and return the model's text. `tier` picks the fallback
 * universe (default 'free' — the cheap, Claude-free path the Other-AI tools should use). Throws only
 * when every provider in the chain fails (the caller then reports an honest error — never a fake result).
 */
export async function callProfessionalAI(
  systemPrompt: string,
  prompt: string,
  tier: ProfessionalTier = 'free',
): Promise<string> {
  // Tier-1 leader (both tiers) — GLM-flash. Any failure/rate-limit/empty reply falls through silently.
  try {
    const leader = AIRouterManager.getRouter('professional-free');
    const { response, telemetry } = await leader.routeRaced(prompt, systemPrompt);
    if (telemetry.success && response.content?.trim()) return response.content;
  } catch { /* fall through to the tier's fallback universe */ }

  const fallbackNs = tier === 'free' ? 'professional-free-fallback' : 'professional';
  const router = AIRouterManager.getRouter(fallbackNs);
  const { response, telemetry } = await router.routeRaced(prompt, systemPrompt);
  if (telemetry.success && response.content?.trim()) return response.content;
  throw new Error('All AI providers failed.');
}
