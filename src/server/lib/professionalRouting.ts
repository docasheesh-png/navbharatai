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
import { chatTurnCost, type ChatTurnUsage } from './chatSpend';
import { recordAiSpend } from './aiSpendZone';
import { assistantSpendStore } from './AssistantSpendStore';
import { usdInrRate } from './UsdInrRate';

export type ProfessionalTier = 'free' | 'paid';

/** One answered turn: the text the user gets, plus what it cost us to produce. */
export interface ProfessionalAnswer {
  content: string;
  /**
   * What the provider reported for this call — the input to chatSpend.chatTurnCost. `usage` is absent
   * when the provider reported nothing, which callers must treat as UNMEASURED rather than free.
   * ADMIN-ONLY: `provider`/`model` are vendor identities and must never reach a user-facing surface
   * (White-Label Law §2) — they exist here so the cost can be priced against the right rate card.
   */
  spend: ChatTurnUsage;
}

/**
 * Call the Professional-AI resilient chain and return the model's text AND what it cost.
 *
 * The text-only `callProfessionalAI` below stays the entry point for every existing caller; this is
 * the same chain with the cost kept instead of discarded. Until now the router's answer carried no
 * token usage at all, so every AI outside the v5 builder was unpriced — see chatSpend.ts.
 *
 * `tier` picks the fallback universe (default 'free' — the cheap, Claude-free path the Other-AI tools
 * should use). Throws only when every provider in the chain fails (the caller then reports an honest
 * error — never a fake result).
 */
export async function callProfessionalAIWithUsage(
  systemPrompt: string,
  prompt: string,
  tier: ProfessionalTier = 'free',
): Promise<ProfessionalAnswer> {
  const answer = (response: { content: string; provider?: string; model?: string; usage?: { inputTokens: number; outputTokens: number } }): ProfessionalAnswer => {
    const spend: ChatTurnUsage = {
      provider: response.provider,
      model: response.model,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    };
    // THE ONE LINE that gives every Other-AI tool correct billing without its own plumbing: any caller
    // running inside a spend zone accumulates this call automatically, including a tool that fans out
    // over batches and makes a dozen of them. See aiSpendZone.ts. A no-op outside a zone.
    recordAiSpend(spend);
    // WHICH RUNG ANSWERED — recorded in the same place, for the same reason. Our assistants are
    // effectively free only because the tier-1 leader is priced at zero, which is a VENDOR's decision.
    // If that changes, every turn quietly routes to a paid rung below and nothing breaks, nothing
    // complains, and the bill moves — so the free/paid split has to be measured while it is still
    // boring. Sitting beside recordAiSpend is what makes it cover every professional and every
    // Other-AI tool by construction, rather than by remembering to add it at each call site.
    // Deliberately NOT awaited: a telemetry write must never delay or fail a user's answer.
    void assistantSpendStore.record({
      provider: spend.provider,
      model: spend.model,
      cost: chatTurnCost(spend, usdInrRate()),
    });
    return { content: response.content, spend };
  };

  // Tier-1 leader (both tiers) — GLM-flash. Any failure/rate-limit/empty reply falls through silently.
  try {
    const leader = AIRouterManager.getRouter('professional-free');
    const { response, telemetry } = await leader.routeRaced(prompt, systemPrompt);
    if (telemetry.success && response.content?.trim()) return answer(response);
  } catch { /* fall through to the tier's fallback universe */ }

  const fallbackNs = tier === 'free' ? 'professional-free-fallback' : 'professional';
  const router = AIRouterManager.getRouter(fallbackNs);
  const { response, telemetry } = await router.routeRaced(prompt, systemPrompt);
  if (telemetry.success && response.content?.trim()) return answer(response);
  throw new Error('All AI providers failed.');
}

/**
 * Call the Professional-AI resilient chain and return the model's text. Unchanged for every caller —
 * it now simply drops the cost half of the answer above.
 */
export async function callProfessionalAI(
  systemPrompt: string,
  prompt: string,
  tier: ProfessionalTier = 'free',
): Promise<string> {
  const { content } = await callProfessionalAIWithUsage(systemPrompt, prompt, tier);
  return content;
}
