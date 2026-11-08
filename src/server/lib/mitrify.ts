import { gatewayTextCredentialBinding, gatewayTextPayloadDigest, GatewayTextTransportError, type GatewayTextPayload, type GatewayTextResponse } from '../AI/InferenceGateway/textTransport';
import { evidenceBinding as gatewayEvidenceBinding, profileRejection as gatewayProfileRejection, withoutEvidence as gatewayWithoutEvidence } from '../AI/InferenceGateway/profiles';
import { isIdentifier as gatewayIsIdentifier, supportsCapability as gatewaySupportsCapability } from '../AI/InferenceGateway/capabilities';
import type { ProviderProfile as GatewayProviderProfile, RoutingRequest as GatewayRoutingRequest } from '../AI/InferenceGateway/types';
import type { DispatchClaim as GatewayDispatchClaim } from '../AI/InferenceGateway/executor';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

/** Server-only transport. No upstream provider catalogue, pricing or capability assumptions. */
type Env = Record<string, string | undefined>;
type Log = (metadata: Record<string, unknown>) => void;
const defaultLog: Log = metadata => console.info('[MITRIFY]', JSON.stringify(metadata));
const headerNames = ['X-Mitrify-Request-Id', 'X-Mitrify-Provider', 'X-Mitrify-Model', 'X-Mitrify-Attempts', 'X-Mitrify-Trail'] as const;
const standardFields = new Set(['model', 'messages', 'stream', 'stream_options', 'temperature', 'max_tokens', 'max_completion_tokens', 'top_p', 'n', 'stop', 'presence_penalty', 'frequency_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'seed']);

// AI_BACKEND is canonical. Its explicit value always wins, including rollback to
// direct. AI_PROVIDER is a compatibility alias only when AI_BACKEND is unset/blank.
function backend(env: Env): string { return env.AI_BACKEND?.trim() || env.AI_PROVIDER?.trim() || 'direct'; }

/** Stop waiting on non-cooperative dependencies without retaining a capacity permit. */
async function untilCancelled<T>(work: () => T | Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new MitrifyError('MITRIFY_CANCELLED'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }), cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

const mitrifyModel = (env: Env) => env.MITRIFY_MODEL?.trim() || 'mitrify/auto-cheap';

/** Classification alone neither authorizes nor prohibits dispatch: exact server review and monetary admission are required. */
export function mitrifyChainStatus(_dataClass: string, capability: string, env: Env = process.env) {
  return { model: mitrifyModel(env), eligible: false as const, reason: env.MITRIFY_CHAIN_ENABLED !== '1' ? 'mitrify-chain-disabled'
    : capability !== 'text' ? 'mitrify-capability-excluded'
    : 'mitrify-data-review-and-spend-admission-unavailable' };
}

/** Exact-payload approval, written only by an existing trusted server operator.
 * It is NOT minted from a caller checkbox, UID, regex or an estimated token price.
 * No approval writer or new account/data access is exposed by this module.
 */
export function mitrifyChainBinding(uid: string, body: Record<string, unknown>, env: Env = process.env) {
  const cfg = mitrifyConfig(env);
  const wire = JSON.stringify({ ...body, model: cfg.model,
    ...(body.stream === true ? { stream_options: { ...(body.stream_options as object ?? {}), include_usage: true } } : {}) });
  const gateway = { baseURL: cfg.baseURL, model: cfg.model,
    credentialBinding: createHash('sha256').update('mitrify-chain-credential-v1\0').update(cfg.apiKey).digest('hex') };
  const payloadDigest = createHash('sha256').update(wire).digest('hex');
  return { id: createHash('sha256').update(JSON.stringify({ uid, payloadDigest, gateway })).digest('hex'), payloadDigest, gateway };
}

/** v1 public reviews retain their original scope. v2 can authorize private/health
 * payloads only through the existing operator-owned exact-payload approval store.
 * References are evidence pointers, not evidence minted by this application.
 */
function reviewedChainData(a: any, privateTurn: boolean, healthTurn: boolean): boolean {
  const reference = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  if (a.kind === 'mitrify-exact-public-approval-v1') {
    return !privateTurn && !healthTurn && a.publicReview?.entirePayloadReviewed === true
      && a.publicReview?.containsSensitiveData === false && reference(a.publicReview?.reviewRef);
  }
  const review = a.dataReview;
  const required = [...(privateTurn ? ['private'] : []), ...(healthTurn ? ['health'] : [])];
  if (!required.length) required.push('public');
  return a.kind === 'mitrify-exact-data-approval-v2' && review?.entirePayloadReviewed === true
    && Array.isArray(review.approvedDataClasses) && required.every(kind => review.approvedDataClasses.includes(kind))
    && review.gatewayAndAllDownstreamProcessorsReviewed === true
    && ['reviewRef', 'disclosureAuthorityRef', 'processorTermsRef', 'protectionsRef'].every(key => reference(review[key]));
}

/** Reads an independently reviewed approval, then owns one durable dispatch claim.
 * The supplier contract must enforce the stated ceiling PER HTTP REQUEST including
 * all its internal retries/failovers/fees. Four transport attempts are reserved in
 * the caller's existing shared daily/monthly pool; no new budget is manufactured.
 * Used holds remain conservative liabilities, never inferred actual invoice cost.
 */
export async function runApprovedMitrifyChain(options: {
  db: Firestore; uid: string; body: Record<string, unknown>; privateTurn: boolean; healthTurn: boolean;
  requestId: string; signal: AbortSignal; maxHttpAttempts?: number; onChunk?: (text: string) => void; revalidate?: () => Promise<void>;
  reserve: (maximumNanoUsd: number) => Promise<null | { releaseUndispatched(): Promise<void> }>;
}, env: Env = process.env, log: Log = defaultLog): Promise<
  { kind: 'skipped'; reason: string } |
  { kind: 'response'; content: string; model: string; usage?: { inputTokens: number; outputTokens: number } }
> {
  if (env.MITRIFY_CHAIN_ENABLED !== '1') return { kind: 'skipped', reason: 'mitrify-chain-disabled' };
  // Snapshot server classification; a later caller mutation cannot broaden the reviewed scope.
  const privateTurn = options.privateTurn, healthTurn = options.healthTurn;
  const maxHttpAttempts = options.maxHttpAttempts ?? 4;
  if (!Number.isInteger(maxHttpAttempts) || maxHttpAttempts < 1 || maxHttpAttempts > 4) throw new MitrifyError('MITRIFY_CONFIGURATION');
  const cfg = mitrifyConfig(env);
  if (!cfg.apiKey) return { kind: 'skipped', reason: 'mitrify-configuration' };
  // Snapshot before any async boundary; later mutation cannot alter reviewed content or credentials.
  const requestEnv = { ...env, MITRIFY_BASE_URL: cfg.baseURL, MITRIFY_MODEL: cfg.model, MITRIFY_API_KEY: cfg.apiKey };
  const body = JSON.parse(JSON.stringify(options.body)) as Record<string, unknown>;
  if (Object.keys(body).some(k => !standardFields.has(k)) || !Array.isArray(body.messages) || !body.messages.length
    || body.messages.some(m => !m || typeof m !== 'object' || !['system', 'developer', 'user', 'assistant'].includes(m.role)
      || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))) {
    return { kind: 'skipped', reason: 'mitrify-capability-excluded' };
  }
  const binding = mitrifyChainBinding(options.uid, body, requestEnv);
  const ref = options.db.doc(`mitrify_chain_approvals/${binding.id}`);
  const policyDigest = (a: any) => JSON.stringify([a.kind, a.dataReview, a.uid, a.payloadDigest, a.gateway?.baseURL, a.gateway?.model, a.gateway?.credentialBinding, a.publicReview?.entirePayloadReviewed, a.publicReview?.containsSensitiveData, a.publicReview?.reviewRef, a.supplierContract?.currency, a.supplierContract?.hardCeilingEnforced, a.supplierContract?.includesInternalRetriesFailoversAndFees, a.supplierContract?.evidenceRef, a.supplierContract?.perHttpRequestCeilingNanoUsd, a.reviewedAtMs, a.expiresAtMs]);
  const now = Date.now();
  const approval = await untilCancelled(() => options.db.runTransaction(async tx => {
    const a = (await tx.get(ref)).data();
    if (!a || !reviewedChainData(a, privateTurn, healthTurn) || a.uid !== options.uid || a.payloadDigest !== binding.payloadDigest
      || (a.gateway?.baseURL !== binding.gateway.baseURL || a.gateway?.model !== binding.gateway.model || a.gateway?.credentialBinding !== binding.gateway.credentialBinding) || a.state !== 'approved'
      || !Number.isSafeInteger(a.reviewedAtMs) || a.reviewedAtMs > now || !Number.isSafeInteger(a.expiresAtMs)
      || a.expiresAtMs <= now || a.expiresAtMs > a.reviewedAtMs + 3600000
      || a.supplierContract?.currency !== 'USD' || a.supplierContract?.hardCeilingEnforced !== true
      || a.supplierContract?.includesInternalRetriesFailoversAndFees !== true
      || typeof a.supplierContract?.evidenceRef !== 'string' || !a.supplierContract.evidenceRef.trim()
      || !Number.isSafeInteger(a.supplierContract?.perHttpRequestCeilingNanoUsd)
      || a.supplierContract.perHttpRequestCeilingNanoUsd <= 0
      || !Number.isSafeInteger(a.supplierContract.perHttpRequestCeilingNanoUsd * 4)) return null;
    options.signal.throwIfAborted();
    tx.update(ref, { state: 'claimed', requestId: options.requestId, claimedAtMs: now, attemptsStarted: 0, maxHttpAttempts });
    return { maximumNanoUsd: a.supplierContract.perHttpRequestCeilingNanoUsd * maxHttpAttempts, expiresAtMs: a.expiresAtMs, policyDigest: policyDigest(a) };
  }), options.signal).catch(() => { throw new MitrifyError(options.signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_ADMISSION_FAILED'); });
  if (!approval) return { kind: 'skipped', reason: 'mitrify-data-approval-or-ceiling-unavailable' };
  let hold: Awaited<ReturnType<typeof options.reserve>> = null;
  let released = false;
  const releaseUnused = async () => { if (hold && !entered && !released) { released = true; try { await hold.releaseUndispatched(); } catch { log({ code: 'MITRIFY_UNUSED_HOLD_RELEASE_FAILED' }); } } };
  let entered = false; let content = ''; let finished = false; let usage: { inputTokens: number; outputTokens: number } | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, approval.expiresAtMs - Date.now()));
  const signal = AbortSignal.any([options.signal, controller.signal]);
  const inspect = (data: any) => {
    const choice = data?.choices?.[0];
    if (choice?.delta?.tool_calls || choice?.delta?.function_call || choice?.message?.tool_calls || choice?.message?.function_call
      || choice?.delta?.refusal || choice?.message?.refusal || ['content_filter', 'safety', 'sensitive'].includes(choice?.finish_reason)) throw new MitrifyError('MITRIFY_POLICY_BLOCKED', 0, !!content);
    if (finished && (choice?.delta?.content || choice?.message?.content)) throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', 0, !!content);
    if (choice?.finish_reason === 'stop') finished = true;
    const text = choice?.delta?.content ?? choice?.message?.content;
    if (typeof text === 'string') { content += text; options.onChunk?.(text); }
    const u = data?.usage;
    if (Number.isSafeInteger(u?.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u?.completion_tokens) && u.completion_tokens >= 0) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    if (choice?.finish_reason === 'length') throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', 0, !!content);
  };
  try {
    signal.throwIfAborted();
    // Observe and clean up late reservations without delaying cancellation.
    const pendingHold = options.reserve(approval.maximumNanoUsd).then(async receipt => { hold = receipt; if (signal.aborted) await releaseUnused(); return receipt; });
    await untilCancelled(() => pendingHold, signal);
    signal.throwIfAborted();
    if (!hold) return { kind: 'skipped', reason: 'mitrify-budget' };
    const result = await createMitrifyClient(requestEnv, log).chat(body, { signal, maxAttempts: maxHttpAttempts,
      beforeAttempt: async () => {
        if (env.MITRIFY_CHAIN_ENABLED !== '1' || mitrifyChainBinding(options.uid, body, env).id !== binding.id) throw new MitrifyError('MITRIFY_APPROVAL_REVOKED');
        await untilCancelled(async () => { await options.revalidate?.(); }, signal);
        await untilCancelled(() => options.db.runTransaction(async tx => {
          const a = (await tx.get(ref)).data();
          if (!a || a.state !== 'claimed' || a.requestId !== options.requestId || policyDigest(a) !== approval.policyDigest || a.expiresAtMs !== approval.expiresAtMs
            || a.expiresAtMs <= Date.now() || !Number.isSafeInteger(a.attemptsStarted) || a.attemptsStarted < 0 || a.maxHttpAttempts !== maxHttpAttempts || a.attemptsStarted >= maxHttpAttempts) throw new MitrifyError('MITRIFY_APPROVAL_REVOKED');
          signal.throwIfAborted(); tx.update(ref, { attemptsStarted: a.attemptsStarted + 1 });
        }), signal);
        // Conservatively retain the hold if cancellation/crash races the actual fetch.
        entered = true;
      },
      ...(body.stream === true ? { onChunk: (wire: Uint8Array) => {
        const payload = new TextDecoder().decode(wire).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (payload && payload !== '[DONE]') inspect(JSON.parse(payload));
      } } : {}),
    });
    if (body.stream !== true) inspect(result.data);
    signal.throwIfAborted();
    if (!content.trim()) throw new MitrifyError('MITRIFY_INVALID_RESPONSE');
    if (!finished) throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', 0, true);
    return { kind: 'response', content, model: cfg.model, ...(usage ? { usage } : {}) };
  } catch (error) {
    // Once an HTTP attempt may have begun, liability and failure are terminal to the chain.
    throw new MitrifyError(error instanceof MitrifyError ? error.code : signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_ADMISSION_FAILED', error instanceof MitrifyError ? error.status : 0, !!content);
  } finally {
    clearTimeout(timer); controller.abort();
    await releaseUnused();
  }
}

export function mitrifyConfig(env: Env = process.env) {
  const maxInflight = env.MITRIFY_MAX_INFLIGHT?.trim() ? Number(env.MITRIFY_MAX_INFLIGHT) : 200;
  if (!Number.isInteger(maxInflight) || maxInflight < 1 || maxInflight > 1000) throw new MitrifyError('MITRIFY_CONFIGURATION');
  return {
    enabled: backend(env) === 'mitrify', maxInflight,
    baseURL: env.MITRIFY_BASE_URL?.trim() || 'https://mitrify.com/v1',
    apiKey: env.MITRIFY_API_KEY?.trim() || '',
    model: mitrifyModel(env),
  };
}

/**
 * General chat is health/clinical, including when profile/history are empty.
 * Third-party free-model providers and Surplus sellers receive the whole prompt:
 * a backend selector alone does not establish processor suitability or disclosure authority.
 * Reviewed main-chain dispatch uses runApprovedMitrifyChain; this compatibility
 * wrapper must not bypass its server-owned review and funding checks.
 * Keep the existing callback intact until a reviewed server-owned boundary exists.
 */
export function withMitrifyChatPrivacyBoundary<T>(direct: () => Promise<T>, env: Env = process.env, log: Log = defaultLog): Promise<T> {
  if (env.AI_BACKEND?.trim() && env.AI_PROVIDER?.trim() && env.AI_BACKEND.trim() !== env.AI_PROVIDER.trim()) log({ code: 'MITRIFY_LEGACY_SWITCH_IGNORED' });
  if (backend(env) === 'mitrify') log({ code: 'MITRIFY_CHAIN_ADMISSION_REQUIRED' });
  return direct();
}

// One FIFO for every client in this process: never one pool per key/model/client.
// Limits retained serialized request bytes, not total heap or Cloud Run fleet concurrency.
const activeCalls = new Set<{ limit: number }>();
const pendingCalls: QueueEntry[] = [];
let retainedBytes = 0;
type QueueEntry = { limit: number; bytes: number; signal: AbortSignal; settled: boolean;
  resolve: (release: () => void) => void; reject: (error: Error) => void; cleanup: () => void };
function dropQueued(entry: QueueEntry, error: Error) {
  if (entry.settled) return;
  entry.settled = true; entry.cleanup();
  pendingCalls.splice(pendingCalls.indexOf(entry), 1); retainedBytes -= entry.bytes;
  entry.reject(error);
}
function drainQueue() {
  while (pendingCalls.length) {
    const entry = pendingCalls[0];
    if (entry.signal.aborted) { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); continue; }
    let limit = entry.limit;
    for (const active of activeCalls) limit = Math.min(limit, active.limit);
    if (activeCalls.size >= limit) return;
    pendingCalls.shift(); entry.settled = true; entry.cleanup();
    const active = { limit: entry.limit }; activeCalls.add(active);
    entry.resolve(() => {
      if (!activeCalls.delete(active)) return;
      retainedBytes -= entry.bytes; drainQueue();
    });
  }
}
function acquireCapacity(limit: number, bytes: number, signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) throw new MitrifyError('MITRIFY_CANCELLED');
  // Throw before yielding, so a rejected burst does not retain serialized bodies
  // in thousands of suspended async frames waiting for a rejected promise.
  if (pendingCalls.length >= 1000 || retainedBytes + bytes > 64 * 1024 * 1024) throw new MitrifyError('MITRIFY_QUEUE_FULL', 503);
  retainedBytes += bytes;
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cancel = () => { dropQueued(entry, new MitrifyError('MITRIFY_CANCELLED')); drainQueue(); };
    const entry: QueueEntry = { limit, bytes, signal, settled: false, resolve, reject,
      cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); } };
    pendingCalls.push(entry);
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { dropQueued(entry, new MitrifyError('MITRIFY_QUEUE_TIMEOUT', 503)); drainQueue(); }, 30_000);
    drainQueue();
  });
}

/**
 * Server-owned admission only, never supplied by a request or an environment flag.
 * An implementation must verify a gateway-enforced total INR cap, including all
 * retries/upstream failover, and atomically consume this test once across instances.
 * The UID is a local admission key only; it must never be transmitted to Mitrify.
 * A local ledger/token estimate is not a gateway charge ceiling. No live adapter
 * exists yet; production must remain unavailable until that proof is implemented.
 */
export class MitrifyError extends Error {
  readonly status: number;
  readonly code: string;
  readonly partial: boolean;
  constructor(code: string, status = 0, partial = false) {
    const messages: Record<string, string> = {
      MITRIFY_QUEUE_FULL: 'Mitrify capacity is full; no new request was dispatched.',
      MITRIFY_QUEUE_TIMEOUT: 'The request timed out waiting for Mitrify capacity; it was not dispatched.',
    };
    super(messages[code] || (code === 'MITRIFY_CONFIGURATION' ? 'Mitrify configuration error: check server credentials and URL.'
      : partial ? 'The AI reply was interrupted and is incomplete.' : 'Mitrify request failed; see status and error code in server metadata.'));
    this.name = 'MitrifyError'; this.code = code; this.status = status; this.partial = partial;
  }
}

function safeHeaders(response: Response, key: string): Record<string, string | null> {
  return Object.fromEntries(headerNames.map(name => {
    const value = response.headers.get(name);
    return [name, value === null ? null : value.split(key).join('[REDACTED]').replace(/[\r\n]/g, ' ').slice(0, 2048)];
  }));
}

/** Raw gateway error messages can echo credentials or prompts. Never log/return them. */
function statusCode(status: number): string {
  return status === 401 ? 'MITRIFY_CONFIGURATION' : status === 400 ? 'MITRIFY_BAD_REQUEST' : `MITRIFY_HTTP_${status}`;
}

export function createMitrifyClient(env: Env = process.env, log: Log = defaultLog) {
  const config = mitrifyConfig(env);
  function endpoint(path: string): string {
    let url: URL;
    try { url = new URL(config.baseURL); } catch { throw new MitrifyError('MITRIFY_CONFIGURATION'); }
    // Loopback HTTP is exclusively for offline mock tests. Never follow redirects with a key.
    if (!config.apiKey || url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) {
      throw new MitrifyError('MITRIFY_CONFIGURATION');
    }
    return `${url.href.replace(/\/$/, '')}/${path}`;
  }

  async function request(path: string, body: string | undefined, signal: AbortSignal, beforeAttempt?: () => Promise<void>, maxAttempts = 4): Promise<Response> {
    const url = endpoint(path);
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      await beforeAttempt?.();
      signal.throwIfAborted();
      const started = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
          headers: { Authorization: `Bearer ${config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body,
        });
      } catch {
        throw new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_NETWORK');
      }
      log({ ...safeHeaders(response, config.apiKey), status: response.status, latencyMs: Date.now() - started, attempt });
      if (response.ok) return response;
      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
      if (![429, 503].includes(response.status) || attempt >= maxAttempts - 1) {
        const code = statusCode(response.status);
        log({ code, status: response.status });
        throw new MitrifyError(code, response.status);
      }
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const serverDelay = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
        : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
      let waitMs = Math.max(1000 * 2 ** attempt + Math.random() * 250, Number.isFinite(serverDelay) ? serverDelay : 0);
      log({ code: 'MITRIFY_RETRY', status: response.status, delayMs: waitMs });
      // Avoid setTimeout's 32-bit overflow for a distant Retry-After date.
      while (waitMs > 0) {
        const part = Math.min(waitMs, 2_147_483_647);
        await delay(part, undefined, { signal });
        waitMs -= part;
      }
    }
  }

  return {
    /** Manual diagnostics only. Never used to construct a UI model list. */
    async models(signal: AbortSignal): Promise<{ status: number; headers: Record<string, string | null> }> {
      let release: (() => void) | undefined;
      try {
        release = await acquireCapacity(config.maxInflight, 0, signal);
        const response = await request('models', undefined, signal);
        if (!response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel(); throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        }
        const data = await response.json();
        signal.throwIfAborted();
        if (!data || !Array.isArray(data.data)) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        return { status: response.status, headers: safeHeaders(response, config.apiKey) };
      } catch (error) { throw error instanceof MitrifyError ? error : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE'); }
      finally { release?.(); }
    },
    /** Low-level transport only: production general-chat ingress cannot authorize this call. */
    async chat(input: Record<string, unknown>, options: { signal: AbortSignal; onChunk?: (chunk: Uint8Array) => void | Promise<void>; beforeAttempt?: () => Promise<void>; maxAttempts?: number }) {
      let partial = false;
      let release: (() => void) | undefined;
      const controller = new AbortController();
      const signal = AbortSignal.any([options.signal, controller.signal]);
      const started = Date.now();
      try {
        if (Object.keys(input).some(key => !standardFields.has(key)) || !Array.isArray(input.messages) || !input.messages.length
          || input.messages.some(m => !m || typeof m !== 'object' || !['system', 'developer', 'user', 'assistant'].includes(m.role)
            || typeof m.content !== 'string' || Object.keys(m).some(k => !['role', 'content'].includes(k)))
          || (input.stream !== undefined && typeof input.stream !== 'boolean')
          || (input.stream === true && !options.onChunk)) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const streamOptions = input.stream_options;
        if (streamOptions !== undefined && (!streamOptions || typeof streamOptions !== 'object' || Array.isArray(streamOptions))) throw new MitrifyError('MITRIFY_UNSUPPORTED_REQUEST');
        const body = JSON.stringify({ ...input, model: config.model,
          ...(input.stream === true ? { stream_options: { ...streamOptions as object, include_usage: true } } : {}),
        });
        if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 4)) throw new MitrifyError('MITRIFY_CONFIGURATION');
        const bytes = Buffer.byteLength(body);
        if (bytes > 8 * 1024 * 1024) throw new MitrifyError('MITRIFY_BODY_TOO_LARGE', 413);
        release = await acquireCapacity(config.maxInflight, bytes, signal);
        const response = await request('chat/completions', body, signal, options.beforeAttempt, options.maxAttempts);
        const headers = safeHeaders(response, config.apiKey);
        if (input.stream !== true) {
          if (!response.headers.get('content-type')?.includes('application/json')) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          const data = await response.json();
          signal.throwIfAborted();
          if (JSON.stringify(data).includes(config.apiKey) || data?.error || !Array.isArray(data?.choices) || !data.choices.some((c: any) => typeof c?.message?.content === 'string' && c.message.content.trim())) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
          return { status: response.status, headers, data };
        }
        if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = ''; let done = false;
        // Never retain answer events while waiting for an optional field to recur.
        // Reject a substantial credential prefix before disclosure, including when
        // split over events. At most the short prefix preceding this marker can pass.
        const protectedPrefix = config.apiKey.slice(0, Math.min(8, Math.ceil(config.apiKey.length / 4)));
        const prefixes = new Map<string, string>();
        // Inspect all forwarded strings, including extension fields and field names.
        const inspectStrings = (value: unknown, path: string[]): void => {
          if (typeof value === 'string') {
            const channel = JSON.stringify(path);
            const text = (prefixes.get(channel) ?? '') + value;
            if (text.includes(protectedPrefix)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
            let length = Math.min(text.length, protectedPrefix.length - 1);
            while (length && !text.endsWith(protectedPrefix.slice(0, length))) length--;
            if (length) prefixes.set(channel, text.slice(-length));
            else prefixes.delete(channel);
          } else if (Array.isArray(value)) {
            value.forEach((item, index) => inspectStrings(item, [...path,
              path.at(-1) === 'field:choices' ? `choice:${item?.index ?? index}` : 'array']));
          } else if (value && typeof value === 'object') {
            for (const [key, item] of Object.entries(value)) {
              inspectStrings(key, [...path, 'keys']); inspectStrings(item, [...path, `field:${key}`]);
            }
          }
          if (prefixes.size > 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
        };
        try {
          for (;;) {
            signal.throwIfAborted();
            const item = await reader.read();
            signal.throwIfAborted();
            if (item.done) break;
            // Inspect one bounded SSE event at a time; forward valid events immediately.
            pending += decoder.decode(item.value, { stream: true });
            pending = pending.replace(/\r\n/g, '\n');
            let boundary: number;
            while ((boundary = pending.indexOf('\n\n')) >= 0) {
              signal.throwIfAborted();
              const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
              if (event.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
              if (event.includes(config.apiKey)) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
              // SSE comments/control fields are not answer data and must not expose
              // arbitrary upstream strings to the client.
              const dataLines = event.split('\n').filter(line => line.startsWith('data:'));
              const payload = dataLines.map(line => line.slice(5).trimStart()).join('\n');
              if (payload && payload !== '[DONE]') {
                const data = JSON.parse(payload);
                if (JSON.stringify(data).includes(config.apiKey) || data.error) throw new MitrifyError('MITRIFY_STREAM_ERROR', response.status, partial);
                inspectStrings(data, []);
              }
              if (payload === '[DONE]') done = true;
              if (dataLines.length) {
                partial = true; // The consumer may write before throwing or stalling.
                const wire = `${dataLines.join('\n')}\n\n`;
                await untilCancelled(() => options.onChunk!(new TextEncoder().encode(wire)), signal);
                signal.throwIfAborted();
              }
              if (done) break;
            }
            if (done) break;
            if (pending.length > 1024 * 1024) throw new MitrifyError('MITRIFY_INVALID_RESPONSE', response.status, partial);
          }
          if (!done) throw new MitrifyError('MITRIFY_INCOMPLETE_STREAM', response.status, partial);
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        signal.throwIfAborted();
        return { status: response.status, headers, data: undefined };
      } catch (error) {
        const safe = error instanceof MitrifyError ? new MitrifyError(error.code, error.status, partial || error.partial) : new MitrifyError(signal.aborted ? 'MITRIFY_CANCELLED' : 'MITRIFY_INVALID_RESPONSE', 0, partial);
        log({ code: safe.code, status: safe.status, partial: safe.partial });
        throw safe;
      } finally { controller.abort(); release?.(); log({ code: 'MITRIFY_FINISHED', latencyMs: Date.now() - started, partial }); }
    },
  };
}

/** Reviewed Gateway adapter. The gateway alias remains a black box: no upstream
 * model, token price or internal retry count is used for admission/accounting.
 * Exactly one HTTP call belongs to one durable Gateway claim. Unknown charges
 * retain that claim's full supplier ceiling for authoritative reconciliation.
 */
export interface GatewayMitrifyConfig {
  readonly kind?: 'text';
  readonly provider: 'MITRIFY';
  readonly baseURL: string;
  readonly model: string;
  readonly credentialEnv: 'MITRIFY_API_KEY';
  readonly credentialBinding: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly rateCard: {
    readonly version: string;
    readonly perHttpRequestCeilingNanoUsd: number;
    readonly hardCeilingEnforced: true;
    readonly includesInternalRetriesFailoversAndFees: true;
    readonly evidenceRef: string;
    readonly gatewayAndAllDownstreamProcessorsReviewed: true;
    readonly processorPolicyReviewRef: string;
    readonly disclosureAuthorityRef: string;
    readonly verifiedAtMs: number;
    readonly expiresAtMs: number;
  };
}
export interface GatewayMitrifyAuthorization {
  readonly profile: GatewayProviderProfile;
  readonly transport: GatewayMitrifyConfig;
  readonly claim: GatewayDispatchClaim;
  readonly request: GatewayRoutingRequest;
}
export interface GatewayMitrifyInput extends Omit<GatewayTextPayload, 'streaming'>, GatewayMitrifyAuthorization {
  readonly signal: AbortSignal;
  readonly onChunk?: (text: string) => void | Promise<void>;
  readonly markOutputVisible: () => Promise<void>;
  readonly assertDispatchPolicy: () => void;
  readonly authorizeClaim: (authorization: GatewayMitrifyAuthorization) => Promise<boolean>;
}
/** Server catalog validation only. This does not grant a dispatch or mint a review. */
export function gatewayMitrifyCeiling(t: GatewayMitrifyConfig, now = Date.now()): number {
  const cfg = mitrifyConfig(); const rate = t?.rateCard;
  const fail = (): never => { throw new GatewayTextTransportError('CONFIGURATION'); };
  if (process.env.MITRIFY_CHAIN_ENABLED !== '1' || !t || Object.keys(t).some(k => !['kind', 'provider', 'baseURL', 'model', 'credentialEnv', 'credentialBinding', 'maxOutputTokens', 'timeoutMs', 'rateCard'].includes(k))
    || (t.kind !== undefined && t.kind !== 'text') || t.provider !== 'MITRIFY' || t.credentialEnv !== 'MITRIFY_API_KEY'
    || t.baseURL !== cfg.baseURL || t.model !== cfg.model || !cfg.apiKey
    || t.credentialBinding !== gatewayTextCredentialBinding(cfg.apiKey)
    || !Number.isSafeInteger(t.maxOutputTokens) || t.maxOutputTokens < 1 || t.maxOutputTokens > 131072
    || !Number.isSafeInteger(t.timeoutMs) || t.timeoutMs < 1 || t.timeoutMs > 600000
    || !rate || Object.keys(rate).some(k => !['version', 'perHttpRequestCeilingNanoUsd', 'hardCeilingEnforced', 'includesInternalRetriesFailoversAndFees', 'evidenceRef', 'gatewayAndAllDownstreamProcessorsReviewed', 'processorPolicyReviewRef', 'disclosureAuthorityRef', 'verifiedAtMs', 'expiresAtMs'].includes(k))
    || ![rate.version, rate.evidenceRef, rate.processorPolicyReviewRef, rate.disclosureAuthorityRef].every(gatewayIsIdentifier)
    || rate.hardCeilingEnforced !== true || rate.includesInternalRetriesFailoversAndFees !== true || rate.gatewayAndAllDownstreamProcessorsReviewed !== true
    || !Number.isSafeInteger(rate.perHttpRequestCeilingNanoUsd) || rate.perHttpRequestCeilingNanoUsd < 1
    || !Number.isSafeInteger(rate.verifiedAtMs) || !Number.isSafeInteger(rate.expiresAtMs)
    || rate.verifiedAtMs > now || rate.expiresAtMs <= now || rate.expiresAtMs - rate.verifiedAtMs > 86400000) fail();
  const url = new URL(t.baseURL);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail();
  return rate.perHttpRequestCeilingNanoUsd;
}
function validateGatewayMitrify(a: GatewayMitrifyAuthorization, payload: GatewayTextPayload): void {
  const { profile: p, transport: t, claim: c, request: r } = a;
  const maximum = gatewayMitrifyCeiling(t); const fail = (): never => { throw new GatewayTextTransportError('POLICY_BLOCKED'); };
  if (!r || !p || !c || !c.binding || !gatewayIsIdentifier(c.id) || !gatewayIsIdentifier(c.claimId)
    || !Number.isSafeInteger(c.queueWaitConsumedAtDispatchMs) || c.queueWaitConsumedAtDispatchMs < 0
    || c.intentBinding !== gatewayEvidenceBinding(c.binding) || gatewayProfileRejection(p, r)
    || !['chat', 'professional', 'doctor', 'sda'].includes(r.surface)
    || r.capability.kind !== 'text' || p.charging !== 'metered' || p.providerId !== 'MITRIFY'
    || p.adapterId !== 'gateway-mitrify-text-v1' || p.modelId !== t.model
    || r.mode !== 'free-first-authorized-paid' || r.outputVisible || r.cancellation?.cancelled !== false
    || !Number.isSafeInteger(r.deadlineAtMs) || r.deadlineAtMs <= Date.now()
    || !Number.isSafeInteger(r.attemptTimeoutMs) || r.attemptTimeoutMs < 1) fail();
  const b = c.binding;
  if (b.profileId !== p.id || b.profileVersion !== p.version || b.providerId !== p.providerId || b.modelId !== p.modelId
    || b.modelRevision !== p.modelRevision || b.adapterId !== p.adapterId || b.key.logicalRequestId !== r.logicalRequestId
    || b.key.principalId !== r.principalId || b.key.tenantId !== r.tenantId || b.key.payloadDigest !== r.payloadDigest
    || b.physicalAttemptId !== r.nextPhysicalAttemptId || b.budgetScopeId !== r.budgetScopeId
    || gatewayEvidenceBinding(b.payer) !== gatewayEvidenceBinding(r.payer)
    || b.profileBinding !== gatewayEvidenceBinding(gatewayWithoutEvidence(p)) || b.requestBinding !== gatewayEvidenceBinding(gatewayWithoutEvidence(r))
    || r.payloadDigest !== gatewayTextPayloadDigest(payload) || !b.budget || !b.priceBinding || !b.budgetAuthorizationBinding
    || b.budget.rateCardVersion !== t.rateCard.version || b.budget.amountNanoUsd < maximum) fail();
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim() || (payload.systemPrompt !== undefined && typeof payload.systemPrompt !== 'string')
    || payload.schema !== undefined || (payload.images !== undefined && (!Array.isArray(payload.images) || payload.images.length))
    || payload.modelOverride !== undefined || r.capability.kind !== 'text'
    || r.capability.streaming !== payload.streaming || r.capability.systemPrompt !== !!payload.systemPrompt
    || r.capability.outputTokens > t.maxOutputTokens
    || !p.capabilities.some(support => gatewaySupportsCapability(r.capability, support))
    || Buffer.byteLength(payload.prompt + (payload.systemPrompt ?? ''), 'utf8') + 256 > r.capability.inputTokens) fail();
}
export async function executeGatewayMitrify(input: GatewayMitrifyInput): Promise<GatewayTextResponse> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController(); const started = Date.now(); let content = ''; let visible = false;
  try {
    if (!input?.signal || typeof input.authorizeClaim !== 'function' || typeof input.markOutputVisible !== 'function'
      || typeof input.assertDispatchPolicy !== 'function') throw new GatewayTextTransportError('POLICY_BLOCKED');
    const a = JSON.parse(gatewayEvidenceBinding({ profile: input.profile, transport: input.transport, claim: input.claim, request: input.request })) as GatewayMitrifyAuthorization;
    const payload: GatewayTextPayload = { prompt: input.prompt, systemPrompt: input.systemPrompt, schema: input.schema,
      images: input.images === undefined ? undefined : [...input.images], modelOverride: input.modelOverride, streaming: !!input.onChunk };
    validateGatewayMitrify(a, payload);
    const expiresAt = Math.min(a.request.deadlineAtMs, Date.now() + a.request.attemptTimeoutMs, Date.now() + a.transport.timeoutMs, a.transport.rateCard.expiresAtMs);
    timer = setTimeout(() => controller.abort(), Math.max(0, expiresAt - Date.now()));
    const signal = AbortSignal.any([input.signal, controller.signal]);
    const active = () => { if (signal.aborted || Date.now() >= expiresAt) throw new GatewayTextTransportError(input.signal.aborted ? 'ABORTED' : 'TIMEOUT'); };
    const cfg = mitrifyConfig();
    const protectedPrefix = cfg.apiKey.slice(0, Math.min(8, Math.ceil(cfg.apiKey.length / 4)));
    let authorized = false; let finish: 'stop' | 'length' | undefined; let usage: { inputTokens: number; outputTokens: number } | undefined;
    const inspect = async (data: any) => {
      active();
      if (!data || typeof data !== 'object' || data.error || !Array.isArray(data.choices) || data.choices.length > 1) throw new GatewayTextTransportError('INVALID_REQUEST');
      const choice = data.choices[0];
      if (choice && ((choice.index !== undefined && choice.index !== 0) || (payload.streaming ? choice.message !== undefined : choice.delta !== undefined))) throw new GatewayTextTransportError('INVALID_REQUEST');
      const text = choice?.delta?.content ?? choice?.message?.content;
      if (choice?.delta?.tool_calls || choice?.message?.tool_calls || choice?.delta?.function_call || choice?.message?.function_call
        || choice?.delta?.refusal || choice?.message?.refusal || (choice?.finish_reason != null && !['stop', 'length'].includes(choice.finish_reason))) throw new GatewayTextTransportError('SAFETY_REFUSAL');
      if ((text !== undefined && text !== null && typeof text !== 'string') || (finish && text)) throw new GatewayTextTransportError('INVALID_REQUEST');
      if (text) {
        // Protect the actual visible text channel, regardless of how upstream JSON
        // paths or optional indices split a credential across events.
        if ((content + text).includes(protectedPrefix)) throw new GatewayTextTransportError('POLICY_BLOCKED');
        if (Buffer.byteLength(content, 'utf8') + Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) throw new GatewayTextTransportError('INVALID_REQUEST');
        if (!visible) { await untilCancelled(input.markOutputVisible, signal); visible = true; }
        active(); content += text;
        if (input.onChunk) await untilCancelled(() => input.onChunk!(text), signal);
      }
      if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
        if (finish && finish !== choice.finish_reason) throw new GatewayTextTransportError('INVALID_REQUEST');
        finish = choice.finish_reason;
      }
      const u = data.usage;
      if (u && Number.isSafeInteger(u.prompt_tokens) && u.prompt_tokens >= 0 && Number.isSafeInteger(u.completion_tokens) && u.completion_tokens >= 0) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens };
    };
    const result = await createMitrifyClient({ ...process.env, MITRIFY_BASE_URL: a.transport.baseURL, MITRIFY_MODEL: a.transport.model, MITRIFY_API_KEY: cfg.apiKey }).chat({
      messages: [...(payload.systemPrompt ? [{ role: 'system', content: payload.systemPrompt }] : []), { role: 'user', content: payload.prompt }],
      max_tokens: a.request.capability.kind === 'text' ? a.request.capability.outputTokens : 0, stream: payload.streaming,
    }, { signal, maxAttempts: 1,
      beforeAttempt: async () => {
        active(); validateGatewayMitrify(a, payload); input.assertDispatchPolicy();
        if (authorized) throw new GatewayTextTransportError('POLICY_BLOCKED');
        authorized = true;
        if (!await untilCancelled(() => input.authorizeClaim(a), signal)) throw new GatewayTextTransportError('POLICY_BLOCKED');
        active(); validateGatewayMitrify(a, payload); input.assertDispatchPolicy();
      },
      ...(payload.streaming ? { onChunk: async (wire: Uint8Array) => {
        const body = new TextDecoder().decode(wire).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (body && body !== '[DONE]') await inspect(JSON.parse(body));
      } } : {}),
    });
    if (!payload.streaming) await inspect(result.data);
    active();
    if (!authorized || !content.trim() || !finish) throw new GatewayTextTransportError('EMPTY_RESPONSE');
    // Token usage is telemetry, not a supplier invoice or permission to refund.
    return Object.freeze({ content, provider: 'MITRIFY', model: a.transport.model, latencyMs: Date.now() - started,
      completeUsage: !!usage, outputVisible: visible, finishReason: finish, ...(usage ? { usage } : {}) });
  } catch (error) {
    if (error instanceof GatewayTextTransportError) throw error;
    const code = input?.signal?.aborted ? 'ABORTED' : controller.signal.aborted ? 'TIMEOUT'
      : error instanceof MitrifyError && error.status === 401 ? 'AUTH'
      : error instanceof MitrifyError && error.status === 429 ? 'RATE_LIMIT' : 'NETWORK';
    throw new GatewayTextTransportError(code);
  } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
