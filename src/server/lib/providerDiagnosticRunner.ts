import { DIAGNOSTIC_PAIR_DISCOUNT } from './providerDiagnosticPair';
import { DiagnosticEvidenceMissing } from './providerDiagnosticEvidence';
import { randomUUID } from 'node:crypto';
import { DIAGNOSTIC_LIMITS, type DiagnosticResult, type DiagnosticReason, type DiagnosticProvider } from '../../shared/providerDiagnostics';
import type { DiagnosticInput } from './providerDiagnosticBoundary';
import { ProviderDiagnosticStore, DiagnosticAdmissionError, type DiagnosticRunRecord } from './providerDiagnosticStore';
import { createSurplusChat, SurplusError, SURPLUS_DEFAULT_MODEL, SURPLUS_MIN90_BASE_URL } from './surplusClient';
import { surplusBuyerCostToUsd } from '../AI/SurplusRegistry/receiptPolicy';
import { OpenAiCompatProvider, FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
import { CHEAPERINFERENCE_BASE_URL, cheaperInferenceAdminStatus } from './cheaperInferencePolicy';

type Reply = { text: string; usage: DiagnosticResult['usage']; amount: string | null };
export interface DiagnosticAdapter { model: string; call(prompt: string, signal: AbortSignal): Promise<Reply> }
class DiagnosticSurplusFailure extends SurplusError {
  constructor(error: SurplusError, readonly httpStatus?: number) { super(error.code, error.usage); }
}
export function diagnosticAdapter(provider: DiagnosticProvider, env = process.env, pair = false): DiagnosticAdapter {
  if (provider === 'surplus') {
    let httpStatus: number | undefined;
    const chat = createSurplusChat(pair ? { ...env, SURPLUS_BASE_URL: SURPLUS_MIN90_BASE_URL } : env, async (input, init) => { const response = await fetch(input, init); httpStatus = response.status; return response; });
    return { model: env.SURPLUS_MODEL?.trim() || SURPLUS_DEFAULT_MODEL, async call(prompt, signal) {
      const r = await chat(prompt, { signal, maxTokens: DIAGNOSTIC_LIMITS.outputTokens }).catch(error => { if (error instanceof SurplusError) throw new DiagnosticSurplusFailure(error, httpStatus); throw error; });
      return { text: r.text, usage: { inputTokens: r.usage?.prompt_tokens ?? null, outputTokens: r.usage?.completion_tokens ?? null, cachedTokens: null }, amount: surplusBuyerCostToUsd(r.usage?.buyer_cost_micro) };
    } };
  }
  const status = cheaperInferenceAdminStatus(env);
  if (!status.apiKeyConfigured) throw new FreeChainProviderError('CONFIGURATION');
  const adapter = new OpenAiCompatProvider({ provider: 'CHEAPERINFERENCE', model: status.defaultModel,
    key: env.CHEAPERINFERENCE_API_KEY!.trim(), baseURL: CHEAPERINFERENCE_BASE_URL, priority: 0,
    maxOutputTokens: DIAGNOSTIC_LIMITS.outputTokens, timeoutMs: DIAGNOSTIC_LIMITS.deadlineMs,
    streamUsage: false, extraBody: pair ? { reasoning: { effort: 'low' }, min_discount_percent: DIAGNOSTIC_PAIR_DISCOUNT } : { reasoning_effort: 'low' } });
  return { model: status.defaultModel, async call(prompt, signal) {
    const r = await adapter.executeTurn({ prompt, signal });
    return { text: r.content, usage: { inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null, cachedTokens: r.cachedInputTokens ?? null }, amount: r.supplierChargeUsd ?? null };
  } };
}
function failure(error: unknown): DiagnosticReason {
  if (error instanceof SurplusError) return ({ configuration: 'config_missing', authentication: 'authentication_rejected', rate_limit: 'rate_limited', timeout: 'timeout', connection: 'network_error', empty_response: 'malformed_response', provider: 'provider_error', invalid_request: 'provider_error' } as const)[error.code];
  if (error instanceof FreeChainProviderError) {
    if (error.code === 'AUTH') return 'authentication_rejected';
    if (error.code === 'RATE_LIMIT') return 'rate_limited';
    if (error.code === 'NETWORK') return 'network_error';
    if (error.code === 'TIMEOUT' || error.code === 'ABORTED') return 'timeout';
    if (error.code === 'EMPTY_RESPONSE') return 'malformed_response';
    if (error.code === 'CONFIGURATION') return 'config_missing';
  }
  return 'provider_error';
}
export interface DiagnosticDependencies {
  status?: () => Promise<unknown>;
  fixedPrompt?: string;
  store: Pick<ProviderDiagnosticStore, 'reserve' | 'finish' | 'read'>;
  adapter: (provider: DiagnosticProvider) => DiagnosticAdapter;
  /** Must verify real reconciliation/tariff evidence and current monthly limit before admission. */
  verifyEvidence: (provider: DiagnosticProvider, model: string) => Promise<void>;
}
export async function runDiagnostic(input: DiagnosticInput, deps: DiagnosticDependencies): Promise<DiagnosticResult & { replayed: boolean }> {
  const start = Date.now();
  const result: DiagnosticResult & { replayed: boolean } = { runId: randomUUID(), provider: input.provider, model: null,
    startedAt: new Date(start).toISOString(), elapsedMs: 0, firstByteMs: null, firstTokenMs: null, outputTokensPerSecond: null,
    retryCount: 0, text: null, usage: { inputTokens: null, outputTokens: null, cachedTokens: null }, supplierCost: { status: 'unavailable' },
    walletCharge: { status: 'not_charged' }, accounting: 'not_dispatched', timeline: [], provesBuilderHealth: false, replayed: false };
  const event = (stage: DiagnosticResult['timeline'][number]['stage'], reason: DiagnosticReason, httpStatus?: number) => result.timeline.push({ stage, reason, elapsedMs: Date.now() - start, ...(httpStatus === undefined ? {} : { httpStatus }) });
  const historical = (run: DiagnosticRunRecord) => ({ ...result, runId: run.runId, startedAt: new Date(run.startedAt).toISOString(), accounting: run.state, replayed: true,
    reconciliationRequired: run.actualCostNanoUsd !== null && run.actualCostNanoUsd > run.reservedNanoUsd,
    supplierCost: run.actualCostNanoUsd == null ? { status: 'unavailable' as const } : { status: 'reported' as const, amount: `${Math.floor(run.actualCostNanoUsd / 1e9)}.${String(run.actualCostNanoUsd % 1e9).padStart(9, '0')}`, currency: 'USD' } });
  let adapter: DiagnosticAdapter;
  try { adapter = deps.adapter(input.provider); result.model = adapter.model; }
  catch { event('configuration', 'config_missing'); return result; }
  try {
    // Replays remain readable even when evidence has since expired; never redispatch.
    const previous = await deps.store.read(input.idempotencyKey);
    if (previous) {
      if (previous.provider !== input.provider || previous.model !== adapter.model) throw new DiagnosticAdmissionError('invalid_request');
      return historical(previous);
    }
    await deps.verifyEvidence(input.provider, adapter.model);
    const admission = await deps.store.reserve(input.idempotencyKey, input.provider, adapter.model);
    result.runId = admission.run.runId; result.startedAt = new Date(admission.run.startedAt).toISOString(); result.accounting = admission.run.state;
    if (!admission.mayDispatch) return historical(admission.run);
    if (admission.run.dispatchBefore !== undefined && Date.now() >= admission.run.dispatchBefore) {
      result.accounting = 'unknown_liability';
      event('reservation', 'budget_evidence_unavailable');
      try { await deps.store.finish(input.idempotencyKey, result.runId, null); } catch { event('accounting', 'accounting_failed'); }
      return result;
    }
  } catch (error) {
    if (!(error instanceof DiagnosticAdmissionError) && !(error instanceof DiagnosticEvidenceMissing)) result.accounting = 'unknown_liability';
    if (error instanceof DiagnosticEvidenceMissing) result.missingEvidence = error.fields;
    event('reservation', error instanceof DiagnosticEvidenceMissing || error instanceof DiagnosticAdmissionError && error.reason === 'budget_evidence_unavailable' ? 'budget_evidence_unavailable' : 'reservation_failed');
    result.elapsedMs = Date.now() - start; return result;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let amount: string | null = null;
  try {
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new FreeChainProviderError('TIMEOUT')); }, DIAGNOSTIC_LIMITS.deadlineMs); });
    const reply = await Promise.race([adapter.call(deps.fixedPrompt ?? input.prompt, controller.signal), deadline]);
    result.text = reply.text; result.usage = reply.usage; amount = reply.amount;
    event('response', reply.text.trim() ? 'completed' : 'malformed_response');
  } catch (error) {
    if (error instanceof SurplusError) { amount = surplusBuyerCostToUsd(error.usage?.buyer_cost_micro); result.usage = { inputTokens: error.usage?.prompt_tokens ?? null, outputTokens: error.usage?.completion_tokens ?? null, cachedTokens: null }; }
    if (error instanceof FreeChainProviderError) amount = error.supplierChargeUsd ?? null;
    event('response', failure(error), error instanceof DiagnosticSurplusFailure ? error.httpStatus : error instanceof FreeChainProviderError ? error.status : undefined);
  } finally { clearTimeout(timer); }
  let nano: number | null = null;
  if (amount !== null && /^\d+(?:\.\d{1,9})?$/.test(amount)) {
    const [whole, fraction = ''] = amount.split('.'); const exact = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
    if (exact <= BigInt(Number.MAX_SAFE_INTEGER)) nano = Number(exact);
    result.supplierCost = { status: 'reported', amount, currency: 'USD' };
  }
  try { const settled = await deps.store.finish(input.idempotencyKey, result.runId, nano); result.reconciliationRequired = !!settled && settled.actualCostNanoUsd !== null && settled.actualCostNanoUsd > settled.reservedNanoUsd; result.accounting = nano === null ? 'unknown_liability' : 'settled'; event('accounting', nano === null ? 'receipt_unavailable' : 'completed'); }
  catch { result.accounting = 'unknown_liability'; event('accounting', 'accounting_failed'); }
  result.elapsedMs = Date.now() - start;
  return result;
}
