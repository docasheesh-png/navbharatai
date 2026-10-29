import { DiagnosticEvidenceMissing } from './providerDiagnosticEvidence';
import { randomUUID } from 'node:crypto';
import { type DiagnosticResult, type DiagnosticReason, type DiagnosticProvider } from '../../shared/providerDiagnostics';
import type { DiagnosticInput } from './providerDiagnosticBoundary';
import { ProviderDiagnosticStore, DiagnosticAdmissionError } from './providerDiagnosticStore';
import { createSurplusChat, SurplusError, SURPLUS_DEFAULT_MODEL } from './surplusClient';
import type { DiagnosticStoredRun } from './providerDiagnosticDirectStore';
import { surplusBuyerCostToUsd } from '../AI/SurplusRegistry/receiptPolicy';
import { OpenAiCompatProvider, FreeChainProviderError } from '../AI/FreeChain/providers/openAiCompatProvider';
import { CHEAPERINFERENCE_BASE_URL, cheaperInferenceAdminStatus } from './cheaperInferencePolicy';

type Reply = { text: string; usage: DiagnosticResult['usage']; amount: string | null };
export interface DiagnosticAdapter { model: string; call(prompt: string, signal: AbortSignal): Promise<Reply> }
class DiagnosticSurplusFailure extends SurplusError {
  constructor(error: SurplusError, readonly httpStatus?: number) { super(error.code, error.usage); }
}
export function diagnosticAdapter(provider: DiagnosticProvider, env = process.env, _pair = false, outputTokens?: number): DiagnosticAdapter {
  if (provider === 'surplus') {
    let httpStatus: number | undefined;
    const chat = createSurplusChat(env, async (input, init) => { const response = await fetch(input, init); httpStatus = response.status; return response; }, { maxOutputTokens: 8192, providerDefaults: true });
    return { model: env.SURPLUS_MODEL?.trim() || SURPLUS_DEFAULT_MODEL, async call(prompt, signal) {
      const r = await chat(prompt, { signal, ...(outputTokens === undefined ? {} : { maxTokens: outputTokens }) }).catch(error => { if (error instanceof SurplusError) throw new DiagnosticSurplusFailure(error, httpStatus); throw error; });
      return { text: r.text, usage: { inputTokens: r.usage?.prompt_tokens ?? null, outputTokens: r.usage?.completion_tokens ?? null, cachedTokens: null }, amount: surplusBuyerCostToUsd(r.usage?.buyer_cost_micro) };
    } };
  }
  const status = cheaperInferenceAdminStatus(env);
  if (!status.apiKeyConfigured) throw new FreeChainProviderError('CONFIGURATION');
  const adapter = new OpenAiCompatProvider({ provider: 'CHEAPERINFERENCE', model: status.defaultModel,
    key: env.CHEAPERINFERENCE_API_KEY!.trim(), baseURL: CHEAPERINFERENCE_BASE_URL, priority: 0,
    maxOutputTokens: 2048, timeoutMs: 600000, providerDefaults: true, requestedOutputTokens: outputTokens,
    streamUsage: false, extraBody: { reasoning: { effort: 'low' } } });
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
    if (error.code === 'TIMEOUT') return 'timeout';
    if (error.code === 'ABORTED') return 'cancelled';
    if (error.code === 'EMPTY_RESPONSE') return 'malformed_response';
    if (error.code === 'CONFIGURATION') return 'config_missing';
  }
  return 'provider_error';
}
export interface DiagnosticDependencies {
  /** Injectable monotonic clock for deterministic timing tests; wall time is identity only. */
  monotonicNow?: () => number;
  status?: () => Promise<unknown>;
  setControl?: ProviderDiagnosticStore['setControl'];
  store: {
    read(key: string): Promise<DiagnosticStoredRun | null>;
    reserve(key: string, provider: DiagnosticProvider, model: string, outputTokens?: number): Promise<{ mayDispatch: boolean; run: DiagnosticStoredRun }>;
    claimDispatch(key: string, runId: string): Promise<boolean>;
    finish(key: string, runId: string, amount: number | null): Promise<DiagnosticStoredRun>;
  };
  adapter: (provider: DiagnosticProvider, outputTokens?: number) => DiagnosticAdapter;
  /** Checks only existing local platform controls; never requires provider catalog/pricing evidence. */
  verifyAdmission: (provider: DiagnosticProvider, model: string, outputTokens?: number) => Promise<void>;
}
export async function runDiagnostic(input: DiagnosticInput, deps: DiagnosticDependencies): Promise<DiagnosticResult & { replayed: boolean }> {
  const start = Date.now();
  const clock = deps.monotonicNow ?? (() => performance.now());
  const origin = clock();
  const elapsed = () => Math.max(0, Math.round((clock() - origin) * 100) / 100);
  let dispatchStartedMs: number | null = null;
  let responseCompletedMs: number | null = null;
  let accountingStartedMs: number | null = null;
  let responseStatus: number | null = null;
  let retryAfterMs: number | null = null;
  const result: DiagnosticResult & { replayed: boolean } = { runId: randomUUID(), provider: input.provider, model: null,
    startedAt: new Date(start).toISOString(), elapsedMs: 0, firstByteMs: null, firstTokenMs: null, outputTokensPerSecond: null,
    retryCount: 0, text: null, usage: { inputTokens: null, outputTokens: null, cachedTokens: null }, supplierCost: { status: 'unavailable' },
    walletCharge: { status: 'not_charged' }, accounting: 'not_dispatched', timeline: [], provesBuilderHealth: false, replayed: false };
  const event = (stage: DiagnosticResult['timeline'][number]['stage'], reason: DiagnosticReason, httpStatus?: number) => result.timeline.push({ stage, reason, elapsedMs: elapsed(), ...(httpStatus === undefined ? {} : { httpStatus }) });
  const complete = () => {
    const totalMs = elapsed();
    const admissionMs = dispatchStartedMs ?? accountingStartedMs ?? totalMs;
    const providerRoundTripMs = dispatchStartedMs === null || responseCompletedMs === null ? null : responseCompletedMs - dispatchStartedMs;
    const accountingMs = accountingStartedMs === null ? null : totalMs - accountingStartedMs;
    const stages = [
      ['admission', admissionMs], ['provider_round_trip', providerRoundTripMs ?? 0], ['accounting', accountingMs ?? 0],
    ] as const;
    const largest = stages.reduce((a, b) => b[1] > a[1] ? b : a);
    result.elapsedMs = totalMs;
    result.timing = { slow: totalMs > 10000, thresholdMs: 10000, admissionMs, dispatchStartedMs,
      responseCompletedMs, providerRoundTripMs, accountingMs, totalMs, queueMs: null, headersMs: null,
      parsingMs: null, retryAfterMs, httpStatus: responseStatus, fallbackCount: 0,
      largestMeasuredStage: totalMs > 10000 && largest[1] > 0 ? largest[0] : 'unknown' };
    return result;
  };
  const historical = (run: DiagnosticStoredRun) => ({ ...result, runId: run.runId, startedAt: new Date(run.startedAt).toISOString(), accounting: run.state, replayed: true, completedAt: run.completedAt,
    reconciliationRequired: run.actualCostNanoUsd !== null && typeof run.reservedNanoUsd === 'number' && run.actualCostNanoUsd > run.reservedNanoUsd,
    supplierCost: run.actualCostNanoUsd == null ? { status: 'unavailable' as const } : { status: 'reported' as const, amount: `${Math.floor(run.actualCostNanoUsd / 1e9)}.${String(run.actualCostNanoUsd % 1e9).padStart(9, '0')}`, currency: 'USD' } });
  let dispatchBefore: number | undefined;
  let adapter: DiagnosticAdapter;
  try { adapter = deps.adapter(input.provider, input.maxOutputTokens); result.model = adapter.model; }
  catch { event('configuration', 'config_missing'); return complete(); }
  try {
    // Replays remain readable even when evidence has since expired; never redispatch.
    const previous = await deps.store.read(input.idempotencyKey);
    if (previous) {
      if (previous.provider !== input.provider || previous.model !== adapter.model) throw new DiagnosticAdmissionError('invalid_request');
      return historical(previous);
    }
    await deps.verifyAdmission(input.provider, adapter.model, input.maxOutputTokens);
    const admission = await deps.store.reserve(input.idempotencyKey, input.provider, adapter.model, input.maxOutputTokens);
    dispatchBefore = admission.run.dispatchBefore;
    result.runId = admission.run.runId; result.startedAt = new Date(admission.run.startedAt).toISOString(); result.accounting = admission.run.state;
    if (!admission.mayDispatch) return historical(admission.run);
    if (admission.run.dispatchBefore !== undefined && Date.now() >= admission.run.dispatchBefore) {
      result.accounting = 'unknown_liability';
      event('reservation', 'budget_evidence_unavailable');
      accountingStartedMs = elapsed();
      try { await deps.store.finish(input.idempotencyKey, result.runId, null); } catch { event('accounting', 'accounting_failed'); }
      return complete();
    }
  } catch (error) {
    if (!(error instanceof DiagnosticAdmissionError) && !(error instanceof DiagnosticEvidenceMissing)) result.accounting = 'unknown_liability';
    if (error instanceof DiagnosticEvidenceMissing) result.missingEvidence = error.fields;
    event('reservation', error instanceof DiagnosticAdmissionError && error.reason === 'diagnostics_disabled' ? 'diagnostics_disabled' : error instanceof DiagnosticEvidenceMissing || error instanceof DiagnosticAdmissionError && error.reason === 'budget_evidence_unavailable' ? 'budget_evidence_unavailable' : 'reservation_failed');
    return complete();
  }
  try {
    if (!await deps.store.claimDispatch(input.idempotencyKey, result.runId)) {
      // Do not release an existing hold or invent a zero-cost supplier receipt.
      event('dispatch', 'diagnostics_disabled');
      return complete();
    }
    if (dispatchBefore !== undefined && Date.now() >= dispatchBefore) throw new DiagnosticAdmissionError('budget_evidence_unavailable');
  } catch (error) {
    result.accounting = 'unknown_liability'; event('dispatch', error instanceof DiagnosticAdmissionError && error.reason === 'budget_evidence_unavailable' ? 'budget_evidence_unavailable' : 'accounting_failed');
    return complete();
  }
  const controller = new AbortController();
  let amount: string | null = null;
  try {
    dispatchStartedMs = elapsed();
    const reply = await adapter.call(input.prompt, controller.signal);
    result.text = reply.text; result.usage = reply.usage; amount = reply.amount;
    event('response', reply.text.trim() ? 'completed' : 'malformed_response');
  } catch (error) {
    if (error instanceof SurplusError) { amount = surplusBuyerCostToUsd(error.usage?.buyer_cost_micro); result.usage = { inputTokens: error.usage?.prompt_tokens ?? null, outputTokens: error.usage?.completion_tokens ?? null, cachedTokens: null }; }
    if (error instanceof FreeChainProviderError) amount = error.supplierChargeUsd ?? null;
    responseStatus = (error instanceof DiagnosticSurplusFailure ? error.httpStatus : error instanceof FreeChainProviderError ? error.status : undefined) ?? null;
    retryAfterMs = error instanceof FreeChainProviderError ? error.retryAfterMs ?? null : null;
    event('response', failure(error), responseStatus ?? undefined);
  }
  responseCompletedMs = elapsed();
  let nano: number | null = null;
  if (amount !== null && /^\d+(?:\.\d{1,9})?$/.test(amount)) {
    const [whole, fraction = ''] = amount.split('.'); const exact = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
    if (exact <= BigInt(Number.MAX_SAFE_INTEGER)) nano = Number(exact);
    result.supplierCost = { status: 'reported', amount, currency: 'USD' };
  }
  accountingStartedMs = elapsed();
  try { const settled = await deps.store.finish(input.idempotencyKey, result.runId, nano); result.completedAt = settled?.completedAt; result.reconciliationRequired = !!settled && settled.actualCostNanoUsd !== null && typeof settled.reservedNanoUsd === 'number' && settled.actualCostNanoUsd > settled.reservedNanoUsd; result.accounting = nano === null ? 'unknown_liability' : 'settled'; event('accounting', nano === null ? 'receipt_unavailable' : 'completed'); }
  catch { result.accounting = 'unknown_liability'; event('accounting', 'accounting_failed'); }
  return complete();
}
