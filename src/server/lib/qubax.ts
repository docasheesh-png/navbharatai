import { sseData, takeSseEvents } from './sseFrames';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { noteQubaxModelSwitch, qubaxModelOverride, qubaxRequestCeilingNanoUsd, qubaxSwitchReason, QUBAX_TRIES_PER_TURN, readQubaxMarketPlan, type QubaxMarketChoice } from './qubaxMarket';
import { qubaxReplyMatchesUser } from './qubaxLanguage';
import { getQubaxSelection, type QubaxSelection, type QubaxWorkload } from './qubaxSelector';
import { qubaxSwitchOn } from './alwaysOnSuppliers';
import { noteProviderCall } from '../AI/ProviderHealth/trafficHealth';

/** A silent Qubax try must not hold the user. The next model, then the next provider, gets the same history. */
export const QUBAX_FIRST_BYTE_MS = 8_000;
export const QUBAX_TRY_MS = 12_000;

type Env = Record<string, string | undefined>;
export class QubaxError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly partial = false, readonly dispatched = false) {
    super('Qubax request unavailable.'); this.name = 'QubaxError';
  }
}
export function qubaxConfig(env: Env = process.env) {
  const maxInflight = Number(env.QUBAX_MAX_INFLIGHT || '20');
  if (!Number.isSafeInteger(maxInflight) || maxInflight < 1 || maxInflight > 200) throw new QubaxError('QUBAX_CONFIGURATION');
  // One verified gateway origin. Never take a host, URL or credential from request JSON.
  // Owner t357u: default ON; only an explicit off value is the emergency kill switch.
  return { enabled: qubaxSwitchOn(env), baseURL: 'https://api.qubax.ai/v1', apiKey: env.QUBAX_API_KEY?.trim() || '', maxInflight };
}
function marketSelection(choice: QubaxMarketChoice, ceilingNanoUsd: number, now: number): QubaxSelection {
  return Object.freeze({ modelId: choice.modelId, modelRevision: choice.backup ? 'backup-model' : 'market-performance', sku: choice.backup ? 'backup-model' : 'market-performance',
    maximumNanoUsd: ceilingNanoUsd, qubaxCostNanoUsd: ceilingNanoUsd, officialCostNanoUsd: choice.officialOutputNanoUsdPerMillion ?? ceilingNanoUsd,
    discountBps: choice.discountBps ?? 0, evidenceBinding: hash(`qubax-market-v1\0${choice.modelId}\0${choice.inputNanoUsdPerMillion}\0${choice.outputNanoUsdPerMillion}\0${ceilingNanoUsd}`),
    expiresAtMs: Math.max(now + 1_000, choice.expiresAtMs), reviewRef: choice.backup ? 'backup-model' : 'market-performance' });
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function qubaxWorkload(body: Record<string, unknown>): QubaxWorkload {
  const wire = JSON.stringify(body.messages);
  return { inputTokens: Buffer.byteLength(wire || '', 'utf8') + 256, outputTokens: body.max_tokens as number,
    // Every chat candidate must pass Hindi and general text gates, regardless of prompt language.
    language: 'hi', capability: 'text' };
}
export function qubaxChatBinding(uid: string, body: Record<string, unknown>, selection: QubaxSelection, env: Env = process.env) {
  const cfg = qubaxConfig(env);
  const wire = JSON.stringify({ ...body, model: selection.modelId, ...(body.stream === true ? { stream_options: { include_usage: true } } : {}) });
  const gateway = { baseURL: cfg.baseURL, model: selection.modelId, credentialBinding: hash(`qubax-credential-v1\0${cfg.apiKey}`), selectionBinding: hash(JSON.stringify(selection)) };
  const payloadDigest = hash(wire);
  return { id: hash(JSON.stringify({ uid, payloadDigest, gateway })), payloadDigest, gateway };
}
const refString = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
/** Only an independently reviewed exact payload and ALL possible downstream sellers grant disclosure. */
export function qubaxReviewedApprovalCeiling(value: unknown, input: {
  uid: string; binding: ReturnType<typeof qubaxChatBinding>; selection: QubaxSelection; privateTurn: boolean; healthTurn: boolean; now: number;
}): number | undefined {
  const a = value as any; const r = a?.dataReview; const c = a?.supplierContract;
  const classes = [...(input.privateTurn ? ['private'] : []), ...(input.healthTurn ? ['health'] : [])];
  if (!classes.length) classes.push('public');
  if (!a || a.kind !== 'qubax-exact-data-approval-v1' || a.state !== 'approved' || a.uid !== input.uid
    || a.payloadDigest !== input.binding.payloadDigest || !a.gateway || Object.entries(input.binding.gateway).some(([key, value]) => a.gateway[key] !== value)
    || r?.entirePayloadReviewed !== true || r?.gatewayAndAllDownstreamProcessorsReviewed !== true
    || !Array.isArray(r.approvedDataClasses) || !classes.every(k => r.approvedDataClasses.includes(k))
    || !['reviewRef', 'disclosureAuthorityRef', 'processorTermsRef', 'protectionsRef'].every(k => refString(r[k]))
    || !Number.isSafeInteger(a.reviewedAtMs) || a.reviewedAtMs > input.now || !Number.isSafeInteger(a.expiresAtMs)
    || a.expiresAtMs <= input.now || a.expiresAtMs > a.reviewedAtMs + 300_000 || a.expiresAtMs > input.selection.expiresAtMs
    || c?.currency !== 'USD' || c?.hardCeilingEnforced !== true || c?.includesInternalRetriesFailoversAndFees !== true
    || !refString(c.evidenceRef) || !Number.isSafeInteger(c.perHttpRequestCeilingNanoUsd) || c.perHttpRequestCeilingNanoUsd <= 0
    || c.perHttpRequestCeilingNanoUsd < input.selection.qubaxCostNanoUsd
    || BigInt(c.perHttpRequestCeilingNanoUsd) * 10n > BigInt(input.selection.officialCostNanoUsd)) return undefined;
  return c.perHttpRequestCeilingNanoUsd;
}
function validBody(body: Record<string, unknown>): boolean {
  return Object.keys(body).every(k => ['messages', 'max_tokens', 'stream'].includes(k))
    && Number.isSafeInteger(body.max_tokens) && Number(body.max_tokens) > 0 && Number(body.max_tokens) <= 16384
    && typeof body.stream === 'boolean' && Array.isArray(body.messages) && body.messages.length > 0
    && body.messages.every(m => m && typeof m === 'object' && ['system', 'user', 'assistant'].includes(m.role)
      && typeof m.content === 'string' && Object.keys(m).every(k => ['role', 'content'].includes(k)))
    && Buffer.byteLength(JSON.stringify(body), 'utf8') <= 1024 * 1024;
}
export type QubaxChatOptions = {
  db: Firestore; uid: string; requestId: string; privateTurn: boolean; healthTurn: boolean;
  body: Record<string, unknown>; signal: AbortSignal; onChunk?: (text: string) => void | Promise<void>;
  revalidate?: () => Promise<void>; beforeHttpDispatch?: () => void;
  /** Server Gateway claim binding. Never supplied by request JSON. */
  expectedSelection?: { modelId: string; modelRevision: string; maximumNanoUsd: number };
  reserve: (maximumNanoUsd: number, attemptKey?: string) => Promise<null | { releaseUndispatched(): Promise<void> }>;
  /** Admin Test Chat Bot only. User chat never passes these hooks. */
  onHttpError?: (detail: { status: number; body: string; requestId?: string }) => void;
  onAttemptError?: (detail: { model: string; status: number | null; code: string; latencyMs: number; body?: string; requestId?: string }) => void;
  /** Admin Test Chat Bot only. Used only when the shared market plan is empty. User chat never passes this. */
  adminFallbackTries?: QubaxMarketChoice[];
};
export type QubaxChatResult = { kind: 'skipped'; reason: string } | { kind: 'response'; content: string; model: string; usage?: { inputTokens: number; outputTokens: number } };
let inflight = 0;
/** One paid HTTP attempt, no retry, redirect, direct-provider fallback or cached answer. */
export async function runApprovedQubaxChat(options: QubaxChatOptions, env: Env = process.env): Promise<QubaxChatResult> {
  if (!qubaxSwitchOn(env)) return { kind: 'skipped', reason: 'qubax-disabled-or-unconfigured' };
  let cfg: ReturnType<typeof qubaxConfig>;
  try { cfg = qubaxConfig(env); } catch { return { kind: 'skipped', reason: 'qubax-configuration' }; }
  if (!cfg.apiKey) return { kind: 'skipped', reason: 'qubax-disabled-or-unconfigured' };
  const body = JSON.parse(JSON.stringify(options.body)) as Record<string, unknown>;
  const privateTurn = options.privateTurn, healthTurn = options.healthTurn;
  const expected = options.expectedSelection ? { ...options.expectedSelection } : undefined;
  if (!validBody(body) || (body.stream === true && !options.onChunk)) return { kind: 'skipped', reason: 'qubax-capability-excluded' };
  if (inflight >= cfg.maxInflight) return { kind: 'skipped', reason: 'qubax-capacity' };
  inflight++;
  let hold: Awaited<ReturnType<QubaxChatOptions['reserve']>> = null; let entered = false; let content = '';
  const controller = new AbortController(); const signal = AbortSignal.any([options.signal, controller.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), QUBAX_TRY_MS * QUBAX_TRIES_PER_TURN);
  const pendingWork = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    pendingWork.add(work); void work.then(() => pendingWork.delete(work), () => pendingWork.delete(work));
    return work;
  }
  function cancelBody(cancel: () => Promise<void>) {
    // Cleanup must not delay an answer or cancellation. Retain the capacity slot
    // until it settles, and observe rejection without replacing the actual result.
    try { void track(cancel()); } catch { /* Synchronous cleanup failure is observed too. */ }
  }
  async function bounded<T>(work: Promise<T>): Promise<T> {
    track(work);
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new QubaxError('QUBAX_CANCELLED')); signal.addEventListener('abort', abort, { once: true }); });
    try { signal.throwIfAborted(); return await Promise.race([work, cancelled]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  let released = false;
  const releaseUnused = async () => { if (hold && !entered && !released) { released = true; try { await hold.releaseUndispatched(); } catch { console.warn('[QUBAX]', 'QUBAX_UNUSED_HOLD_RELEASE_FAILED'); } } };
  try {
    signal.throwIfAborted();
    const workload = qubaxWorkload(body);
    // Gateway callers pin a catalog claim. Public chat and the admin test bot re-rank the fresh feed
    // on every turn and try at most three eligible models before the normal chain continues.
    const override = expected ? null : qubaxModelOverride(env);
    const automatic = override && override.mode !== 'invalid' ? override : null;
    const ceiling = expected ? null : qubaxRequestCeilingNanoUsd(env);
    const plan = !expected && automatic && ceiling
      ? await bounded(readQubaxMarketPlan(options.db, automatic, Date.now(), ceiling)) : null;
    const marketTries: QubaxMarketChoice[] = plan ? (plan.eligible.length ? plan.eligible.slice(0, QUBAX_TRIES_PER_TURN) : plan.backup ? [plan.backup] : []) : [];
    if (!expected && !marketTries.length && options.adminFallbackTries?.length) marketTries.push(...options.adminFallbackTries.slice(0, QUBAX_TRIES_PER_TURN));
    if (!expected && !marketTries.length) {
      void import('./qubaxPriceFeedRuntime').then(job => job.refreshQubaxPriceFeed(env)).catch(() => {});
      return { kind: 'skipped', reason: 'qubax-price-or-quality-unverified' };
    }
    let lastModel: string | null = null;
    for (let attempt = 0; attempt < (marketTries.length || 1); attempt++) {
    const market = marketTries[attempt] ?? null;
    const attemptStarted = Date.now();
    let lastHttp: { status: number; body: string; requestId?: string } | undefined;
    if (market && (!ceiling || ceiling <= 0)) return { kind: 'skipped', reason: 'qubax-price-or-quality-unverified' };
    const selection = market ? marketSelection(market, ceiling!, Date.now()) : await bounded(getQubaxSelection(options.db, workload));
    if (!selection) return { kind: 'skipped', reason: 'qubax-price-or-quality-unverified' };
    if (expected && (selection.modelId !== expected.modelId || selection.modelRevision !== expected.modelRevision
      || selection.maximumNanoUsd !== expected.maximumNanoUsd)) return { kind: 'skipped', reason: 'qubax-selection-claim-mismatch' };
    const binding = qubaxChatBinding(options.uid, body, selection, env);
    const digest = (a: any) => hash(JSON.stringify([a.kind, a.uid, a.payloadDigest, a.gateway, a.dataReview, a.supplierContract, a.reviewedAtMs, a.expiresAtMs]));
    const approval = market
      ? { ceiling: ceiling!, digest: 'market-performance', expiresAtMs: selection.expiresAtMs }
      : await bounded(options.db.runTransaction(async tx => {
      const approvalRef = options.db.doc(`qubax_chat_approvals/${binding.id}`);
      const a = (await tx.get(approvalRef)).data();
      const approvedCeiling = qubaxReviewedApprovalCeiling(a, { uid: options.uid, binding, selection, privateTurn, healthTurn, now: Date.now() });
      if (!a || approvedCeiling === undefined) return null;
      signal.throwIfAborted();
      tx.update(approvalRef, { state: 'claimed', requestId: options.requestId, claimedAtMs: Date.now(), attemptsStarted: 0 });
      return { ceiling: approvedCeiling, digest: digest(a), expiresAtMs: a.expiresAtMs as number };
    }));
    if (!approval) return { kind: 'skipped', reason: 'qubax-data-approval-or-ceiling-unavailable' };
    const attemptController = new AbortController();
    let attemptTimer = setTimeout(() => attemptController.abort(), Math.max(1, Math.min(QUBAX_FIRST_BYTE_MS, approval.expiresAtMs - Date.now())));
    const extendAfterFirstByte = () => {
      clearTimeout(attemptTimer);
      attemptTimer = setTimeout(() => attemptController.abort(), Math.max(1, Math.min(QUBAX_TRY_MS, attemptStarted + QUBAX_TRY_MS - Date.now(), approval.expiresAtMs - Date.now())));
    };
    const attemptSignal = AbortSignal.any([options.signal, attemptController.signal]);
    signal.throwIfAborted();
    try {
    const reserved = market ? options.reserve(approval.ceiling, `${options.requestId}:q${attempt + 1}`) : options.reserve(approval.ceiling);
    await bounded(reserved.then(async receipt => { hold = receipt; if (attemptSignal.aborted) await releaseUnused(); return receipt; })); attemptSignal.throwIfAborted();
    if (!hold) return { kind: 'skipped', reason: 'qubax-budget' };
    await bounded(Promise.resolve().then(() => options.revalidate?.())); attemptSignal.throwIfAborted();
    if (market) {
      const adminPin = !!options.adminFallbackTries?.some(row => row.modelId === market.modelId);
      if (!adminPin) {
      const again = await readQubaxMarketPlan(options.db, automatic!, Date.now(), ceiling!);
      const still = again.eligible.find(row => row.modelId === market.modelId) ?? (market.backup && again.backup?.modelId === market.modelId ? again.backup : null);
      if (!still || still.inputNanoUsdPerMillion !== market.inputNanoUsdPerMillion || still.outputNanoUsdPerMillion !== market.outputNanoUsdPerMillion
        || qubaxRequestCeilingNanoUsd(env) !== ceiling || !qubaxConfig(env).enabled || qubaxConfig(env).apiKey !== cfg.apiKey) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
      }
      if (!adminPin && attempt === 0) {
        const pricedIds = new Set(plan!.eligible.map(row => row.modelId));
        const reason = qubaxSwitchReason(lastModel, market, plan!, pricedIds, pricedIds);
        if (reason !== 'unchanged') void noteQubaxModelSwitch(options.db, { atMs: Date.now(), fromModel: lastModel, toModel: market.modelId, reason,
          qubaxInputNanoUsd: market.inputNanoUsdPerMillion, qubaxOutputNanoUsd: market.outputNanoUsdPerMillion,
          officialInputNanoUsd: market.officialInputNanoUsdPerMillion, officialOutputNanoUsd: market.officialOutputNanoUsdPerMillion,
          discountBps: market.discountBps, backup: market.backup }).catch(() => {});
      } else if (!adminPin) void noteQubaxModelSwitch(options.db, { atMs: Date.now(), fromModel: lastModel, toModel: market.modelId, reason: 'provider-failed',
        qubaxInputNanoUsd: market.inputNanoUsdPerMillion, qubaxOutputNanoUsd: market.outputNanoUsdPerMillion,
        officialInputNanoUsd: market.officialInputNanoUsdPerMillion, officialOutputNanoUsd: market.officialOutputNanoUsdPerMillion,
        discountBps: market.discountBps, backup: market.backup }).catch(() => {});
    } else {
    // Re-read the catalog at dispatch: a cached discovery result cannot authorize stale/revoked evidence.
    const currentSelection = await bounded(getQubaxSelection(options.db, workload, Date.now(), true));
    if (!currentSelection || JSON.stringify(currentSelection) !== JSON.stringify(selection)
      || !qubaxConfig(env).enabled || qubaxChatBinding(options.uid, body, selection, env).id !== binding.id) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
    await bounded(options.db.runTransaction(async tx => {
      const approvalRef = options.db.doc(`qubax_chat_approvals/${binding.id}`);
      const a = (await tx.get(approvalRef)).data();
      if (!a || a.state !== 'claimed' || a.requestId !== options.requestId || a.attemptsStarted !== 0
        || digest(a) !== approval.digest || a.expiresAtMs <= Date.now()) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
      signal.throwIfAborted(); tx.update(approvalRef, { attemptsStarted: 1 });
    }));
    }
    signal.throwIfAborted();
    if (Date.now() >= selection.expiresAtMs || !qubaxConfig(env).enabled || qubaxConfig(env).apiKey !== cfg.apiKey) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
    options.beforeHttpDispatch?.(); attemptSignal.throwIfAborted();
    entered = true; // A lost response is still a possible supplier charge until this try is released.
    content = '';
    const response = await fetch(`${cfg.baseURL}/chat/completions`, { method: 'POST', redirect: 'error', signal: attemptSignal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: selection.modelId, ...(body.stream === true ? { stream_options: { include_usage: true } } : {}) }) });
    if (!response.ok) {
      if (options.onHttpError || options.onAttemptError) {
        let body = '';
        try { body = await response.text(); } catch { body = ''; }
        const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || undefined;
        lastHttp = { status: response.status, body: body.slice(0, 4000), requestId };
        if (options.onHttpError) {
          try { options.onHttpError({ status: response.status, body: body.slice(0, 4000), requestId }); } catch { /* Diagnostics must not replace the error. */ }
        }
      } else if (response.body) {
        cancelBody(() => response.body!.cancel());
      }
      throw new QubaxError('QUBAX_HTTP_ERROR', response.status);
    }
    let finished = false; let usage: { inputTokens: number; outputTokens: number } | undefined;
    const inspect = async (value: any) => {
      attemptSignal.throwIfAborted();
      if (!value || value.error || (value.model !== undefined && value.model !== selection.modelId)
        || JSON.stringify(value).includes(cfg.apiKey) || !Array.isArray(value.choices) || value.choices.length > 1) throw new QubaxError('QUBAX_INVALID_RESPONSE');
      const choice = value.choices[0]; const msg = body.stream === true ? choice?.delta : choice?.message;
      if (choice && choice.index !== undefined && choice.index !== 0) throw new QubaxError('QUBAX_INVALID_RESPONSE');
      if (msg?.tool_calls || msg?.function_call || msg?.refusal || ['content_filter', 'safety', 'sensitive'].includes(choice?.finish_reason)) throw new QubaxError('QUBAX_POLICY_BLOCKED');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
      const text = msg?.content;
      if (text !== undefined && text !== null && typeof text !== 'string') throw new QubaxError('QUBAX_INVALID_RESPONSE');
      if (text && finished) throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
      if (text) {
        // Buffer until complete; this blocks cross-event credential disclosure and partial success.
        content += text;
        if (content.includes(cfg.apiKey) || content.length > 1024 * 1024) throw new QubaxError('QUBAX_INVALID_RESPONSE');
      }
      if (choice?.finish_reason === 'stop') finished = true;
      const u = value.usage;
      if (u !== undefined && u !== null) {
        if (!Number.isSafeInteger(u.prompt_tokens) || u.prompt_tokens < 0 || u.prompt_tokens > workload.inputTokens
          || !Number.isSafeInteger(u.completion_tokens) || u.completion_tokens < 0 || u.completion_tokens > workload.outputTokens) throw new QubaxError('QUBAX_INVALID_RESPONSE');
        usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
      }
    };
    if (!response.body) throw new QubaxError('QUBAX_INVALID_RESPONSE');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '', bytes = 0, done = false;
    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes(body.stream === true ? 'text/event-stream' : 'application/json')) throw new QubaxError('QUBAX_INVALID_RESPONSE');
      for (;;) {
        attemptSignal.throwIfAborted(); const item = await bounded(reader.read()); attemptSignal.throwIfAborted(); if (item.done) break;
        if (bytes === 0 && item.value.byteLength > 0) extendAfterFirstByte();
        bytes += item.value.byteLength; if (bytes > 2 * 1024 * 1024) throw new QubaxError('QUBAX_INVALID_RESPONSE');
        pending += decoder.decode(item.value, { stream: true });
        if (body.stream === true) {
          const split = takeSseEvents(pending, false); pending = split.rest;
          for (const frame of split.events) {
            const { payload: data } = sseData(frame);
            if (data === '[DONE]') { done = true; break; }
            if (data) await inspect(JSON.parse(data));
          }
          if (done) break;
        }
      }
      if (body.stream !== true) { pending += decoder.decode(); await inspect(JSON.parse(pending)); }
      // The stream ended: its last event counts even without a closing blank line (sseFrames.ts). A normal finish is
      // `[DONE]` or a "stop" finish_reason; a cut-off stream has neither and still fails here or just below.
      else {
        if (!done) {
          const split = takeSseEvents(pending, true); pending = split.rest;
          for (const frame of split.events) {
            const { payload: data } = sseData(frame);
            if (data === '[DONE]') { done = true; break; }
            if (data) await inspect(JSON.parse(data));
          }
        }
        if (!done && !finished) throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
      }
    } finally {
      cancelBody(() => reader.cancel());
      try { reader.releaseLock(); } catch { /* A cancelled pending read may still own the lock. */ }
    }
    if (!finished || !content.trim()) throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
    if (market && !qubaxReplyMatchesUser(body.messages as { role?: string; content?: string }[], content)) throw new QubaxError('QUBAX_LANGUAGE_MISMATCH');
    attemptSignal.throwIfAborted(); await bounded(Promise.resolve().then(() => options.onChunk?.(content))); attemptSignal.throwIfAborted();
    noteProviderCall({ provider: 'QUBAX', model: selection.modelId, surface: 'qubax', ok: true, totalMs: Math.max(0, Date.now() - attemptStarted) });
    return { kind: 'response', content, model: selection.modelId, ...(usage ? { usage } : {}) };
    } catch (error) {
      noteProviderCall({ provider: 'QUBAX', model: market?.modelId ?? selection.modelId, surface: 'qubax', ok: false, totalMs: Math.max(0, Date.now() - attemptStarted), error });
      if (options.onAttemptError) {
        try {
          const model = market?.modelId ?? selection.modelId;
          options.onAttemptError({
            model,
            status: lastHttp?.status ?? (error instanceof QubaxError && error.status ? error.status : null),
            code: error instanceof QubaxError ? error.code : 'QUBAX_UNAVAILABLE',
            latencyMs: Math.max(0, Date.now() - attemptStarted),
            ...(lastHttp?.body !== undefined ? { body: lastHttp.body } : {}),
            ...(lastHttp?.requestId ? { requestId: lastHttp.requestId } : {}),
          });
        } catch { /* Diagnostics must not replace the error. */ }
      }
      if (!market) throw error;
      // No text was shown. Release this try, then the next model. A caller cancel still throws after the release.
      entered = false;
      let freed = released;
      if (hold) {
        if (released) freed = true;
        else { try { await hold.releaseUndispatched(); freed = true; } catch { freed = false; } }
      } else freed = true;
      if (!freed) throw error;
      hold = null; released = true; content = ''; lastModel = market.modelId;
      if (options.signal.aborted) throw error;
      if (attempt + 1 >= marketTries.length) return { kind: 'skipped', reason: 'qubax-tries-exhausted' };
      released = false;
    } finally { clearTimeout(attemptTimer); attemptController.abort(); }
    }
    return { kind: 'skipped', reason: 'qubax-tries-exhausted' };
  } catch (error) {
    throw new QubaxError(error instanceof QubaxError ? error.code : signal.aborted ? 'QUBAX_CANCELLED' : 'QUBAX_UNAVAILABLE',
      error instanceof QubaxError ? error.status : 0, !!content, entered);
  } finally {
    clearTimeout(timer); controller.abort();
    if (pendingWork.size) void Promise.allSettled([...pendingWork]).then(() => { inflight--; }); else inflight--;
    await releaseUnused();
  }
}
