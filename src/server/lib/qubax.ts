import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getQubaxSelection, type QubaxSelection, type QubaxWorkload } from './qubaxSelector';

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
  return { enabled: env.QUBAX_ENABLED === '1', baseURL: 'https://api.qubax.ai/v1', apiKey: env.QUBAX_API_KEY?.trim() || '', maxInflight };
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
  reserve: (maximumNanoUsd: number) => Promise<null | { releaseUndispatched(): Promise<void> }>;
};
export type QubaxChatResult = { kind: 'skipped'; reason: string } | { kind: 'response'; content: string; model: string; usage?: { inputTokens: number; outputTokens: number } };
let inflight = 0;
/** One paid HTTP attempt, no retry, redirect, direct-provider fallback or cached answer. */
export async function runApprovedQubaxChat(options: QubaxChatOptions, env: Env = process.env): Promise<QubaxChatResult> {
  if (env.QUBAX_ENABLED !== '1') return { kind: 'skipped', reason: 'qubax-disabled-or-unconfigured' };
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
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), 60_000);
  const pendingWork = new Set<Promise<unknown>>();
  async function bounded<T>(work: Promise<T>): Promise<T> {
    pendingWork.add(work); void work.then(() => pendingWork.delete(work), () => pendingWork.delete(work));
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
    const selection = await bounded(getQubaxSelection(options.db, workload));
    if (!selection) return { kind: 'skipped', reason: 'qubax-price-or-quality-unverified' };
    if (expected && (selection.modelId !== expected.modelId || selection.modelRevision !== expected.modelRevision
      || selection.maximumNanoUsd !== expected.maximumNanoUsd)) return { kind: 'skipped', reason: 'qubax-selection-claim-mismatch' };
    const binding = qubaxChatBinding(options.uid, body, selection, env);
    const approvalRef = options.db.doc(`qubax_chat_approvals/${binding.id}`);
    const digest = (a: any) => hash(JSON.stringify([a.kind, a.uid, a.payloadDigest, a.gateway, a.dataReview, a.supplierContract, a.reviewedAtMs, a.expiresAtMs]));
    const approval = await bounded(options.db.runTransaction(async tx => {
      const a = (await tx.get(approvalRef)).data();
      const ceiling = qubaxReviewedApprovalCeiling(a, { uid: options.uid, binding, selection, privateTurn, healthTurn, now: Date.now() });
      if (!a || ceiling === undefined) return null;
      signal.throwIfAborted();
      tx.update(approvalRef, { state: 'claimed', requestId: options.requestId, claimedAtMs: Date.now(), attemptsStarted: 0 });
      return { ceiling, digest: digest(a), expiresAtMs: a.expiresAtMs as number };
    }));
    if (!approval) return { kind: 'skipped', reason: 'qubax-data-approval-or-ceiling-unavailable' };
    clearTimeout(timer); timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(60_000, approval.expiresAtMs - Date.now())));
    signal.throwIfAborted(); await bounded(options.reserve(approval.ceiling).then(async receipt => { hold = receipt; if (signal.aborted) await releaseUnused(); return receipt; })); signal.throwIfAborted();
    if (!hold) return { kind: 'skipped', reason: 'qubax-budget' };
    await bounded(Promise.resolve().then(() => options.revalidate?.())); signal.throwIfAborted();
    // Re-read the catalog at dispatch: a cached discovery result cannot authorize stale/revoked evidence.
    const currentSelection = await bounded(getQubaxSelection(options.db, workload, Date.now(), true));
    if (!currentSelection || JSON.stringify(currentSelection) !== JSON.stringify(selection)
      || !qubaxConfig(env).enabled || qubaxChatBinding(options.uid, body, selection, env).id !== binding.id) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
    await bounded(options.db.runTransaction(async tx => {
      const a = (await tx.get(approvalRef)).data();
      if (!a || a.state !== 'claimed' || a.requestId !== options.requestId || a.attemptsStarted !== 0
        || digest(a) !== approval.digest || a.expiresAtMs <= Date.now()) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
      signal.throwIfAborted(); tx.update(approvalRef, { attemptsStarted: 1 });
    }));
    signal.throwIfAborted();
    if (Date.now() >= selection.expiresAtMs || !qubaxConfig(env).enabled || qubaxConfig(env).apiKey !== cfg.apiKey) throw new QubaxError('QUBAX_APPROVAL_REVOKED');
    options.beforeHttpDispatch?.(); signal.throwIfAborted();
    entered = true; // A lost response is still a possible charge, never permission to replay.
    const response = await fetch(`${cfg.baseURL}/chat/completions`, { method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, model: selection.modelId, ...(body.stream === true ? { stream_options: { include_usage: true } } : {}) }) });
    if (!response.ok) { await response.body?.cancel(); throw new QubaxError('QUBAX_HTTP_ERROR', response.status); }
    let finished = false; let usage: { inputTokens: number; outputTokens: number } | undefined;
    const inspect = async (value: any) => {
      signal.throwIfAborted();
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
        signal.throwIfAborted(); const item = await bounded(reader.read()); signal.throwIfAborted(); if (item.done) break;
        bytes += item.value.byteLength; if (bytes > 2 * 1024 * 1024) throw new QubaxError('QUBAX_INVALID_RESPONSE');
        pending += decoder.decode(item.value, { stream: true });
        if (body.stream === true) {
          pending = pending.replace(/\r\n/g, '\n'); let boundary: number;
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
            const data = frame.split('\n').filter(s => s.startsWith('data:')).map(s => s.slice(5).trimStart()).join('\n');
            if (data === '[DONE]') { done = true; break; }
            if (data) await inspect(JSON.parse(data));
          }
          if (done) break;
        }
      }
      if (body.stream !== true) { pending += decoder.decode(); await inspect(JSON.parse(pending)); }
      else if (!done) throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (!finished || !content.trim()) throw new QubaxError('QUBAX_INCOMPLETE_STREAM');
    signal.throwIfAborted(); await bounded(Promise.resolve().then(() => options.onChunk?.(content))); signal.throwIfAborted();
    return { kind: 'response', content, model: selection.modelId, ...(usage ? { usage } : {}) };
  } catch (error) {
    throw new QubaxError(error instanceof QubaxError ? error.code : signal.aborted ? 'QUBAX_CANCELLED' : 'QUBAX_UNAVAILABLE',
      error instanceof QubaxError ? error.status : 0, !!content, entered);
  } finally {
    clearTimeout(timer); controller.abort();
    if (pendingWork.size) void Promise.allSettled([...pendingWork]).then(() => { inflight--; }); else inflight--;
    await releaseUnused();
  }
}
