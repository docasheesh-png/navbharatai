import type { LlmCallRecord } from '../../AgentV3/BuildDiagnostics';
import { recordedTextCall } from '../../AgentV3/recordedTextCall';
import { weakBuildAdmissionAsk } from '../../AgentV3/weakBuildAdmissionAsk';
import { WEAK_SCOPE_MODEL, type AdmissionUsage } from '../../AgentV3/weakBuildAdmission';

type ScopeRecord = Omit<LlmCallRecord, 'ts'>;
export const SCOPE_PURPOSE = 'Build scope admission classification';

/** Classification is always the existing bounded GLM client, never the coding session.
 * Keep measured usage for the GLM ledger and a redacted audit even when no build follows. */
export function createGlmScopeAsk(
  records: ScopeRecord[],
  observe?: (row: Readonly<ScopeRecord>) => void,
): (system: string, user: string, signal: AbortSignal) => Promise<{ text: string; usage?: AdmissionUsage }> {
  return async (system, user, signal) => {
    let usage: AdmissionUsage | undefined;
    const result = await recordedTextCall({
      makeRunner: onUsed => ({ runTurn: async () => {
        const answer = await weakBuildAdmissionAsk(system, user, signal);
        usage = answer.usage;
        onUsed('GLM');
        return { text: answer.text, model: WEAK_SCOPE_MODEL, usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0,
          cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          rawContent: [], toolUses: [], stopReason: answer.finishReason ?? null };
      } }),
      identify: reported => ({ provider: reported ? 'GLM' : 'unknown', model: reported ? WEAK_SCOPE_MODEL : 'unknown' }),
      recordLlmCall: row => {
        const sanitized: ScopeRecord = { ...row, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
          promptPreview: SCOPE_PURPOSE, promptChars: system.length + user.length, responsePreview: '',
          ...(row.ok ? {} : { error: 'Build scope classification failed' }) };
        records.push(sanitized);
        try { observe?.(Object.freeze({ ...sanitized })); } catch { /* audit cannot alter classification */ }
      },
    }, { model: WEAK_SCOPE_MODEL, system, messages: [{ role: 'user', content: user }], tools: [], maxTokens: 8, signal },
    { promptPreview: SCOPE_PURPOSE });
    return { text: result.text, ...(usage ? { usage } : {}) };
  };
}
