import { OpenAiCompatProvider } from '../AI/FreeChain/providers/openAiCompatProvider';
import { cheaperInferenceAdminStatus, CHEAPERINFERENCE_BASE_URL } from './cheaperInferencePolicy';
import type { DiagnosticAdapter } from './providerDiagnosticRunner';
import { LoadBatchError, type LoadBatchAuthority } from './providerLoadBatch';
/** Batch-only ceiling binding. The unrestricted manual diagnostic adapter is unchanged. */
export function providerLoadAdapter(authority: LoadBatchAuthority, env = process.env): DiagnosticAdapter {
  const status = cheaperInferenceAdminStatus(env);
  if (!status.apiKeyConfigured || authority.model !== status.defaultModel) throw new LoadBatchError('unavailable');
  const provider = new OpenAiCompatProvider({ provider: 'CHEAPERINFERENCE', model: authority.model, key: env.CHEAPERINFERENCE_API_KEY!.trim(),
    baseURL: CHEAPERINFERENCE_BASE_URL, priority: 0, maxOutputTokens: authority.maxOutputTokens, timeoutMs: 600000,
    streamUsage: false, extraBody: { reasoning: { effort: 'low' }, min_discount_percent: 0 } });
  return { model: authority.model, call: async (prompt, signal) => {
    const reply = await provider.executeTurn({ prompt, signal });
    return { text: reply.content, amount: reply.supplierChargeUsd ?? null,
      usage: { inputTokens: reply.usage?.inputTokens ?? null, outputTokens: reply.usage?.outputTokens ?? null, cachedTokens: reply.cachedInputTokens ?? null } };
  } };
}
