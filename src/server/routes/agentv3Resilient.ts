// AgentV3 resilient turn runner (composition-root wiring).
//
// v5.0's engine speaks the NATIVE Anthropic tool-use API (ClaudeClient) — that
// is what enables real app building. But chat must never die just because the
// Claude provider is misconfigured, throttled, or down. This wrapper tries
// Claude first and, if that turn fails, falls back to NavBharatAI's existing
// multi-provider router (Vertex → Gemini → Grok — no Claude) for a TEXT reply,
// so the conversation always gets an answer.
//
// The fallback reply names the provider that actually answered. That doubles as
// a live diagnostic: if a Vertex/Gemini/Grok reply comes back, ONLY Claude is
// failing; if even those are silent, every provider/key is down. Admin
// (aashishcpmt09) explicitly asked for this multi-provider chat resilience.
//
// Kept OUT of the AgentV3 module on purpose: the module imports nothing from the
// live AI router (strangler-fig isolation). The route is the composition root,
// so the coupling to shared infra lives here, exactly like the actuator wiring.
import type { TurnRunner, TurnResult, RunTurnParams } from '../AgentV3';
import { AIRouterManager } from '../AI/AIRouterManager';

/** The narrow slice of the AIRouter the fallback needs (structural — DI/tests). */
export interface RouterLike {
  route(prompt: string, systemPrompt?: string): Promise<{ response: { content: string; provider: string } }>;
}

/**
 * Flatten the native tool-use transcript into a plain prompt for the text-only
 * fallback router (which has no native tool API). Conversational turns are just
 * user/assistant text; tool blocks are summarised so context survives.
 */
export function flattenTranscript(messages: unknown[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const mm = m as { role?: string; content?: unknown };
    let text = '';
    if (typeof mm.content === 'string') {
      text = mm.content;
    } else if (Array.isArray(mm.content)) {
      text = mm.content
        .map((b) => {
          if (typeof b === 'string') return b;
          const bb = b as { type?: string; text?: string; content?: unknown };
          if (bb.type === 'text') return bb.text ?? '';
          if (bb.type === 'tool_result') {
            return `[tool result] ${typeof bb.content === 'string' ? bb.content : ''}`;
          }
          return '';
        })
        .filter(Boolean)
        .join(' ');
    }
    if (text.trim()) parts.push(`${mm.role === 'assistant' ? 'Assistant' : 'User'}: ${text.trim()}`);
  }
  return parts.join('\n');
}

/** A text-only TurnResult (no native tool calls) — ends the agent loop with a reply. */
function textTurn(text: string): TurnResult {
  return {
    text,
    toolUses: [],
    stopReason: 'end_turn',
    usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    rawContent: [{ type: 'text', text }],
  };
}

/**
 * Wrap a primary TurnRunner (Claude) with a multi-provider text fallback. The
 * fallback router is injectable so it can be unit-tested without real providers.
 */
export function makeResilientTurnRunner(
  primary: TurnRunner,
  getRouter: () => RouterLike = () => AIRouterManager.getRouter('free') as unknown as RouterLike,
): TurnRunner {
  return {
    async runTurn(params: RunTurnParams): Promise<TurnResult> {
      try {
        return await primary.runTurn(params);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // Surface the EXACT Claude failure in the logs (greppable tag) so the
        // root cause is visible without reading the chat reply. The status code
        // (401 = bad key, 400 = credit/model, 404 = model) pinpoints the fix.
        const status = (err as { status?: number })?.status;
        console.error(`[AGENTV3][CLAUDE_FAIL] status=${status ?? 'n/a'} reason=${reason.slice(0, 300)}`);
        try {
          const { response } = await getRouter().route(flattenTranscript(params.messages), params.system);
          const note = `_(Claude unavailable — ${reason.slice(0, 140)}. Replied via ${response.provider}.)_\n\n`;
          return textTurn(note + response.content);
        } catch (fallbackErr) {
          // Even the fallback router failed — surface both failures honestly.
          const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          return textTurn(
            `All AI providers are currently failing. Claude: ${reason.slice(0, 140)}. Fallback: ${fb.slice(0, 140)}.`,
          );
        }
      }
    },
  };
}
