import { cheaperInferenceAdminStatus, CHEAPERINFERENCE_BASE_URL } from './cheaperInferencePolicy';
import { maximumCostNanoUsd, usdToNanoUsd } from '../AI/FreeChain/spendCap';
import { LoadBatchError } from './providerLoadBatch';

export interface LoadQuote { model: string; maximumNanoUsd: number; checkedAt: number; source: string }
/** Official protocol: /docs#price-ceiling, model.supply max_*_per_million.
 * No raw bodies/headers escape. This is batch admission only, never a manual-bot gate.
 * Beam's published 1M input context is rounded upward to 1,048,576. Output uses
 * the exact submitted native limit, including reasoning under the documented model
 * contract (developers.reflection.ai/reasoning). Marketplace parameter enforcement
 * remains a provider obligation, not a guaranteed monetary account cap. */
export async function readLoadQuote(outputTokens: number, env = process.env, transport: typeof fetch = fetch): Promise<LoadQuote> {
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 131072) throw new LoadBatchError('invalid');
  const status = cheaperInferenceAdminStatus(env);
  if (!status.apiKeyConfigured) throw new LoadBatchError('unavailable');
  if (!['beam', 'beam-1.0-501b-a23b'].includes(status.defaultModel)) throw new LoadBatchError('unavailable');
  const response = await transport(`${CHEAPERINFERENCE_BASE_URL}/models/supply?model=${encodeURIComponent(status.defaultModel)}&min_discount_percent=0`, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${env.CHEAPERINFERENCE_API_KEY!.trim()}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new LoadBatchError('unavailable');
  const data = await response.json();
  if (!data || data.object !== 'model.supply' || data.model !== status.defaultModel || data.min_discount_percent !== 0) throw new LoadBatchError('unavailable');
  let input: number, output: number;
  try { input = usdToNanoUsd(data.max_input_per_million); output = usdToNanoUsd(data.max_output_per_million); } catch { throw new LoadBatchError('unavailable'); }
  const maximumNanoUsd = maximumCostNanoUsd(1048576, outputTokens, input, output);
  if (!maximumNanoUsd) throw new LoadBatchError('unavailable');
  return { model: status.defaultModel, maximumNanoUsd, checkedAt: Date.now(), source: 'https://api.cheaperinference.com/docs#price-ceiling' };
}
