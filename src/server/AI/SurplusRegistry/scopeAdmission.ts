import type { TurnResult } from '../../AgentV3/ClaudeClient';
import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import { recordedTextCall } from '../../AgentV3/recordedTextCall';
import type { SurplusBuildSession } from './buildSession';

type ScopeRecord = Omit<LlmCallRecord, 'ts'>;
export const SURPLUS_SCOPE_PURPOSE = 'Build scope admission classification';

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
    try {
      const result = await recordedTextCall({
        // Construct inside runTurn so even a synchronous runner-factory failure is recorded.
        makeRunner: onUsed => ({ runTurn: params => session.runner({ onTurnComplete: turn => {
          onUsed('SURPLUS');
          measured = { inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, responseChars: turn.text.length };
          turns.push({ ...turn, usage: { ...turn.usage }, text: '', rawContent: [], toolUses: [] });
        } }).runTurn(params) }),
        identify: (reported, used, answered) => ({ provider: reported ? used ?? 'unknown' : 'unknown', model: answered ?? 'unknown' }),
        recordLlmCall: row => {
          const sanitized: ScopeRecord = { ...row, ...(!row.ok && measured ? measured : {}), promptPreview: SURPLUS_SCOPE_PURPOSE,
            promptChars: system.length + user.length, responsePreview: '',
            ...(row.ok ? {} : { error: 'Build scope classification failed' }) };
          records.push(sanitized);
          // Audit failure cannot suppress the buffered outcome or break classification.
          try { observe?.(Object.freeze({ ...sanitized })); } catch { /* best-effort bounded audit */ }
        },
      }, { model: session.model, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8, signal },
      { promptPreview: SURPLUS_SCOPE_PURPOSE });
      return { text: result.text };
    } catch (error) {
      try { onFailure?.(error); } catch { /* observation cannot alter the original failure */ }
      throw error;
    }
  };
}
