import { lastSwitchSync, switchedOffProviderFor } from '../../lib/providerSwitches';
import { chatAvailabilityMessage } from '../../lib/chatAvailabilityMessage';
import { freeChainAdmissionFailure } from './admissionFailure';
import { resolveChatReplyLanguage, chatReplyLanguageCategory } from '../../../lib/chatReplyLanguage';
import { chatReplyLanguageInstruction } from '../../lib/freeChatReplyLanguage';
import { publishDeploymentPaidLimit } from './deploymentBudget';
import { cheaperInferenceAdminStatus, cheaperInferenceMode, cheaperInferenceSharedAccessPermitted, cheapinfFirstTokenMs } from '../../lib/cheaperInferencePolicy';
import { adminBusyDetail, withAdminBusyDetail } from './adminBusyDetail';
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
import { tryAcquireRungSlot, releaseRungSlot, routeTurn, orderForRoute, effectiveMaxOutput, trimHistory, preparedSystemPrompt, faqCacheable, reserveMonthly, settleMonthly, type TurnRoute } from './masterPlan';
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
/** Compatibility export: exhausted fallbacks are neutral, not evidence of traffic overload. */
export function busyMessage(message?: string, history?: unknown, replyLanguage?: unknown): string {
  return chatAvailabilityMessage('temporary', { message, history, replyLanguage });
}
const names: Record<ProviderId, AIProviderResponse['provider']> = { glm47: 'GLM', glm45: 'GLM', gemini: 'GEMINI', groq: 'GROQ', cloudflare: 'CLOUDFLARE', openrouter: 'OPENROUTER', deepseek: 'DEEPSEEK',
  nvidia: 'NVIDIA', modelscope: 'MODELSCOPE', llm7: 'LLM7', bluesminds: 'BLUESMINDS', requesty: 'REQUESTY', glmflashx: 'GLM', gpt5nano: 'OPENAI', llama8b: 'DEEPINFRA', dsv4flash: 'DEEPINFRA', geminipaid: 'GEMINI', cheapinf: 'CHEAPERINFERENCE' };
function empty(reason: FreeChainResult['reason'] = 'all-failed', input?: FreeChainInput, adminDetail?: string, notice?: string): FreeChainResult {
  return { content: withAdminBusyDetail(notice ?? busyMessage(input?.message, input?.history, input?.context.replyLanguage), adminDetail), provider: 'NONE', model: 'none', latencyMs: 0, ok: false, reason };
}
function adminDetailFor(
  input: FreeChainInput,
  earlyReason?: string,
  attempts?: { provider: string; reason: string; entered?: boolean }[],
  extras?: { waitMs?: number; ttftCapMs?: number },
): string | undefined {
  return adminBusyDetail({ context: input.context, earlyReason, attempts, waitMs: extras?.waitMs, ttftCapMs: extras?.ttftCapMs });
}
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
  const target = new URL(rung.baseURL);
  if (switchedOffProviderFor(target.hostname, target.pathname)) return 'disabled';
  if (rung.reason) return rung.reason;
  if (['glm47', 'glm45', 'gemini', 'groq', 'cloudflare'].includes(rung.id) && rung.verifiedUntil <= Date.now()) return 'free-plan-review-required';
  if (rung.id === 'deepseek' && !verifiedDeepseekReservationRate(rung, cfg)) return 'rate-card-unverified';
  // cheapinf skips the Kimi ceiling / rate-card gate under the simple CHEAPERINFERENCE mode.
  if (isPaidRung(rung.id) && rung.id !== 'deepseek' && rung.id !== 'cheapinf' && !verifiedPaidReservationRate(rung)) return 'rate-card-unverified';
  if (rung.id === 'cheapinf') {
    const mode = cheaperInferenceMode();
    if (mode === 'off') return 'disabled';
    if (mode === 'admin' && !input?.context.isAdmin) return 'disabled';
    // mode=all shares the key. Dispatch only after Keak's written permission is recorded.
    if (mode === 'all' && !cheaperInferenceSharedAccessPermitted()) return 'terms-shared-access';
  }
  if (rung.id === 'openrouter' && !cfg.openRouterModels.length) return 'quality-allowlist-required';
  if (input && rung.id === 'gemini' && (!input.context.cacheEligible || !safeCacheKey({ message: input.message, history: input.history, eligible: true, language: 'public', systemPrompt: '', modelFamily: '' }))) return 'privacy-public-corpus-only';
  if (input && !rung.languages.includes(replyLanguageFor(input))) return 'language';
  if (input && (rung.id === 'gemini' || isPaidRung(rung.id)) && (input.context.privateTurn || input.context.healthTurn)) {
    // Exclusive CHEAPERINFERENCE=admin must answer every admin Free Chat turn, including profile/memory.
    if (!(rung.id === 'cheapinf' && input.context.isAdmin === true && cheaperInferenceMode() === 'admin')) return 'privacy';
  }
  // Gemini was explicitly switched OFF by the owner. An empty boot cache is not ON evidence.
  if ((rung.id === 'gemini' || rung.id === 'geminipaid') && lastSwitchSync().at === null) return 'provider-switch-state-unavailable';
  return undefined;
}
function replyLanguageFor(input: FreeChainInput) {
  const explicit = input.context.replyLanguage ?? resolveChatReplyLanguage(input.message, input.history);
  return explicit ? chatReplyLanguageCategory(explicit) : detectReplyLanguage(input.message);
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
/** Missing supplier receipts must not be replaced with a token-price estimate. */
function reportedChargeNanoUsd(response: unknown): number | null {
  const amount = (response as { supplierChargeUsd?: unknown } | null)?.supplierChargeUsd;
  if (typeof amount !== 'string') return null;
  try { return usdToNanoUsd(amount); } catch { return null; }
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
    catch { return done(empty('all-failed', input, adminDetailFor(input, 'paid-budget-publish-failed'))); }
    const explicitLanguage = input.context.replyLanguage ?? resolveChatReplyLanguage(input.message, input.history);
    const language = replyLanguageFor(input);
    const languageInstruction = explicitLanguage ? chatReplyLanguageInstruction(explicitLanguage)
      : `DEFAULT ONLY when this conversation has no explicit reply-language or script request: ${{ hi: 'Reply in Hindi using Devanagari script.', hinglish: 'Reply in Hinglish using Roman script.', en: 'Reply in English.', other: 'Reply in the same language and script as the user.' }[language]}`;
    // Master plan: stable cacheable prefix (dynamic parts last) and the compact core, both kill-switchable.
    const system = `${preparedSystemPrompt(cfg, input.systemPrompt ?? '')}\n\n${languageInstruction}`;
    const cacheKey = cfg.cacheEnabled ? safeCacheKey({ message: input.message, history: input.history, eligible: input.context.cacheEligible, language, systemPrompt: system, modelFamily: JSON.stringify(cfg.rungs.map(r => [r.id, r.model])), faq: cfg.features.faqCache && faqCacheable(input.message) }) : null;
    const history = trimHistory(cfg, input.history);
    if (cacheKey) {
      const hit = await new FreeChainCache(db).get(cacheKey).catch(() => null);
      const cacheControls = hit ? await readControls(db, cfg).catch(() => null) : null;
      const hitRung = hit ? cfg.rungs.find(r => names[r.id] === hit.provider && r.model === hit.model && cfg.order.includes(r.id)) : undefined;
      if (hit && hit.provider !== 'OPENROUTER' && cacheControls?.enabled && hitRung && !cacheControls.disabledProviders.includes(hitRung.id) && !rungReason(hitRung, cfg, input) && !input.signal?.aborted) { trace.cacheHit = true; trace.costUsdEstimate = 0; input.onChunk?.(hit.content); return done({ ...hit, latencyMs: 0, ok: true }); }
    }
    // Rule-based router. Throttle (>= N% of the daily paid cap) keeps DeepSeek for teaching/medical only.
    let routed = routeTurn(cfg, { message: input.message, history: input.history, teachingMode: input.context.teachingTurn });
    if (routed.route === 'quality' && !['teaching', 'medical'].includes(routed.reason) && cfg.features.throttle) {
      const spend = await store.spendSnapshot(Date.now()).catch(() => null);
      const cap = spend?.capNanoUsd ?? cfg.paidCapNanoUsd;
      if (spend && cap > 0 && spend.committedNanoUsd * 100 >= cap * cfg.features.throttlePercent) routed = routeTurn(cfg, { message: input.message, history: input.history, teachingMode: input.context.teachingTurn, throttled: true });
    }
    // CHEAPERINFERENCE=admin: free-chain ladder OFF for verified admins — only cheapinf answers.
    const exclusiveAdmin = input.context.isAdmin === true && cheaperInferenceMode() === 'admin';
    const baseOrder = exclusiveAdmin ? (['cheapinf'] as ProviderId[]) : orderForUser(cfg, input.context.uid);
    let route: TurnRoute = exclusiveAdmin ? 'normal' : routed.route;
    let order = exclusiveAdmin ? baseOrder : orderForRoute(baseOrder, route, cfg.features.routeReorder);
    // A routed order with no usable rung (keys not configured yet, privacy) falls back to the plain order.
    if (!exclusiveAdmin && order !== baseOrder && !order.some(oid => { const r = cfg.rungs.find(x => x.id === oid); return !!r && !rungReason(r, cfg, input); })) { order = baseOrder; route = 'normal'; }
    trace.route = route; trace.routeReason = routed.reason;
    for (const id of order) {
      if (input.signal?.aborted) return done({ ...empty('aborted'), content: '' });
      const baseRung = cfg.rungs.find(r => r.id === id)!;
      const rung: RungConfig = { ...baseRung, maxOutputTokens: effectiveMaxOutput(cfg, id, baseRung.maxOutputTokens, route) };
      const attempt = { provider: id, model: rung.model, reason: 'pending', entered: false }; trace.attempts.push(attempt);
      // Bounded latency: at most cfg.maxAttempts PHYSICAL calls per turn; skipped rungs are free.
      if (trace.attempts.filter(a => a.entered).length >= cfg.maxAttempts) { attempt.reason = 'max-attempts'; break; }
      const reason = rungReason(rung, cfg, input); if (reason) { attempt.reason = reason; continue; }
      const prepared = trimForRung(input.message, history, system, rung.maxInputTokens);
      if (!prepared) { attempt.reason = 'context-capacity'; continue; }
      const attemptStarted = Date.now();
      const breakerName = `free-chat-chain:${id}`; const capacityName = `free-chat-chain:${accountId(id)}`; const breaker = getBreaker(breakerName);
      // Stale OPEN windows (AUTH=1h / QUOTA=1d) hide the real upstream status behind "circuit".
      // Exclusive cheapinf probes those long windows. It also probes a SHORT window when the last
      // reason is retryable (empty_response / timeout / network / server / rate_limit): Beam used
      // to burn the 250-token reply cap on reasoning, open empty_response, and then every later
      // send skipped the only rung because remain was under 30s. Auth and quota still wait.
      if (breaker.isBlocking()) {
        const snap = breaker.snapshot();
        const remainMs = Math.max(0, snap.openedUntil - Date.now());
        const last = snap.lastOpenReason || 'unknown';
        const retryableExclusiveOpen = /^(empty_response|timeout|network|server|rate_limit)(:|$)/.test(last);
        if (exclusiveAdmin && id === 'cheapinf' && (remainMs > 30_000 || retryableExclusiveOpen)) {
          breaker.allowProbe();
          attempt.reason = `circuit-probe:last=${last}`;
        } else {
          attempt.reason = `circuit:last=${last}:remain=${Math.ceil(remainMs / 1000)}s`;
          continue;
        }
      }
      // Real per-rung concurrency (GLM-4.5 Flash 2, GLM-4.7 Flash 1): busy → next rung, no wait.
      if (!tryAcquireRungSlot(cfg, id)) { attempt.reason = 'concurrency'; continue; }
      if (!acquireSlot(capacityName)) { releaseRungSlot(cfg, id); attempt.reason = 'capacity'; continue; }
      let reservation: PaidReservation | null = null;
      let monthHold: { month: string; amount: number } | null = null; let monthSettled = false;
      const controller = new AbortController(); const abort = () => controller.abort(); input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) abort();
      let content = ''; let response: AIProviderResponse | undefined; let completeUsage = false; let partial = false;
      // The watchdog bounds observation, not provider lifetime. Transfer BOTH acquired slots to
      // the original attempt promise, so an uncooperative SDK cannot free capacity by timing out.
      let physical: Promise<void> | undefined;
      let slotsReleased = false;
      const releaseAcquiredSlots = () => {
        if (slotsReleased) return;
        slotsReleased = true;
        releaseSlot(capacityName); releaseRungSlot(cfg, id);
      };
      // Trusted watchdog metadata belongs to this attempt, not to the frozen provider error.
      let watchdogDetail: string | undefined;
      try {
      // A new runtime OFF stops new physical attempts; never silently returns to paid legacy mid-turn.
      // Exclusive CHEAPERINFERENCE=admin path ignores the FreeChain stop switch so the owner can
      // test CI without the free ladder (and without needing FREE_CHAIN_ENABLED).
      const control = await readControls(db, cfg).catch(() => null);
      if (!exclusiveAdmin) {
        if (!control || control.enabled === false) { attempt.reason = 'disabled'; break; }
        if (control.disabledProviders.includes(id)) { attempt.reason = 'disabled'; continue; }
      }
        const target = new URL(rung.baseURL);
        if (switchedOffProviderFor(target.hostname, target.pathname)) { attempt.reason = 'disabled'; continue; }
        let admission = await store.reserveQuota(quotaInput(rung, cfg, prepared.inputTokens));
        // Owner exclusive: a prior AUTH/402 wrote a 1h/1d Firestore cooldown; clear once so the
        // probe can reach CheaperInference and surface the real HTTP status.
        if (!admission.allowed && exclusiveAdmin && id === 'cheapinf' && admission.reason === 'cooldown') {
          const remainMs = typeof admission.resetAt === 'number' ? admission.resetAt - Date.now() : 0;
          if (remainMs > 30_000) {
            await store.clearCooldown(accountId(id)).catch(() => {});
            admission = await store.reserveQuota(quotaInput(rung, cfg, prepared.inputTokens));
          }
        }
        if (!admission.allowed) {
          attempt.reason = admission.reason === 'cooldown' && breaker.snapshot().lastOpenReason
            ? `cooldown:last=${breaker.snapshot().lastOpenReason}`
            : admission.reason;
          if (typeof admission.resetAt === 'number' && admission.resetAt > Date.now()) {
            breaker.honorRemoteOpenUntil(admission.resetAt, admission.reason === 'cooldown' ? 'store-cooldown' : admission.reason);
          }
          continue;
        }
        if (isPaidRung(id)) {
          // The complete model context is reserved, not an unverified character/token approximation.
          // One requestId may hold at most one paid reservation, so a second paid rung in the same
          // turn gets a derived id rather than being rejected as a duplicate.
          if (cfg.features.monthlyCap) {
            const amount = quote(cfg, 1048576, rung.maxOutputTokens, rung);
            const month = await reserveMonthly(db, cfg.features.monthlyCapNanoUsd, amount);
            if (!month) { attempt.reason = 'monthly-budget'; continue; }
            monthHold = { month, amount };
          }
          reservation = await store.reservePaid({ requestId: id === 'deepseek' ? requestId : `${requestId}:${id}`, uid: input.context.uid, maxCostNanoUsd: quote(cfg, 1048576, rung.maxOutputTokens, rung), capNanoUsd: cfg.paidCapNanoUsd, perUserLimit: cfg.paidPerUserDaily });
          if (!reservation?.mayDispatch) { attempt.reason = 'budget'; continue; }
        }
        if (controller.signal.aborted) { attempt.reason = 'aborted'; break; }
        const execute = (chunk: (value: string) => void): Promise<void> => {
          physical = Promise.resolve().then(async () => {
            if (controller.signal.aborted) throw new FreeChainProviderError('ABORTED');
            attempt.entered = true;
            if (id === 'openrouter') {
              const stickyRef = controlRef(db).collection('sticky').doc(input.context.conversationKey);
              const sticky = (await stickyRef.get()).data();
              response = await runRegistryRung({ ...prepared, maxOutputTokens: rung.maxOutputTokens, signal: controller.signal, onChunk: chunk }, cfg.openRouterModels, sticky && typeof sticky.expiresAt === 'number' && sticky.expiresAt > Date.now() && typeof sticky.model === 'string' ? sticky.model : undefined);
              completeUsage = !!response.usage;
              await stickyRef.set({ model: response.model, expiresAt: Date.now() + 86400000, expireAt: new Date(Date.now() + 86400000) });
            } else {
              const provider = new OpenAiCompatProvider({ provider: names[id] as ConstructorParameters<typeof OpenAiCompatProvider>[0]['provider'], key: rung.key, envName: rung.keyEnv, model: rung.model, baseURL: rung.baseURL, priority: cfg.order.indexOf(id), maxOutputTokens: rung.maxOutputTokens, timeoutMs: 90000, streamUsage: rung.streamUsage,
                ...(id === 'gemini' || id === 'geminipaid' ? { extraBody: { reasoning_effort: 'none' } } : id === 'gpt5nano' ? { extraBody: { reasoning_effort: 'minimal' } }
                  // Beam's chat card allows effort low|medium|high|xhigh|max. `low` is the fastest.
                  // none/minimal are not on that card. 2048 tokens leaves room after thinking.
                  : id === 'cheapinf' ? { extraBody: { reasoning_effort: 'low' } }
                  // With the reply cap on, GLM thinking would spend the whole budget on hidden tokens.
                  : cfg.features.outputCap && (id === 'glm45' || id === 'glm47' || id === 'glmflashx') ? { extraBody: { thinking: { type: 'disabled' } } } : {}) });
              const result = await provider.executeTurn({ ...prepared, signal: controller.signal, onChunk: chunk }); response = result; completeUsage = result.completeUsage;
              if (typeof result.cachedInputTokens === 'number') trace.cachedInputTokens = result.cachedInputTokens;
              const remaining = Number(result.rateLimitHeaders['x-ratelimit-remaining-requests']);
              if (id === 'groq' && remaining === 0) await store.cooldown(accountId(id), Date.now() + durationMs(result.rateLimitHeaders['x-ratelimit-reset-requests'], 86400000));
            }
          });
          // Observe late rejection as well as success; never detach a rejecting finally promise.
          void physical.then(releaseAcquiredSlots, releaseAcquiredSlots);
          return physical;
        };
        // Beam (and other cheapinf models) may stream reasoning before delta.content.
          // Free-chat default FREE_CHAIN_TTFT_MS=6s was killing exclusive admin as cheapinf:timeout.
          const firstTokenMs = id === 'cheapinf'
            ? cheapinfFirstTokenMs(exclusiveAdmin, cfg.ttftMs)
            : cfg.ttftMs;
          const watch = await runWatchedStream(execute, chunk => { if (!chunk) return; if (trace.ttftMs === null) trace.ttftMs = Date.now() - started; content += chunk; input.onChunk?.(chunk); },
            { ...(watchdogLimits(undefined, 'free') ?? { firstTokenMs, idleMs: 30000, hardCapMs: 120000 }), firstTokenMs });
          if (watch.verdict !== 'completed') {
            controller.abort();
            partial = watch.delivered;
            if (watch.error) throw watch.error;
            // Encode verdict + cap so admin diagnostic shows why (not a bare "timeout").
            const kind = watch.verdict === 'first-token-timeout' ? 'first-token'
              : watch.verdict === 'idle-timeout' ? 'idle'
              : watch.verdict === 'hard-cap' ? 'hard-cap'
              : 'stream';
            watchdogDetail = `${kind}:${firstTokenMs}ms`;
            throw new FreeChainProviderError(watch.verdict === 'first-token-timeout' || watch.verdict === 'idle-timeout' || watch.verdict === 'hard-cap' ? 'TIMEOUT' : 'NETWORK');
          }
        if (!response || !content.trim()) throw new FreeChainProviderError('EMPTY_RESPONSE');
        const actual = id === 'cheapinf' ? reportedChargeNanoUsd(response)
          : completeUsage && response.usage ? quote(cfg, response.usage.inputTokens, response.usage.outputTokens, rung) : null;
        if (reservation && actual !== null) await store.settlePaid(reservation, actual);
        if (monthHold) { monthSettled = true; await settleMonthly(db, monthHold.month, monthHold.amount, actual); }
        breaker.recordSuccess(); recordProviderLatency(breakerName, Date.now() - attemptStarted, false);
        attempt.reason = 'served'; trace.rung = id; trace.costUsdEstimate = isPaidRung(id) ? (completeUsage && response.usage ? quote(cfg, response.usage.inputTokens, response.usage.outputTokens, rung) / 1e9 : null) : 0;
        if (cacheKey && id !== 'openrouter') await new FreeChainCache(db).put(cacheKey, { content, provider: response.provider, model: response.model }, cfg.cacheTtlS).catch(() => {});
        return done({ ...response, content, ok: true });
      } catch (error) {
        controller.abort(); const safe = error instanceof FreeChainProviderError ? error : error instanceof FreeRoutingError ? new FreeChainProviderError(error.code === 'SAFETY_REFUSAL' ? 'SAFETY_REFUSAL' : error.code === 'REQUEST_ABORTED' ? 'ABORTED' : /^(INVALID_|UNVERIFIED_|TOOL_ENVELOPE_|HTTP_400$|HTTP_413$|HTTP_422$)/.test(error.code) ? 'INVALID_REQUEST' : error.code === 'FREE_BILLING_ANOMALY' ? 'POLICY_BLOCKED' : 'SERVER') : null;
        attempt.reason = safe
          ? `${safe.code.toLowerCase()}${typeof safe.status === 'number' ? `:http=${safe.status}` : ''}${watchdogDetail ? `:${watchdogDetail}` : ''}`
          : 'unavailable';
        if (safe?.code === 'AUTH') warnOnce(`${rung.keyEnv}: authentication failed`);
        if (!['INVALID_REQUEST', 'SAFETY_REFUSAL', 'ABORTED'].includes(safe?.code ?? '')) {
          // Ordinary rungs keep AUTH=1h / QUOTA=1d. Owner exclusive cheapinf caps at 30s so a bad
          // key or empty wallet can be fixed and retried.
          const openReason = attempt.reason; // already auth:http=401 / quota_exhausted:http=402 …
          const requestedCooldown = (exclusiveAdmin && id === 'cheapinf')
            ? Math.min(30_000, safe?.retryAfterMs && safe.retryAfterMs > 0 ? safe.retryAfterMs : 30_000)
            : safe?.code === 'AUTH' ? 3600000 : safe?.retryAfterMs ?? (safe?.code === 'QUOTA_EXHAUSTED' ? 86400000 : 10000);
          const until = Math.max(Date.now() + requestedCooldown, breaker.recordFailure(requestedCooldown, Date.now(), openReason));
          breaker.honorRemoteOpenUntil(until, openReason);
          if (accountId(id) !== 'glm' || ['AUTH', 'RATE_LIMIT', 'QUOTA_EXHAUSTED'].includes(safe?.code ?? '')) await store.cooldown(accountId(id), until).catch(() => {}); recordProviderLatency(breakerName, 0, true);
        }
        // A failed response can still carry a settled supplier receipt. Unknown failures retain holds.
        const failedCharge = id === 'cheapinf' ? reportedChargeNanoUsd(safe) : null;
        if (reservation?.mayDispatch && attempt.entered && failedCharge !== null) {
          await store.settlePaid(reservation, failedCharge);
          if (monthHold && !monthSettled) { monthSettled = true; await settleMonthly(db, monthHold.month, monthHold.amount, failedCharge); }
        }
        // Never release an uncertain paid hold, and never mix replies after text commitment.
        if (partial || content) { trace.rung = id; if (!input.onChunk) content += '\n\nThe response was interrupted. Please try again.'; return done({ content, provider: names[id], model: response?.model ?? rung.model, latencyMs: 0, ok: true, reason: 'stalled' }); }
        if (safe?.code === 'SAFETY_REFUSAL' || safe?.code === 'INVALID_REQUEST' || safe?.code === 'POLICY_BLOCKED' || safe?.code === 'ABORTED' || input.signal?.aborted) break;
      } finally {
        controller.abort(); input.signal?.removeEventListener('abort', abort);
        if (!physical) releaseAcquiredSlots(); // a refusal before dispatch still owns both slots
        // Only a newly granted, never-entered daily hold proves zero cost. A duplicate receipt may
        // belong to an already-running call; an ambiguous/entered call remains fully booked.
        if (reservation?.mayDispatch === true && !attempt.entered) await store.settlePaid(reservation, 0).catch(() => false);
        // Never-dispatched holds are released; a dispatched call with unknown cost stays fully booked.
        if (monthHold && !monthSettled) await settleMonthly(db, monthHold.month, monthHold.amount, attempt.entered ? null : 0);
      }
    }
    const lastTtft = [...trace.attempts].reverse().find(a => a.provider === 'cheapinf' && /timeout:/.test(a.reason));
    const ttftCapMs = lastTtft ? Number((/timeout:(?:first-token|idle|hard-cap|stream):(\d+)ms/.exec(lastTtft.reason) ?? [])[1]) : undefined;
    const result = empty('all-failed', input, adminDetailFor(input, 'all-failed', trace.attempts, {
      waitMs: Date.now() - started,
      ttftCapMs: Number.isFinite(ttftCapMs) ? ttftCapMs : undefined,
    })); input.onChunk?.(result.content, 'notice'); return done(result);
  }
  return { async route(input: FreeChainInput): Promise<FreeChainResult> {
    const entry = input.context.entryAdmission;
    if (isEntryAdmission(entry, input.context.uid)) input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, entry.signal]) : entry.signal };
    if (input.signal?.aborted) return { ...empty('aborted'), content: '' };
    const admission = isEntryAdmission(entry, input.context.uid)
      ? { admitted: true as const, waitedMs: entry!.waitedMs, release: () => {} }
      : await freeChainAdmissionQueue.acquire({ uid: input.context.uid, signal: input.signal, ...cfg.queue });
    if (!admission.admitted) {
      const admReason = admission.reason === 'aborted' ? 'aborted' : 'no-provider';
      const notice = freeChainAdmissionFailure(admission.reason, { message: input.message, history: input.history, replyLanguage: input.context.replyLanguage }).body.reply;
      const detail = admReason === 'aborted' ? undefined : adminDetailFor(input, `admission:${admission.reason}`);
      const result = { ...empty(admReason, input, detail, notice), ...(admReason === 'aborted' ? { content: '' } : {}) };
      const trace: FreeChainTelemetry = { requestId: randomUUID(), queueWaitMs: admission.waitedMs, admissionReason: admission.reason, rung: null, provider: 'NONE', model: 'none', attempts: [], fallbacks: 0, cacheHit: false, costUsdEstimate: null, ttftMs: null, latencyMs: admission.waitedMs, rolloutBucket: rolloutBucket(input.context.uid) };
      logFreeChain(trace);
      await persistFreeChainSample(db, trace, false);
      if (result.content) input.onChunk?.(result.content, 'notice');
      return { ...result, freeChain: trace };
    }
    try {
      const current = refreshConfig?.() ?? cfg;
      // #3933 bug: maybeFreeChain admits CHEAPERINFERENCE=admin when FREE_CHAIN_ENABLED is off,
      // but this gate still returned the busy notice before cheapinf could run.
      const exclusiveAdmin = input.context.isAdmin === true && cheaperInferenceMode() === 'admin';
      if (strictFreeRequired() || (!exclusiveAdmin && (!current.enabled || current.errors.length))) {
        const early = strictFreeRequired() ? 'strict-free-required'
          : !current.enabled ? 'free-chain-disabled'
          : `config-errors:${current.errors.slice(0, 3).join(',')}`;
        const result = empty('all-failed', input, adminDetailFor(input, early));
        input.onChunk?.(result.content, 'notice'); return result;
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
  const unavailable = (earlyReason: string) => {
    const result = empty('all-failed', input, adminDetailFor(input, earlyReason));
    input.onChunk?.(result.content, 'notice');
    return result;
  };
  if (cfg.errors.length && (cfg.enabled || held)) { warnOnce(`Invalid configuration: ${cfg.errors.join(', ')}`); return unavailable(`config-errors:${cfg.errors.slice(0, 3).join(',')}`); }
  // CHEAPERINFERENCE=admin + verified admin: exclusive cheapinf path (free ladder off for this reply).
  // Works even when FREE_CHAIN_ENABLED is off, so the owner can test with only CHEAPERINFERENCE=admin.
  const exclusiveAdmin = input.context.isAdmin === true && cheaperInferenceMode() === 'admin';
  // OFF restores legacy for new requests (no db touch), never for a turn already admitted — unless exclusive admin.
  if (!cfg.enabled && !exclusiveAdmin) return held ? unavailable('free-chain-disabled') : null;
  const db = getServerDb(); if (!db) return unavailable('firestore-unavailable');
  if (exclusiveAdmin) {
    const cheap = cfg.rungs.find(r => r.id === 'cheapinf');
    const status = cheaperInferenceAdminStatus();
    if (!cheap || cheap.reason === 'disabled' || !cheap.configured || !status.apiKeyConfigured) {
      warnOnce('CHEAPERINFERENCE=admin but cheapinf is unconfigured (set CHEAPERINFERENCE_API_KEY)');
      const why = !status.apiKeyConfigured ? 'cheapinf-key-missing-or-invalid'
        : !cheap ? 'cheapinf-rung-missing'
        : `cheapinf-${cheap.reason || 'unconfigured'}`;
      return unavailable(why);
    }
    return buildFreeChainRouter(db, cfg, freeChainConfig).route(input);
  }
  const control = await readControlsForSelection(db, cfg).catch(() => null); if (!control) return unavailable('controls-unavailable');
  if (!selectedForFreeChain(cfg, control, input.context.uid)) return held ? unavailable('not-selected-for-rollout') : null;
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

    limitations: [
      (() => { const s = cheaperInferenceAdminStatus(); return `CheaperInference (${s.defaultModel} @ ${s.baseUrl}): mode=${s.mode}, key=${s.apiKeyConfigured ? 'configured' : 'missing'} (off|admin|all). Default off; admin = exclusive for verified admins; all = first paid rung for everyone.`.slice(0, 500); })(),
      `Configured quota limits use a ${cfg.safetyMargin * 100}% admission margin.`, 'Preview only until owner verifies account tiers, quotas, privacy and model quality. No live account verification was performed.', 'Metrics are a uniform 1-in-64 request sample in a bounded 4096-slot ring of the last 24 hours, not exhaustive totals; shares and quantiles describe the sample only, not exact traffic rates or production p95. Circuit state is local; durable cooldowns protect other instances.', 'Only the verified direct DeepSeek Flash profile can pass the peak-rate reservation and unchanged free-tier price ceiling gates; privacy, quota and shared-budget checks still apply. No live paid request was verified.', 'Environment OFF restores the legacy ladder unless strict-free policy applies. It is not a global spending kill switch.', 'Context and token quota admission use an estimate, not a model-matched tokenizer. Cloudflare neuron admission reserves the entire documented 24000-token input context plus capped output.', 'Free-plan attestations expire; local quotas cannot see unrelated account traffic. Tokens, latency and availability are not guaranteed.', ...cfg.errors.map(e => `Invalid environment variable: ${e}`)] };
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
