import { publishDeploymentPaidLimit } from './deploymentBudget';
import { persistFreeChainSample } from './eventSample';
export { shouldPersistFreeChainEvent } from './eventSample';
import { sanitizeText } from '../../../lib/observability/sanitize';
import { isEntryAdmission } from './entryAdmission';
import { freeChainAdmissionQueue } from './admissionQueue';
import { randomUUID } from 'node:crypto';
import { freeChainConfig, isPaidRung, type FreeChainConfig, type ProviderId, type RungConfig } from './config';
import { selectedForFreeChain, rolloutBucket, type FreeChainContext } from './rollout';
import { readControls, readControlsForSelection, writeControls, controlRef } from './control';
import { FreeChainStore } from './store';
import { FreeChainCache, safeCacheKey } from './cache';
import { maximumCostNanoUsd, usdToNanoUsd, type PaidReservation } from './spendCap';
import { trimForRung } from './trim';
import { logFreeChain, type FreeChainTelemetry } from './telemetry';
import { OpenAiCompatProvider, FreeChainProviderError } from './providers/openAiCompatProvider';
import { FreeRoutingError } from '../LiveRegistry/dispatcher';
import { runRegistryRung } from './providers/openRouterRegistryRung';
import { getServerDb, type Firestore } from '../../lib/serverDb';
import { assertAiAvailable } from '../../lib/aiMaintenance';
import { detectReplyLanguage } from '../../lib/freeChatReplies';
import { strictFreeRequired } from '../inferencePolicy';
import { CHAT_INPUT_WEIGHT } from '../freeTierCostCeiling';
import { realRateFor } from '../../AgentV3/providerRates';
import { getBreaker } from '../Router/CircuitBreaker';
import { acquireSlot, releaseSlot, recordProviderLatency } from '../Router/AIRouter';
import { runWatchedStream, watchdogLimits } from '../Router/streamWatchdog';
import type { RoutedCall } from '../UniversalAIRouter';
import type { AIProviderResponse } from '../Router/ProviderTypes';
import { readFreeChainBudgetAction, type FreeChainBudgetAction, type FreeChainBudgetResponse, FREE_CHAIN_METRICS_SCAN_LIMIT, FREE_CHAIN_PROVIDER_IDS, type FreeChainAdminMetrics, type FreeChainAdminView, type FreeChainControlAction } from '../../../lib/freeChatChainView';
export interface FreeChainInput { message: string; history: unknown[]; systemPrompt?: string; signal?: AbortSignal; onChunk?: (text: string, source?: 'notice') => void; context: FreeChainContext }
export type FreeChainResult = RoutedCall & { reason?: 'aborted' | 'no-provider' | 'all-failed' | 'stalled'; freeChain?: FreeChainTelemetry };
const BUSY = 'The AI service is temporarily busy. Please try again in 1-2 minutes. 🙏';
/** The one friendly final line after silent fallback is exhausted, in the user's own language. */
export function busyMessage(message?: string): string {
  const lang = message ? detectReplyLanguage(message) : 'en';
  if (lang === 'hi') return 'अभी AI थोड़ा व्यस्त है, कृपया 1-2 मिनट बाद फिर कोशिश करें। 🙏';
  if (lang === 'hinglish') return 'Abhi AI thoda busy hai, thodi der (1-2 minute) baad try karein. 🙏';
  return BUSY;
}
const names: Record<ProviderId, AIProviderResponse['provider']> = { glm47: 'GLM', glm45: 'GLM', gemini: 'GEMINI', groq: 'GROQ', cloudflare: 'CLOUDFLARE', openrouter: 'OPENROUTER', deepseek: 'DEEPSEEK',
  nvidia: 'NVIDIA', modelscope: 'MODELSCOPE', llm7: 'LLM7', bluesminds: 'BLUESMINDS', requesty: 'REQUESTY', glmflashx: 'GLM', nemotron: 'DEEPINFRA', gpt5nano: 'OPENAI' };
function empty(reason: FreeChainResult['reason'] = 'all-failed', message?: string): FreeChainResult { return { content: busyMessage(message), provider: 'NONE', model: 'none', latencyMs: 0, ok: false, reason }; }
/** Does a non-DeepSeek paid rung's reservation profile stay under the unchanged kimi-k2.7 free ceiling? */
function verifiedPaidReservationRate(rung: RungConfig): boolean {
  if (!(rung.priceIn > 0) || !(rung.priceOut > 0)) return false;
  try {
    const ceiling = realRateFor('KIMI', 'kimi-k2.7');
    return maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, usdToNanoUsd(rung.priceIn), usdToNanoUsd(rung.priceOut))
      <= maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, usdToNanoUsd(ceiling.inputPerMTok), usdToNanoUsd(ceiling.outputPerMTok));
  } catch { return false; }
}
/**
 * Owner spec "user_id grouping": with one key per provider, continuity means a user keeps landing on
 * the same equal-cost free rung. Only the leading run of zero-cost Tier-1 rungs is rotated, so a paid
 * rung can never move up and the cheapest-first invariant holds.
 */
export function orderForUser(cfg: FreeChainConfig, uid: string): ProviderId[] {
  if (!cfg.stickySpread) return cfg.order;
  const lead: ProviderId[] = [];
  for (const id of cfg.order) { if (isPaidRung(id) || id === 'openrouter') break; lead.push(id); }
  if (lead.length < 2) return cfg.order;
  const k = rolloutBucket(uid) % lead.length;
  return [...lead.slice(k), ...lead.slice(0, k), ...cfg.order.slice(lead.length)];
}
const warned = new Set<string>();
function warnOnce(code: string) { if (!warned.has(code)) { warned.add(code); console.warn('[FREE_CHAT_CHAIN]', code); } }
function verifiedDeepseekReservationRate(rung: RungConfig, cfg: FreeChainConfig): boolean {
  if (rung.model !== 'deepseek-flash') return false;
  try {
    const rate = realRateFor('DEEPSEEK', rung.model);
    const input = usdToNanoUsd(cfg.deepseekPrices.input);
    const output = usdToNanoUsd(cfg.deepseekPrices.output);
    // Never reserve below the verified peak tariff, even when a caller supplies a config directly.
    if (input < usdToNanoUsd(rate.inputPerMTok) || output < usdToNanoUsd(rate.outputPerMTok)) return false;
    // Compare the ACTUAL reservation profile, not only the published default. Both sides use the
    // existing Kimi ceiling and chat weight, evaluated as integer nano-USD rather than float money.
    const ceiling = realRateFor('KIMI', 'kimi-k2.7');
    return maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000, input, output)
      <= maximumCostNanoUsd(CHAT_INPUT_WEIGHT * 1_000_000, 1_000_000,
        usdToNanoUsd(ceiling.inputPerMTok), usdToNanoUsd(ceiling.outputPerMTok));
  } catch { return false; }
}
function rungReason(rung: RungConfig, cfg: FreeChainConfig, input?: FreeChainInput): string | undefined {
  if (rung.reason) return rung.reason;
  if (['glm47', 'glm45', 'gemini', 'groq', 'cloudflare'].includes(rung.id) && rung.verifiedUntil <= Date.now()) return 'free-plan-review-required';
  if (rung.id === 'deepseek' && !verifiedDeepseekReservationRate(rung, cfg)) return 'rate-card-unverified';
  if (isPaidRung(rung.id) && rung.id !== 'deepseek' && !verifiedPaidReservationRate(rung)) return 'rate-card-unverified';
  if (rung.id === 'openrouter' && !cfg.openRouterModels.length) return 'quality-allowlist-required';
  if (input && rung.id === 'gemini' && (!input.context.cacheEligible || !safeCacheKey({ message: input.message, history: input.history, eligible: true, language: 'public', systemPrompt: '', modelFamily: '' }))) return 'privacy-public-corpus-only';
  if (input && !rung.languages.includes(detectReplyLanguage(input.message))) return 'language';
  if (input && (rung.id === 'gemini' || isPaidRung(rung.id)) && (input.context.privateTurn || input.context.healthTurn)) return 'privacy';
  return undefined;
}
function accountId(id: ProviderId): string { return id === 'glm47' || id === 'glm45' ? 'glm' : id; }
function quotaInput(rung: RungConfig, cfg: FreeChainConfig, inputTokens: number) {
  return { provider: accountId(rung.id), model: rung.id === 'openrouter' || accountId(rung.id) === 'glm' ? 'account-free-models' : rung.model, inputTokens, outputTokens: rung.maxOutputTokens, timeZone: rung.timeZone,
    ...(rung.id === 'openrouter' || accountId(rung.id) === 'glm' ? { quotaScope: 'account' } : {}), safetyMargin: cfg.safetyMargin,
    limits: { rpm: rung.rpm, rpd: rung.rpd, tpm: rung.tpm, tpd: rung.tpd,
      ...(rung.id === 'cloudflare' ? { neuronsPerDay: 10000, neuronsPerRequest: Math.ceil((24000 * 26668 + rung.maxOutputTokens * 204805) / 1000000) } : {}) } };
}
function quote(cfg: FreeChainConfig, input: number, output: number, rung?: RungConfig): number {
  if (rung && rung.id !== 'deepseek') return maximumCostNanoUsd(input, output, usdToNanoUsd(rung.priceIn), usdToNanoUsd(rung.priceOut));
  return maximumCostNanoUsd(input, output, usdToNanoUsd(cfg.deepseekPrices.input), usdToNanoUsd(cfg.deepseekPrices.output));
}
/** This namespace is not installed in AIRouterManager: other consumers of 'free' stay untouched. */
export function buildFreeChainRouter(db: Firestore, cfg: FreeChainConfig = freeChainConfig(), refreshConfig?: () => FreeChainConfig) {
  const store = new FreeChainStore(db);
  async function routeAdmitted(input: FreeChainInput, queueWaitMs: number): Promise<FreeChainResult> {
    await assertAiAvailable();
    const started = Date.now() - queueWaitMs; const requestId = randomUUID();
    const trace: FreeChainTelemetry = { requestId, queueWaitMs, rung: null, provider: 'NONE', model: 'none', attempts: [], fallbacks: 0, cacheHit: false, costUsdEstimate: null, ttftMs: null, latencyMs: 0, rolloutBucket: rolloutBucket(input.context.uid) };
    const done = async (result: FreeChainResult): Promise<FreeChainResult> => {
      trace.latencyMs = Date.now() - started; trace.provider = result.provider; trace.model = result.model;
      trace.fallbacks = Math.max(0, trace.attempts.filter(a => a.entered).length - 1);
      logFreeChain(trace);
      await persistFreeChainSample(db, trace, result.ok);
      return { ...result, latencyMs: trace.latencyMs, freeChain: trace };
    };
    try { await publishDeploymentPaidLimit(db, cfg.paidCapNanoUsd, () => store.observePaidBudgetPolicy(cfg.paidCapNanoUsd)); }
    catch { return done(empty('all-failed', input.message)); }
    const language = detectReplyLanguage(input.message);
    const languageInstruction = { hi: 'Reply in Hindi using Devanagari script.', hinglish: 'Reply in Hinglish using Roman script.', en: 'Reply in English.', other: 'Reply in the same language and script as the user.' }[language];
    const system = `${input.systemPrompt ?? ''}\n\n${languageInstruction}`;
    const cacheKey = cfg.cacheEnabled ? safeCacheKey({ message: input.message, history: input.history, eligible: input.context.cacheEligible, language, systemPrompt: system, modelFamily: JSON.stringify(cfg.rungs.map(r => [r.id, r.model])) }) : null;
    if (cacheKey) {
      const hit = await new FreeChainCache(db).get(cacheKey).catch(() => null);
      const cacheControls = hit ? await readControls(db, cfg).catch(() => null) : null;
      const hitRung = hit ? cfg.rungs.find(r => names[r.id] === hit.provider && r.model === hit.model && cfg.order.includes(r.id)) : undefined;
      if (hit && hit.provider !== 'OPENROUTER' && cacheControls?.enabled && hitRung && !cacheControls.disabledProviders.includes(hitRung.id) && !rungReason(hitRung, cfg, input) && !input.signal?.aborted) { trace.cacheHit = true; trace.costUsdEstimate = 0; input.onChunk?.(hit.content); return done({ ...hit, latencyMs: 0, ok: true }); }
    }
    for (const id of orderForUser(cfg, input.context.uid)) {
      if (input.signal?.aborted) return done({ ...empty('aborted'), content: '' });
      const rung = cfg.rungs.find(r => r.id === id)!;
      const attempt = { provider: id, model: rung.model, reason: 'pending', entered: false }; trace.attempts.push(attempt);
      // Bounded latency: at most cfg.maxAttempts PHYSICAL calls per turn; skipped rungs are free.
      if (trace.attempts.filter(a => a.entered).length >= cfg.maxAttempts) { attempt.reason = 'max-attempts'; break; }
      const reason = rungReason(rung, cfg, input); if (reason) { attempt.reason = reason; continue; }
      const prepared = trimForRung(input.message, input.history, system, rung.maxInputTokens);
      if (!prepared) { attempt.reason = 'context-capacity'; continue; }
      const attemptStarted = Date.now();
      const breakerName = `free-chat-chain:${id}`; const capacityName = `free-chat-chain:${accountId(id)}`; const breaker = getBreaker(breakerName);
      if (breaker.isBlocking()) { attempt.reason = 'circuit'; continue; }
      if (!acquireSlot(capacityName)) { attempt.reason = 'capacity'; continue; }
      let reservation: PaidReservation | null = null;
      const controller = new AbortController(); const abort = () => controller.abort(); input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) abort();
      let content = ''; let response: AIProviderResponse | undefined; let completeUsage = false; let partial = false;
      try {
      // A new runtime OFF stops new physical attempts; never silently returns to paid legacy mid-turn.
      const control = await readControls(db, cfg).catch(() => null);
      if (!control || control.enabled === false) { attempt.reason = 'disabled'; break; }
      if (control.disabledProviders.includes(id)) { attempt.reason = 'disabled'; continue; }
        const admission = await store.reserveQuota(quotaInput(rung, cfg, prepared.inputTokens));
        if (!admission.allowed) { attempt.reason = admission.reason; if (typeof admission.resetAt === 'number' && admission.resetAt > Date.now()) breaker.honorRemoteOpenUntil(admission.resetAt); continue; }
        if (isPaidRung(id)) {
          // The complete model context is reserved, not an unverified character/token approximation.
          // One requestId may hold at most one paid reservation, so a second paid rung in the same
          // turn gets a derived id rather than being rejected as a duplicate.
          reservation = await store.reservePaid({ requestId: id === 'deepseek' ? requestId : `${requestId}:${id}`, uid: input.context.uid, maxCostNanoUsd: quote(cfg, 1048576, rung.maxOutputTokens, rung), capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
          if (!reservation?.mayDispatch) { attempt.reason = 'budget'; continue; }
        }
        if (controller.signal.aborted) { attempt.reason = 'aborted'; break; }
        const execute = async (chunk: (value: string) => void) => {
          attempt.entered = true;
          if (id === 'openrouter') {
            const stickyRef = controlRef(db).collection('sticky').doc(input.context.conversationKey);
            const sticky = (await stickyRef.get()).data();
            response = await runRegistryRung({ ...prepared, maxOutputTokens: rung.maxOutputTokens, signal: controller.signal, onChunk: chunk }, cfg.openRouterModels, sticky && typeof sticky.expiresAt === 'number' && sticky.expiresAt > Date.now() && typeof sticky.model === 'string' ? sticky.model : undefined);
            completeUsage = !!response.usage;
            await stickyRef.set({ model: response.model, expiresAt: Date.now() + 86400000, expireAt: new Date(Date.now() + 86400000) });
          } else {
            const provider = new OpenAiCompatProvider({ provider: names[id] as ConstructorParameters<typeof OpenAiCompatProvider>[0]['provider'], key: rung.key, envName: rung.keyEnv, model: rung.model, baseURL: rung.baseURL, priority: cfg.order.indexOf(id), maxOutputTokens: rung.maxOutputTokens, timeoutMs: 90000, streamUsage: rung.streamUsage,
              ...(id === 'gemini' ? { extraBody: { reasoning_effort: 'none' } } : id === 'gpt5nano' ? { extraBody: { reasoning_effort: 'minimal' } } : {}) });
            const result = await provider.executeTurn({ ...prepared, signal: controller.signal, onChunk: chunk }); response = result; completeUsage = result.completeUsage;
            const remaining = Number(result.rateLimitHeaders['x-ratelimit-remaining-requests']);
            if (id === 'groq' && remaining === 0) await store.cooldown(accountId(id), Date.now() + durationMs(result.rateLimitHeaders['x-ratelimit-reset-requests'], 86400000));
          }
        };
        const watch = await runWatchedStream(execute, chunk => { if (!chunk) return; if (trace.ttftMs === null) trace.ttftMs = Date.now() - started; content += chunk; input.onChunk?.(chunk); },
          { ...(watchdogLimits(undefined, 'free') ?? { firstTokenMs: cfg.ttftMs, idleMs: 30000, hardCapMs: 120000 }), firstTokenMs: cfg.ttftMs });
        if (watch.verdict !== 'completed') { controller.abort(); partial = watch.delivered; if (watch.error) throw watch.error; throw new FreeChainProviderError(watch.verdict === 'first-token-timeout' ? 'TIMEOUT' : 'NETWORK'); }
        if (!response || !content.trim()) throw new FreeChainProviderError('EMPTY_RESPONSE');
        if (reservation && completeUsage && response.usage) await store.settlePaid(reservation, quote(cfg, response.usage.inputTokens, response.usage.outputTokens, rung));
        breaker.recordSuccess(); recordProviderLatency(breakerName, Date.now() - attemptStarted, false);
        attempt.reason = 'served'; trace.rung = id; trace.costUsdEstimate = isPaidRung(id) ? (completeUsage && response.usage ? quote(cfg, response.usage.inputTokens, response.usage.outputTokens, rung) / 1e9 : null) : 0;
        if (cacheKey && id !== 'openrouter') await new FreeChainCache(db).put(cacheKey, { content, provider: response.provider, model: response.model }, cfg.cacheTtlS).catch(() => {});
        return done({ ...response, content, ok: true });
      } catch (error) {
        controller.abort(); const safe = error instanceof FreeChainProviderError ? error : error instanceof FreeRoutingError ? new FreeChainProviderError(error.code === 'SAFETY_REFUSAL' ? 'SAFETY_REFUSAL' : error.code === 'REQUEST_ABORTED' ? 'ABORTED' : /^(INVALID_|UNVERIFIED_|TOOL_ENVELOPE_|HTTP_400$|HTTP_413$|HTTP_422$)/.test(error.code) ? 'INVALID_REQUEST' : error.code === 'FREE_BILLING_ANOMALY' ? 'POLICY_BLOCKED' : 'SERVER') : null;
        attempt.reason = safe?.code.toLowerCase() ?? 'unavailable';
        if (safe?.code === 'AUTH') warnOnce(`${rung.keyEnv}: authentication failed`);
        if (!['INVALID_REQUEST', 'SAFETY_REFUSAL', 'ABORTED'].includes(safe?.code ?? '')) {
          const requestedCooldown = safe?.code === 'AUTH' ? 3600000 : safe?.retryAfterMs ?? (safe?.code === 'QUOTA_EXHAUSTED' ? 86400000 : 10000);
          const until = Math.max(Date.now() + requestedCooldown, breaker.recordFailure(requestedCooldown));
          breaker.honorRemoteOpenUntil(until);
          if (accountId(id) !== 'glm' || ['AUTH', 'RATE_LIMIT', 'QUOTA_EXHAUSTED'].includes(safe?.code ?? '')) await store.cooldown(accountId(id), until).catch(() => {}); recordProviderLatency(breakerName, 0, true);
        }
        // Never release an uncertain paid hold, and never mix replies after text commitment.
        if (partial || content) { trace.rung = id; if (!input.onChunk) content += '\n\nThe response was interrupted. Please try again.'; return done({ content, provider: names[id], model: response?.model ?? rung.model, latencyMs: 0, ok: true, reason: 'stalled' }); }
        if (safe?.code === 'SAFETY_REFUSAL' || safe?.code === 'INVALID_REQUEST' || safe?.code === 'POLICY_BLOCKED' || safe?.code === 'ABORTED' || input.signal?.aborted) break;
      } finally { controller.abort(); input.signal?.removeEventListener('abort', abort); releaseSlot(capacityName); }
    }
    const result = empty('all-failed', input.message); input.onChunk?.(result.content, 'notice'); return done(result);
  }
  return { async route(input: FreeChainInput): Promise<FreeChainResult> {
    const entry = input.context.entryAdmission;
    if (isEntryAdmission(entry, input.context.uid)) input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, entry.signal]) : entry.signal };
    if (input.signal?.aborted) return { ...empty('aborted'), content: '' };
    const admission = isEntryAdmission(entry, input.context.uid)
      ? { admitted: true as const, waitedMs: entry!.waitedMs, release: () => {} }
      : await freeChainAdmissionQueue.acquire({ uid: input.context.uid, signal: input.signal, ...cfg.queue });
    if (!admission.admitted) {
      const result = { ...empty(admission.reason === 'aborted' ? 'aborted' : 'no-provider'), ...(admission.reason === 'aborted' ? { content: '' } : {}) };
      const trace: FreeChainTelemetry = { requestId: randomUUID(), queueWaitMs: admission.waitedMs, admissionReason: admission.reason, rung: null, provider: 'NONE', model: 'none', attempts: [], fallbacks: 0, cacheHit: false, costUsdEstimate: null, ttftMs: null, latencyMs: admission.waitedMs, rolloutBucket: rolloutBucket(input.context.uid) };
      logFreeChain(trace);
      await persistFreeChainSample(db, trace, false);
      if (result.content) input.onChunk?.(result.content, 'notice');
      return { ...result, freeChain: trace };
    }
    try {
      const current = refreshConfig?.() ?? cfg;
      if (!current.enabled || current.errors.length || strictFreeRequired()) {
        const result = empty(); input.onChunk?.(result.content, 'notice'); return result;
      }
      return await routeAdmitted(input, admission.waitedMs);
    } finally { admission.release(); }
  } };
}

/** Groq duration headers are not HTTP dates; invalid/missing values conservatively retain the full window. */
export function durationMs(value: string | undefined, fallback: number): number {
  if (!value || !/^(?:\d+(?:\.\d+)?(?:ms|s|m|h|d))+$/.test(value)) return fallback;
  let total = 0; for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) total += Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]] ?? 0);
  return Math.max(1000, Math.min(total, 7 * 86400000));
}
export async function maybeFreeChain(input: FreeChainInput): Promise<FreeChainResult | null> {
  const cfg = freeChainConfig();
  const entry = input.context.entryAdmission;
  const held = isEntryAdmission(entry, input.context.uid);
  if (held && entry.signal.aborted) return { ...empty('aborted'), content: '' };
  // The existing strict router remains authoritative, including a policy change during assembly.
  if (strictFreeRequired()) return null;
  const unavailable = () => { const result = empty(); input.onChunk?.(result.content, 'notice'); return result; };
  if (cfg.errors.length && (cfg.enabled || held)) { warnOnce(`Invalid configuration: ${cfg.errors.join(', ')}`); return unavailable(); }
  // OFF restores legacy for new requests, never for a turn already admitted to this chain.
  if (!cfg.enabled) return held ? unavailable() : null;
  const db = getServerDb(); if (!db) return unavailable();
  const control = await readControlsForSelection(db, cfg).catch(() => null); if (!control) return unavailable();
  if (!selectedForFreeChain(cfg, control, input.context.uid)) return held ? unavailable() : null;
  return buildFreeChainRouter(db, cfg, freeChainConfig).route(input);
}
export async function controlFreeChain(action: FreeChainControlAction, actor: string): Promise<void> {
  const db = getServerDb(); if (!db) throw new Error('FREE_CHAIN_STORE_UNAVAILABLE');
  await writeControls(db, freeChainConfig(), action, actor);
}
/** Explicit audited admin CAS only; observation/status never changes this authority. */
export async function controlFreeChainBudget(value: FreeChainBudgetAction, actor: string): Promise<FreeChainBudgetResponse> {
  const action = readFreeChainBudgetAction(value);
  const cfg = freeChainConfig();
  if (!action || Math.round(action.capUsd * 100) * 10_000_000 > cfg.paidCapNanoUsd) throw new Error('FREE_CHAIN_BUDGET_INVALID_INPUT');
  if (cfg.errors.includes('FREE_CHAIN_PAID_DAILY_CAP_USD')) throw new Error('FREE_CHAIN_BUDGET_UNAVAILABLE');
  const db = getServerDb(); if (!db) throw new Error('FREE_CHAIN_STORE_UNAVAILABLE');
  const result = await new FreeChainStore(db).setPaidBudgetPolicy({ capNanoUsd: Math.round(action.capUsd * 100) * 10_000_000,
    expectedRevision: action.expectedRevision, actorUid: actor, reason: sanitizeText(action.reason, 500).slice(0, 500) });
  if (!result.ok) throw new Error(result.reason === 'conflict' ? 'FREE_CHAIN_BUDGET_CONFLICT' : result.reason === 'invalid_input' ? 'FREE_CHAIN_BUDGET_INVALID_INPUT' : 'FREE_CHAIN_BUDGET_UNAVAILABLE');
  return { ok: true, capUsd: result.policy.capNanoUsd / 1e9, policyRevision: result.policy.revision };
}
export async function freeChainAdminView(): Promise<FreeChainAdminView> {
  const cfg = freeChainConfig(); const db = getServerDb(); if (!db) throw new Error('FREE_CHAIN_STORE_UNAVAILABLE');
  const control = await readControls(db, cfg); const store = new FreeChainStore(db);
  const spend = await store.spendSnapshot(Date.now());
  // Request-local reuse only: both Flash models share one account/reset scope.
  const quotas = new Map<string, ReturnType<FreeChainStore['quotaSnapshot']>>();
  const providers = await Promise.all(cfg.rungs.map(async rung => {
    const scope: Parameters<FreeChainStore['quotaSnapshot']>[0] = { provider: accountId(rung.id), model: rung.id === 'openrouter' || accountId(rung.id) === 'glm' ? 'account-free-models' : rung.model, timeZone: rung.timeZone, ...(rung.id === 'openrouter' || accountId(rung.id) === 'glm' ? { quotaScope: 'account' } : {}) };
    const scopeKey = JSON.stringify(scope);
    let snapshot = quotas.get(scopeKey);
    if (!snapshot) { snapshot = store.quotaSnapshot(scope); quotas.set(scopeKey, snapshot); }
    const usage = await snapshot;
    return { id: rung.id, model: sanitizeText(rung.id === 'openrouter' ? cfg.openRouterModels.join(', ') : rung.model, 1000), configured: rung.configured, disabled: control.disabledProviders.includes(rung.id), reason: rungReason(rung, cfg),
      usage: usage.available ? { ...usage.usage } : undefined, nextResetAt: usage.dailyResetAt, limits: { rpm: rung.rpm, rpd: rung.rpd, tpm: rung.tpm, tpd: rung.tpd, ...(rung.id === 'cloudflare' ? { neuronsPerDay: 10000 } : {}) }, circuit: getBreaker(`free-chat-chain:${rung.id}`).snapshot() };
  }));
  return { order: cfg.order, enabled: cfg.enabled, runtimeEnabled: control.enabled, rolloutPercent: control.rolloutPercent, allowListConfigured: cfg.allowUids.length > 0, providers,
    paid: { policyState: spend.available ? 'initialized' : 'uninitialized', configuredCapUsd: cfg.errors.includes('FREE_CHAIN_PAID_DAILY_CAP_USD') ? null : cfg.paidCapNanoUsd / 1e9, capUsd: spend.capNanoUsd === null ? null : spend.capNanoUsd / 1e9, policyRevision: spend.policyRevision, reservedUsd: spend.available ? spend.heldNanoUsd / 1e9 : null, reportedUsd: spend.available ? spend.spentNanoUsd / 1e9 : null },

    limitations: [`Configured quota limits use a ${cfg.safetyMargin * 100}% admission margin.`, 'Preview only until owner verifies account tiers, quotas, privacy and model quality. No live account verification was performed.', 'Metrics are a uniform 1-in-64 request sample in a bounded 4096-slot ring of the last 24 hours, not exhaustive totals; shares and quantiles describe the sample only, not exact traffic rates or production p95. Circuit state is local; durable cooldowns protect other instances.', 'Only the verified direct DeepSeek Flash profile can pass the peak-rate reservation and unchanged free-tier price ceiling gates; privacy, quota and shared-budget checks still apply. No live paid request was verified.', 'Environment OFF restores the legacy ladder unless strict-free policy applies. It is not a global spending kill switch.', 'Context and token quota admission use an estimate, not a model-matched tokenizer. Cloudflare neuron admission reserves the entire documented 24000-token input context plus capped output.', 'Free-plan attestations expire; local quotas cannot see unrelated account traffic. Tokens, latency and availability are not guaranteed.', ...cfg.errors.map(e => `Invalid environment variable: ${e}`)] };
}

/** Deliberate admin refresh only. No controls/quota cache and no provider requests. */
export async function freeChainAdminMetrics(): Promise<FreeChainAdminMetrics> {
  const db = getServerDb(); if (!db) throw new Error('FREE_CHAIN_STORE_UNAVAILABLE');
  const observedAt = Date.now();
  const records = await controlRef(db).collection('events')
    .where('at', '>', observedAt - 86400000).where('at', '<=', observedAt)
    .select('at', 'rung', 'latencyMs', 'fallbacks', 'cacheHit').limit(FREE_CHAIN_METRICS_SCAN_LIMIT).get();
  const events = records.docs.map(d => d.data()).filter(d => typeof d.at === 'number' && d.at > observedAt - 86400000 && d.at <= observedAt);
  const latencies = events.map(d => d.latencyMs).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const ratio = (n: number) => events.length ? n / events.length : null;
  return { observedAt, scanLimit: FREE_CHAIN_METRICS_SCAN_LIMIT, windowHours: 24, sampleCount: events.length, complete: false,
    shareByProvider: Object.fromEntries(FREE_CHAIN_PROVIDER_IDS.map(id => [id, ratio(events.filter(e => e.rung === id).length)])),
    fallbackRate: ratio(events.filter(e => e.fallbacks > 0).length), p50Ms: latencies.length ? latencies[Math.floor((latencies.length - 1) * .5)] : null,
    p95Ms: latencies.length ? latencies[Math.floor((latencies.length - 1) * .95)] : null, cacheHitRate: ratio(events.filter(e => e.cacheHit).length) };
}
