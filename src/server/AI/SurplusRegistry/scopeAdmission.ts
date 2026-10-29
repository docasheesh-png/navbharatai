import type { TurnResult } from '../../AgentV3/ClaudeClient';
import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import { recordedTextCall } from '../../AgentV3/recordedTextCall';
import type { SurplusBuildSession } from './buildSession';
import { readScopeFailure, type ScopeFailureDiagnostic } from '../../AgentV3/scopeFailureDiagnostic';

type ScopeRecord = Omit<LlmCallRecord, 'ts'>;
export const SURPLUS_SCOPE_PURPOSE = 'Build scope admission classification';
/** DNA (05011): quality-first admits reasoning models (e.g. gpt-5.6-sol). An 8-token cap is consumed by
 * hidden reasoning, the completion comes back with empty content → empty_completion → "Build scope
 * classification failed" → mid_build_engine_unavailable → Weak/Kimi builds the app. The label is
 * still one short word; this is only the ceiling, billed on actual usage. */
export const SURPLUS_SCOPE_MAX_TOKENS = 1024;
/** DNA (05016): the Weak scope deadline (5s) was sized for glm-4.7-flashx. Admitted Surplus models are
 * reasoning models (gpt-5.6-sol) whose single-word answer routinely needs >5s of hidden reasoning, so the
 * race aborted a healthy call → scope_timeout → "could not confirm this fits Weak" (₹0, coding never
 * started). The Surplus-driven scope ask gets a reasoning-sized deadline; GLM keeps 5s. */
export const SURPLUS_SCOPE_TIMEOUT_MS = 30_000;

/** One recorded classification door, including rejected/chat-only requests without a build report.
 * Buffers retain measured usage and immutable receipt authority, never prompt/response contents. */
export function createSurplusScopeAsk(
  session: SurplusBuildSession | undefined,
  turns: TurnResult[],
  records: ScopeRecord[],
  observe?: (row: Readonly<ScopeRecord>) => void,
  /** Private recovery observation. Never serialized into report or public output. */
  onFailure?: (error: unknown) => void,
): ((system: string, user: string, signal?: AbortSignal) => Promise<{ text: string }>) | undefined {
  if (!session) return undefined; // OFF: no runner, observation, or additional provider call
  return async (system, user, signal) => {
    let measured: Pick<LlmCallRecord, 'inputTokens' | 'outputTokens' | 'responseChars'> | undefined;
    // Enumerated internal stage only (never upstream text): "provider=unknown" alone hid that 05011–05013
    // failed at the durable reservation, before any HTTP request — so token/param fixes could not help.
    let failedAt: Readonly<ScopeFailureDiagnostic> | undefined;
    try {
      const result = await recordedTextCall({
        // Construct inside runTurn so even a synchronous runner-factory failure is recorded.
        makeRunner: onUsed => ({ runTurn: async params => {
          try {
            return await session.runner({ onTurnComplete: turn => {
              onUsed('SURPLUS');
              measured = { inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, responseChars: turn.text.length };
              turns.push({ ...turn, usage: { ...turn.usage }, text: '', rawContent: [], toolUses: [] });
            } }).runTurn(params);
          } catch (error) { failedAt = readScopeFailure(error); throw error; }
        } }),
        identify: (reported, used, answered) => ({ provider: reported ? used ?? 'unknown' : 'unknown', model: answered ?? 'unknown' }),
        recordLlmCall: row => {
          const sanitized: ScopeRecord = { ...row, ...(!row.ok && measured ? measured : {}), promptPreview: SURPLUS_SCOPE_PURPOSE,
            promptChars: system.length + user.length, responsePreview: '',
            ...(row.ok ? {} : { error: failedAt ? `Build scope classification failed (stage=${failedAt.stage} reason=${failedAt.reason})` : 'Build scope classification failed' }) };
          records.push(sanitized);
          // Audit failure cannot suppress the buffered outcome or break classification.
          try { observe?.(Object.freeze({ ...sanitized })); } catch { /* best-effort bounded audit */ }
        },
      }, { model: session.model, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: SURPLUS_SCOPE_MAX_TOKENS, signal },
      { promptPreview: SURPLUS_SCOPE_PURPOSE });
      return { text: result.text };
    } catch (error) {
      try { onFailure?.(error); } catch { /* observation cannot alter the original failure */ }
      throw error;
    }
  };
}
