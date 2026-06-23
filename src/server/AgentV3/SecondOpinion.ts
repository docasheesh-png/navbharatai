// AgentV3 — second_opinion tool (Layer 84: Multi-Model Ensemble).
//
// Claude builds; a DIFFERENT model gives a critical cross-check. This is the
// realistic "beyond a single model" lever: the Architect can ask for a genuinely
// independent review of a risky decision or a finished piece of work, and act on
// it. The review is produced by NavBharatAI's existing NON-Claude multi-provider
// router (Vertex → Gemini → Grok), so the opinion really does come from another
// model family — not the same Claude that wrote the code.
//
// Kept free of any `../routes` import (strangler-fig isolation): the module
// defines its own minimal OpinionRouter port, and the composition root adapts
// the real AIRouter to it. The function NEVER throws — if the router is missing
// or fails, it returns a clear, honest message so the build is never blocked.

/**
 * The narrow slice of a text router the second opinion needs (structural — DI/
 * tests). The real free-chain AIRouter satisfies this shape; the composition root
 * adapts it. Defined locally so AgentV3 imports nothing from `../routes`.
 */
export interface OpinionRouter {
  route(prompt: string, systemPrompt?: string): Promise<{ response: { content: string; provider: string } }>;
}

/** Ask a different model to critically review the given prompt/artifact. */
export type SecondOpinion = (prompt: string) => Promise<string>;

/** The reviewer persona — a different model acting as an independent critic. */
const REVIEWER_SYSTEM = [
  'You are a senior independent reviewer from a DIFFERENT AI model than the one',
  'that produced the work. Critically review the following for bugs, security',
  'issues, missing pieces, and incorrect assumptions. Be specific and concise —',
  'point to the exact problem, not generalities. If it looks correct, say so',
  'plainly rather than inventing concerns.',
].join('\n');

/**
 * Build a second-opinion function bound to a non-Claude router. The returned
 * function sends the prompt to that router under the reviewer persona and returns
 * the critique tagged with the provider that answered. It never throws: on any
 * failure it returns a "Second opinion unavailable: <reason>" string so the
 * Architect can continue without it.
 */
export function makeSecondOpinion(router: OpinionRouter): SecondOpinion {
  return async (prompt: string): Promise<string> => {
    try {
      const { response } = await router.route(prompt, REVIEWER_SYSTEM);
      return `[second opinion via ${response.provider}]\n${response.content}`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return `Second opinion unavailable: ${reason}`;
    }
  };
}
