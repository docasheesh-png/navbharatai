import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { abandonedTurnUsage } from '../../AgentV3/unbilledTurns';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import type { OpenAiChatClient, OpenAiChatStream } from '../../AgentV3/providers/OpenAiToolRunner';
import { audit } from '../../lib/audit';
import { BoundedCache } from '../../lib/boundedCache';
import { getServerDb } from '../../lib/serverDb';
import { calculateCatalogueChatCost, catalogueSnapshotIssue, estimateCatalogueChatCost, type CatalogueEstimateBasis } from './catalogueMath';
import { estimateMessagesTokens, estimateTokens } from '../../AgentV3/TokenEstimator';
import { RouterOnePublicPriceSource, routerOnePublicPrices, ROUTER_ONE_PRICE_MAX_AGE_MS, type PublicPriceSnapshot } from './publicPriceSource';
import { isRouterOneAccountingProvider, RouterOneAccountingUnavailableError, routerOneAccountingGate } from './accounting';
import { markRestOfBuildSkip } from '../../lib/engineSafeDiag';

export interface CatalogueCallBinding { buildId: string; uid: string; workspaceId: string }
export interface RouterOneCatalogueReceipt extends CatalogueCallBinding {
  /** `catalogue-calculated`: complete usage priced exactly. `catalogue-estimated` (owner 2026-11-15,
   * BR2388): no complete receipt, so the same published tariff priced an estimate — see `estimateBasis`. */
  kind: 'catalogue-calculated' | 'catalogue-estimated';
  expenseEvidence: 'official-public-tariff' | 'official-public-tariff-estimate'; settledWalletDebit: false;
  callId: string; model: string; credentialSha256: string; requestId: string | null;
  costAttoUsd: string; modelSubtotalAttoUsd: string; inputTokens: number; outputTokens: number;
  cacheReadTokens: number | null; snapshot: PublicPriceSnapshot;
  /** Estimates only: which evidence priced it, and the human label that says "Estimated". */
  estimateBasis?: CatalogueEstimateBasis; estimateLabel?: string; pendingReason?: string;
}
/** True for an issued receipt that was priced by estimate rather than complete usage. */
export function isRouterOneEstimatedReceipt(v: unknown): v is RouterOneCatalogueReceipt & { kind: 'catalogue-estimated' } {
  return isRouterOneCatalogueReceipt(v) && v.kind === 'catalogue-estimated';
}
const issued = new WeakSet<object>();
export function isRouterOneCatalogueReceipt(v: unknown): v is RouterOneCatalogueReceipt {
  return !!v && typeof v === 'object' && issued.has(v);
}
export interface CatalogueAttemptStore {
  reserve(binding: CatalogueCallBinding, callId: string, credentialSha256: string, snapshot: PublicPriceSnapshot, deadlineAt: number,
    requestInputTokens?: number): Promise<void>;
  releaseVerified(callId: string, credentialSha256: string): Promise<void>;
  finish(callId: string, credentialSha256: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void>;
}
/** Normal requests share the key concurrently. Only unresolved or expired attempts
 * fence new dispatches. Completion is acknowledged before its hold is released. */
type KeyState = { version: 2; active: Record<string, number>; unresolved: Record<string, true> };
function keyState(value: unknown): KeyState {
  if (value === undefined) return { version: 2, active: {}, unresolved: {} };
  const v = value as KeyState;
  if (v.version !== 2 || !v.active || !v.unresolved
    || Object.values(v.active).some(t => !Number.isSafeInteger(t) || t <= 0)
    || Object.values(v.unresolved).some(t => t !== true)) throw new RouterOneAccountingUnavailableError('key_state_invalid');
  return { version: 2, active: { ...v.active }, unresolved: { ...v.unresolved } };
}
export class FirestoreCatalogueAttemptStore implements CatalogueAttemptStore {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly now = Date.now) {}
  async reserve(binding: CatalogueCallBinding, callId: string, key: string, snapshot: PublicPriceSnapshot, deadlineAt: number,
    requestInputTokens?: number): Promise<void> {
    if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= this.now()) throw new RouterOneAccountingUnavailableError('reserve_deadline');
    const state = this.db.doc(`router_one_accounting_keys/${key}`);
    const attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    const healed: Array<{ callId: string; basis: string; costAttoUsd: string; previousStatus: string }> = [];
    const admitted = await this.db.runTransaction(async tx => {
      healed.length = 0; // a retried transaction starts over
      const previous = await tx.get(state), next = keyState(previous.exists ? previous.data() : undefined);
      for (const [id, deadline] of Object.entries(next.active)) if (deadline <= this.now()) next.unresolved[id] = true;
      // 🔓 SELF-HEAL (owner 2026-11-15, BR2388). An unresolved entry is an EARLIER call whose build is over
      // (its deadline passed, or it finished without a complete receipt). It used to hold the key's lock
      // forever. It is now settled here, in the same transaction, by an estimate from the tariff snapshot
      // bound to it, recorded as estimated and ABSORBED (its build already settled its bill), and released.
      // At most SELF_HEAL_MAX_PER_RESERVE per transaction; any remainder still refuses, visibly, and the
      // next build's reserve settles the next batch.
      const ids = Object.keys(next.unresolved).slice(0, SELF_HEAL_MAX_PER_RESERVE);
      const rows = await Promise.all(ids.map(async id => ({ id, row: await tx.get(this.db.doc(`router_one_catalogue_attempts/${id}`)) })));
      const updates: Array<() => void> = [];
      for (const { id, row } of rows) {
        const data = row.exists ? row.data() as Record<string, unknown> | undefined : undefined;
        const status = typeof data?.status === 'string' ? data.status : 'missing';
        if (status === 'catalogue-calculated' || status === 'catalogue-estimated' || status === 'self-healed-estimate') {
          // Already settled (e.g. its release acknowledgement was lost): release only, never price twice.
          delete next.active[id]; delete next.unresolved[id];
          continue;
        }
        const heal = selfHealEstimate(data);
        healed.push({ callId: id, basis: heal.basis, costAttoUsd: heal.costAttoUsd, previousStatus: status });
        const ref = this.db.doc(`router_one_catalogue_attempts/${id}`);
        const record = { status: 'self-healed-estimate', previousStatus: status, absorbed: true, healedAt: this.now(), result: heal };
        updates.push(row.exists ? () => tx.update(ref, record) : () => tx.set(ref, { callId: id, credentialSha256: key, ...record }));
        delete next.active[id]; delete next.unresolved[id];
      }
      for (const write of updates) write();
      if (Object.keys(next.unresolved).length) { tx.set(state, next); return false; }
      if (next.active[callId]) throw new RouterOneAccountingUnavailableError('reserve_duplicate');
      next.active[callId] = deadlineAt;
      tx.create(attempt, { ...binding, callId, credentialSha256: key, snapshot, status: 'reserved', createdAt: this.now(), deadlineAt,
        ...(Number.isSafeInteger(requestInputTokens) && (requestInputTokens as number) >= 0 ? { requestInputTokens } : {}) });
      tx.set(state, next); return true;
    });
    for (const h of healed) {
      try { audit('ROUTER_ONE_LOCK_SELF_HEALED', { callId: h.callId, previousStatus: h.previousStatus, estimateBasis: h.basis,
        expenseEvidence: 'official-public-tariff-estimate', costAttoUsd: h.costAttoUsd, absorbed: true }); } catch { /* observation only */ }
    }
    // Still unresolved after self-heal: an entry that could not be priced. Visible gate; the caller
    // skips this key for the rest of the build (no repeated refusals or transactions).
    if (!admitted) throw new RouterOneAccountingUnavailableError('reserve_fenced_unresolved');
  }
  async finish(callId: string, key: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`), attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), row = await tx.get(attempt);
      const next = keyState(previous.exists ? previous.data() : undefined);
      if (!next.active[callId] || row.data()?.status !== 'reserved') throw new RouterOneAccountingUnavailableError('finish_state');
      // Retained until the caller has received the write acknowledgement and issued evidence.
      next.unresolved[callId] = true;
      tx.update(attempt, { status: result.kind, result, completedAt: this.now() });
      tx.set(state, next);
    });
  }
  async releaseVerified(callId: string, key: string): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`), attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), row = await tx.get(attempt);
      const next = keyState(previous.exists ? previous.data() : undefined);
      const status = row.data()?.status;
      const settled = status === 'catalogue-calculated' || status === 'catalogue-estimated';
      // Idempotent: another worker's reserve self-heal may already have released this SETTLED call
      // (release only, never re-priced). That is success, not an accounting failure.
      if (settled && !next.active[callId] && !next.unresolved[callId]) return;
      if (!next.active[callId] || !next.unresolved[callId] || !settled) throw new RouterOneAccountingUnavailableError('release_state');
      delete next.active[callId]; delete next.unresolved[callId];
      tx.set(state, next);
    });
  }
}
/** Never evict an unresolved hold to admit more spending. A hold lasts until the uncertain call's own
 * deadline (owner 2026-11-15): after that the durable store's self-heal settles it, so this worker no
 * longer fences the key until restart. Saturation with live holds still fails closed. */
export function createRouterOneUncertainFence(maxKeys = 64) {
  const keys = new BoundedCache<string, number>({ maxEntries: maxKeys });
  let saturated = false;
  const live = (key: string, now: number): boolean => (keys.get(key, now) ?? 0) > now;
  return {
    has: (key: string, now: number = Date.now()): boolean => saturated || live(key, now),
    add(key: string, until: number = Number.POSITIVE_INFINITY, now: number = Date.now()): void {
      if (saturated) return;
      const current = keys.get(key, now);
      if (current !== undefined && current > now) { if (until > current) keys.set(key, until); return; }
      if (current !== undefined) keys.delete(key);
      if (keys.size >= keys.maxEntries) {
        for (const [k] of keys.entries(now)) if (!live(k, now)) keys.delete(k);
        if (keys.size >= keys.maxEntries) { saturated = true; return; }
      }
      keys.set(key, until);
    },
  };
}
const uncertainKeys = createRouterOneUncertainFence();
interface Scope {
  binding?: CatalogueCallBinding; stopped: boolean; receipts: RouterOneCatalogueReceipt[];
  /** BR2388: credential hashes whose reserve this build saw refused by an unresolved lock. Per request
   * scope (one build) only — a new build starts empty and asks the durable store again. */
  lockedKeys?: Set<string>;
}
interface Attempt {
  callId: string; key: string; snapshot: PublicPriceSnapshot; scope: Scope; store: CatalogueAttemptStore;
  requestId: string | null; done: boolean; receipt?: RouterOneCatalogueReceipt;
  /** Estimate evidence (owner 2026-11-15): request size, output received, last HTTP status, deadline. */
  requestInputTokens: number; outputChars: number; httpStatus: number | null; deadlineAt: number;
  /** BR2388 review: set just before the SDK is called. An attempt that never got here was never sent. */
  dispatched?: boolean;
}
const scopes = new AsyncLocalStorage<Scope>();
const turns = new AsyncLocalStorage<{ attempts: Attempt[] }>();
const dispatches = new AsyncLocalStorage<Attempt>();

export const routerOneAccountingScope: RequestHandler = (_req, res, next) => {
  const scope: Scope = { stopped: false, receipts: [] };
  res.once('close', () => { scope.stopped = true; });
  scopes.run(scope, next);
};
export function bindRouterOneAccountingScope(binding: Omit<CatalogueCallBinding, 'uid'> & { uid: string | null | undefined }): void {
  const scope = scopes.getStore();
  if (!scope || scope.binding || typeof binding.uid !== 'string' || !binding.uid || !binding.buildId || !binding.workspaceId) return;
  scope.binding = Object.freeze({ ...binding, uid: binding.uid });
}
export function recordRouterOneRequestId(requestId: string | null, status?: number): void {
  const attempt = dispatches.getStore(); if (!attempt) return;
  attempt.requestId = requestId;
  if (typeof status === 'number' && Number.isSafeInteger(status) && status >= 100 && status <= 599) attempt.httpStatus = status;
}
/** Injectable scope for non-network regression tests; no trust in HTTP body fields. */
export function runInRouterOneAccountingScope<T>(binding: CatalogueCallBinding, fn: () => T): T {
  return scopes.run({ binding: Object.freeze({ ...binding }), stopped: false, receipts: [] }, fn);
}
export function currentRouterOneCatalogueReceipts(): readonly RouterOneCatalogueReceipt[] { return scopes.getStore()?.receipts.slice() ?? []; }
/**
 * Error codes that mean the connection was never set up, so the request never reached the engine
 * (DNS failure, refused, unreachable, TLS certificate/handshake failure, connect timeout). Deliberately
 * narrow: anything not listed is billed by the conservative request estimate.
 */
const SETUP_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_WRONG_VERSION_NUMBER',
  // Review 3: getaddrinfo (EAI_*) and local-bind (EADDRNOTAVAIL) failures happen before a socket exists, and
  // these TLS codes only arise in the handshake, before any request byte is sent — never after dispatch.
  'EAI_NONAME', 'EAI_FAIL', 'EAI_NODATA', 'EAI_ADDRFAMILY', 'EADDRNOTAVAIL',
  'ERR_TLS_HANDSHAKE_TIMEOUT', 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE', 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
  'ERR_SSL_UNSUPPORTED_PROTOCOL', 'ERR_SSL_NO_PROTOCOLS_AVAILABLE']);
const SETUP_CODE_RE = /^(?:CERT_|UNABLE_TO_(?:GET_ISSUER_CERT|VERIFY_LEAF_SIGNATURE|GET_CRL|DECRYPT_CERT))|_CERT_(?:NOT_YET_VALID|HAS_EXPIRED|REVOKED|UNTRUSTED|REJECTED)$/;
/**
 * After dispatch: timeouts, aborts, and connections dropped once the request may already have been
 * sent (reset, aborted, broken pipe, socket closed by the other side). The supplier may have done the
 * work, so these keep the request-size estimate — even if a setup-looking code also appears in the chain.
 */
const AFTER_DISPATCH_NAMES = new Set(['AbortError', 'APIUserAbortError', 'APIConnectionTimeoutError', 'TimeoutError']);
const AFTER_DISPATCH_CODES = new Set(['ABORT_ERR', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_ABORTED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED']);
/**
 * BR2388 review: did this call fail with NO HTTP response because the connection was never set up?
 * Walks the whole `cause` chain (undici: TypeError('fetch failed') with the code on `.cause`; the SDK
 * wraps that again as APIConnectionError). True ONLY when a setup code is found and no after-dispatch
 * name/code is anywhere in the chain and the caller's signal did not fire. An error with no code at
 * all (a bare 'fetch failed', 'socket hang up', anything unknown) is decided CONSERVATIVELY: false,
 * so it is billed by the labelled request-size estimate — we cannot prove the request never left.
 */
export function routerOneNetworkSetupFailure(error: unknown, signalAborted = false): boolean {
  if (signalAborted) return false;
  let setup = false;
  let node: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && node !== null && typeof node === 'object' && !seen.has(node); depth++) {
    seen.add(node);
    const e = node as { name?: unknown; code?: unknown; cause?: unknown };
    const name = typeof e.name === 'string' ? e.name : '', code = typeof e.code === 'string' ? e.code : '';
    if (AFTER_DISPATCH_NAMES.has(name) || AFTER_DISPATCH_CODES.has(code)) return false;
    if (SETUP_CODES.has(code) || (code !== '' && SETUP_CODE_RE.test(code))) setup = true;
    node = e.cause;
  }
  return setup;
}
async function finish(attempt: Attempt, model: string, usage: unknown, complete: boolean,
  failure?: { error: unknown; signalAborted: boolean }): Promise<void> {
  // Idempotent per call: whichever of the stream end, the runner finalizer or a late response arrives
  // first settles it — exact receipt OR estimate — and every later arrival is ignored (no double charge).
  if (attempt.done) return;
  attempt.done = true;
  const calculated = calculateCatalogueChatCost(attempt.snapshot, model, usage, complete,
    attempt.snapshot.fetchedAt, ROUTER_ONE_PRICE_MAX_AGE_MS);
  // Snapshot freshness is checked at dispatch, not after a long successful response.
  let receipt: RouterOneCatalogueReceipt | undefined = calculated.kind === 'catalogue-calculated' ? Object.freeze({
    ...attempt.scope.binding!, kind: 'catalogue-calculated', expenseEvidence: 'official-public-tariff', settledWalletDebit: false,
    callId: attempt.callId, credentialSha256: attempt.key, model, requestId: attempt.requestId,
    costAttoUsd: calculated.costAttoUsd, modelSubtotalAttoUsd: calculated.modelSubtotalAttoUsd,
    inputTokens: calculated.inputTokens, outputTokens: calculated.outputTokens, cacheReadTokens: calculated.cacheReadTokens,
    snapshot: attempt.snapshot,
  }) as RouterOneCatalogueReceipt : undefined;
  if (!receipt) {
    // 🔓 Owner 2026-11-15 (BR2388): no complete receipt ⇒ settle by ESTIMATE from the same published tariff
    // bound at dispatch, labelled as estimated, and release the key — never a permanent lock.
    // BR2388 review: a call never sent, or one whose connection was never set up, produced nothing billable.
    const noResponse = !attempt.dispatched ? 'not-dispatched' as const
      : failure && routerOneNetworkSetupFailure(failure.error, failure.signalAborted) ? 'network' as const : undefined;
    const estimate = estimateCatalogueChatCost(attempt.snapshot, usage,
      { requestInputTokens: attempt.requestInputTokens, outputChars: attempt.outputChars, httpStatus: attempt.httpStatus,
        ...(noResponse ? { noResponse } : {}) });
    if (estimate) receipt = Object.freeze({
      ...attempt.scope.binding!, kind: 'catalogue-estimated', expenseEvidence: 'official-public-tariff-estimate', settledWalletDebit: false,
      callId: attempt.callId, credentialSha256: attempt.key, model: model || attempt.snapshot.model, requestId: attempt.requestId,
      costAttoUsd: estimate.costAttoUsd, modelSubtotalAttoUsd: estimate.modelSubtotalAttoUsd,
      inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens, cacheReadTokens: estimate.cacheReadTokens,
      snapshot: attempt.snapshot, estimateBasis: estimate.basis, estimateLabel: estimate.label,
      pendingReason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage',
    }) as RouterOneCatalogueReceipt;
  }
  try {
    await attempt.store.finish(attempt.callId, attempt.key, receipt ?? { kind: 'pending',
      reason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage', requestId: attempt.requestId });
    if (receipt) {
      issued.add(receipt); attempt.receipt = receipt; attempt.scope.receipts.push(receipt);
      // A release failure cannot revoke acknowledged, billable evidence or replay output.
      // Owner 2026-11-15: a lost release acknowledgement no longer fences the key — the reserve below
      // drops a stale hold, and the receipt above already carries the known cost.
      try { await attempt.store.releaseVerified(attempt.callId, attempt.key); }
      catch { attempt.scope.stopped = true; uncertainKeys.add(attempt.key, attempt.deadlineAt); }
      try { audit(receipt.kind === 'catalogue-estimated' ? 'ROUTER_ONE_CATALOGUE_ESTIMATED' : 'ROUTER_ONE_CATALOGUE_PRICED', { buildId: receipt.buildId, callId: receipt.callId,
        model: receipt.model, expenseEvidence: receipt.expenseEvidence, settledWalletDebit: false,
        costAttoUsd: receipt.costAttoUsd, modelSubtotalAttoUsd: receipt.modelSubtotalAttoUsd,
        source: receipt.snapshot.source, sourceSha256: receipt.snapshot.sourceSha256,
        ...(receipt.kind === 'catalogue-estimated' ? { estimated: true, estimateBasis: receipt.estimateBasis, estimateLabel: receipt.estimateLabel, pendingReason: receipt.pendingReason } : {}) }); } catch { /* observation only */ }
    }
    else absorbed(attempt, calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage');
  } catch {
    // The write is uncertain: fence this key on this worker until the call's own deadline. After it, the
    // durable store's self-heal settles the attempt by estimate (owner 2026-11-15) — never until restart.
    uncertainKeys.add(attempt.key, attempt.deadlineAt);
    attempt.scope.stopped = true;
  }
}
/** Estimate for an earlier attempt whose build is over, from the tariff snapshot stored with it. */
function selfHealEstimate(data: Record<string, unknown> | undefined): { kind: 'catalogue-estimated'; expenseEvidence: 'official-public-tariff-estimate';
  basis: string; label: string; costAttoUsd: string; modelSubtotalAttoUsd: string; inputTokens: number; outputTokens: number } {
  const tag = { kind: 'catalogue-estimated' as const, expenseEvidence: 'official-public-tariff-estimate' as const };
  const snapshot = data?.snapshot as PublicPriceSnapshot | undefined;
  const requestInputTokens = typeof data?.requestInputTokens === 'number' ? data.requestInputTokens : 0;
  if (snapshot && typeof snapshot === 'object') {
    const e = estimateCatalogueChatCost(snapshot, undefined, { requestInputTokens, outputChars: 0, selfHeal: true });
    if (e) return { ...tag, basis: e.basis, label: e.label, costAttoUsd: e.costAttoUsd, modelSubtotalAttoUsd: e.modelSubtotalAttoUsd, inputTokens: e.inputTokens, outputTokens: e.outputTokens };
  }
  // No usable snapshot stored with it (legacy or damaged row): settle at an explicit, labelled zero —
  // absorbed, never charged — rather than hold every future build's key closed.
  return { ...tag, basis: 'self-heal-unrecorded', label: 'Estimated at zero when an earlier unresolved call was settled: no usable tariff or request size was recorded for it; absorbed, not charged to any user.',
    costAttoUsd: '0', modelSubtotalAttoUsd: '0', inputTokens: 0, outputTokens: 0 };
}
const SELF_HEAL_MAX_PER_RESERVE = 25;
/** Heuristic input tokens of a chat request (TokenEstimator — dependency-free, never a network count). */
function requestTokensOf(request: { messages?: unknown; tools?: unknown }): number {
  try {
    const messages = Array.isArray(request.messages) ? request.messages as Array<{ role?: string; content?: unknown }> : [];
    return estimateMessagesTokens(messages) + (request.tools ? estimateTokens(JSON.stringify(request.tools)) : 0);
  } catch { return 0; }
}
/** Characters of model output in one completion or stream chunk (content, reasoning, tool arguments). */
function outputCharsOf(choices: unknown, field: 'delta' | 'message'): number {
  let n = 0;
  try {
    if (!Array.isArray(choices)) return 0;
    for (const c of choices as Array<Record<string, unknown>>) {
      const m = c?.[field] as Record<string, unknown> | undefined;
      if (!m || typeof m !== 'object') continue;
      for (const k of ['content', 'reasoning_content']) if (typeof m[k] === 'string') n += (m[k] as string).length;
      if (Array.isArray(m.tool_calls)) for (const t of m.tool_calls as Array<{ function?: { arguments?: unknown; name?: unknown } }>) {
        if (typeof t?.function?.arguments === 'string') n += t.function.arguments.length;
        if (typeof t?.function?.name === 'string') n += t.function.name.length;
      }
    }
  } catch { /* evidence only */ }
  return n;
}
export interface RouterOneAccountingDependencies {
  prices?: Pick<RouterOnePublicPriceSource, 'snapshot'>;
  store?: CatalogueAttemptStore;
  now?: () => number;
  maxDurationMs: number;
}
/** Wrap each physical SDK request, not a logical retry. No credentials are persisted. */
export function cataloguePricedRouterOneClient(client: OpenAiChatClient, key: string,
  deps: RouterOneAccountingDependencies): OpenAiChatClient {
  return { chat: { completions: { create: async (request, options) => {
    const scope = scopes.getStore(), turn = turns.getStore();
    const keySha = createHash('sha256').update(key).digest('hex');
    const admit = async (): Promise<{ scope: Scope; turn: { attempts: Attempt[] }; attempt: Attempt }> => {
      if (!scope?.binding) throw new RouterOneAccountingUnavailableError('no_scope');
      if (scope.stopped) throw new RouterOneAccountingUnavailableError('scope_stopped');
      if (!turn) throw new RouterOneAccountingUnavailableError('no_turn');
      if (options?.signal?.aborted) throw new RouterOneAccountingUnavailableError('aborted');
      // BR2388: this build already saw this key's reserve refused by an unresolved lock. Asking again
      // cannot succeed in this build, so refuse here — no price fetch, no Firestore transaction.
      if (scope.lockedKeys?.has(keySha)) throw markRestOfBuildSkip(new RouterOneAccountingUnavailableError('build_skip_unresolved_lock'));
      if (!key.trim()) throw new RouterOneAccountingUnavailableError('no_key');
      if (!Number.isSafeInteger(request.max_tokens) || request.max_tokens! <= 0 || request.max_tokens! > 65536) throw new RouterOneAccountingUnavailableError('max_tokens');
      const fetched = await (deps.prices ?? routerOnePublicPrices).snapshot(request.model);
      const snapshot: PublicPriceSnapshot = Object.freeze({ ...fetched, bands: Object.freeze(fetched.bands.map(b => Object.freeze({ ...b }))) });
      if (snapshot.model !== request.model || catalogueSnapshotIssue(snapshot, (deps.now ?? Date.now)(), ROUTER_ONE_PRICE_MAX_AGE_MS)
        || snapshot.parserVersion !== 'router-one-product-jsonld-v1' || !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256)) throw new RouterOneAccountingUnavailableError('snapshot_invalid');
      const db = deps.store ? undefined : getServerDb();
      const store = deps.store ?? (db ? new FirestoreCatalogueAttemptStore(db) : undefined);
      if (!store) throw new RouterOneAccountingUnavailableError('no_store');
      if (scope.stopped) throw new RouterOneAccountingUnavailableError('scope_stopped');
      if (options?.signal?.aborted) throw new RouterOneAccountingUnavailableError('aborted');
      const deadlineAt = (deps.now ?? Date.now)() + deps.maxDurationMs;
      const attempt: Attempt = { callId: randomUUID(), key: keySha, snapshot, scope, store, requestId: null, done: false,
        requestInputTokens: requestTokensOf(request as { messages?: unknown; tools?: unknown }), outputChars: 0, httpStatus: null, deadlineAt };
      if (uncertainKeys.has(attempt.key)) throw new RouterOneAccountingUnavailableError('uncertain_fence');
      if (!Number.isSafeInteger(deps.maxDurationMs) || deps.maxDurationMs <= 0) throw new RouterOneAccountingUnavailableError('duration_invalid');
      try {
        await store.reserve(scope.binding, attempt.callId, attempt.key, snapshot, deadlineAt, attempt.requestInputTokens);
      } catch (error) {
        // Only this gate retires the key for the rest of the build. Every other refusal (deadline,
        // duplicate, invalid state, a database error) keeps today's per-call behaviour.
        if (routerOneAccountingGate(error) === 'reserve_fenced_unresolved') {
          (scope.lockedKeys ??= new Set()).add(keySha);
          markRestOfBuildSkip(error);
        }
        throw error;
      }
      return { scope, turn, attempt };
    };
    let admitted: Awaited<ReturnType<typeof admit>>;
    try { admitted = await admit(); }
    catch (error) {
      const gate = routerOneAccountingGate(error);
      if (gate) { try { console.warn(`[ROUTER_ONE] refused before dispatch: ${gate}`); } catch { /* observation only */ } }
      throw error;
    }
    const { attempt } = admitted;
    admitted.turn.attempts.push(attempt);
    try {
      if (admitted.scope.stopped || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError(admitted.scope.stopped ? 'scope_stopped' : 'aborted');
      attempt.dispatched = true;
      const raw = await dispatches.run(attempt, () => client.chat.completions.create(request, options));
      if (Symbol.asyncIterator in raw) {
        const stream = raw as OpenAiChatStream;
        const wrapped: OpenAiChatStream = { controller: stream.controller, async *[Symbol.asyncIterator]() {
          let usage: unknown; let model = ''; let complete = false; let conflict = false;
          try {
            for await (const chunk of stream) {
              if (chunk.model) { if (model && model !== chunk.model) conflict = true; model = chunk.model; }
              if (chunk.usage) { if (usage && JSON.stringify(usage) !== JSON.stringify(chunk.usage)) conflict = true; usage = chunk.usage; }
              attempt.outputChars += outputCharsOf((chunk as { choices?: unknown }).choices, 'delta');
              yield chunk;
            }
            complete = true;
          } finally { await finish(attempt, model, usage, complete && !conflict); }
        } };
        return wrapped;
      }
      attempt.outputChars += outputCharsOf((raw as { choices?: unknown }).choices, 'message');
      await finish(attempt, raw.model ?? '', raw.usage, true);
      return raw;
    } catch (error) { await finish(attempt, '', undefined, false, { error, signalAborted: !!options?.signal?.aborted }); throw error; }
  } } } };
}
/** An exact receipt attaches as before. An ESTIMATED receipt also carries its estimated token counts onto
 * the turn's usage, because billing only accepts a receipt whose tokens equal the ledger entry's — an
 * estimate exists precisely where the runner's own counts were missing or incomplete. */
function attachRouterOneReceipt(usage: TurnUsageLike, receipt: RouterOneCatalogueReceipt): void {
  usage.routerOneReceipt = receipt;
  if (receipt.kind !== 'catalogue-estimated') return;
  usage.inputTokens = receipt.inputTokens;
  usage.outputTokens = receipt.outputTokens;
  usage.cacheReadInputTokens = receipt.cacheReadTokens ?? 0;
}
type TurnUsageLike = { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number; routerOneReceipt?: RouterOneCatalogueReceipt };
/** Attach only issued evidence. On incomplete streams the outer runner finalizer fences
 * the key even when its stream reader exits without closing the iterator.
 */
export function cataloguePricedRouterOneRunner(inner: TurnRunner): TurnRunner {
  return { ...inner, async runTurn(params) {
    return turns.run({ attempts: [] }, async () => {
      try {
        const result = await inner.runTurn(params);
        const attempts = turns.getStore()!.attempts;
        for (const attempt of attempts) if (!attempt.done) await finish(attempt, '', undefined, false);
        if (attempts.length === 1 && attempts[0].receipt) attachRouterOneReceipt(result.usage, attempts[0].receipt);
        return result;
      } catch (error) {
        const attempts = turns.getStore()!.attempts;
        const abandoned = abandonedTurnUsage(error);
        if (abandoned && attempts.length === 1 && attempts[0].receipt) attachRouterOneReceipt(abandoned.usage, attempts[0].receipt);
        throw error;
      } finally {
        for (const attempt of turns.getStore()!.attempts) if (!attempt.done) await finish(attempt, '', undefined, false);
      }
    });
  } };
}
/** Scope classifiers use the same physical-dispatch accounting without an extra model call. */
export async function cataloguePricedRouterOneText<T>(fn: () => Promise<T>): Promise<T> {
  return turns.run({ attempts: [] }, async () => {
    try { return await fn(); }
    finally { for (const attempt of turns.getStore()!.attempts) if (!attempt.done) await finish(attempt, '', undefined, false); }
  });
}

export function routerOneCatalogueEntryCost(entry: { model?: string; routerOneReceipt?: RouterOneCatalogueReceipt;
  routerOneAccountingConflict?: boolean; usage: { inputTokens: number; outputTokens: number } }): number {
  const receipt = entry.routerOneReceipt;
  if (entry.routerOneAccountingConflict || !isRouterOneCatalogueReceipt(receipt) || receipt.model !== entry.model
    || receipt.inputTokens !== entry.usage.inputTokens || receipt.outputTokens !== entry.usage.outputTokens) throw new RouterOneAccountingUnavailableError('receipt_mismatch');
  return Number(BigInt(receipt.costAttoUsd)) / 1e18;
}
/** Exact addition before the existing wallet number/currency boundary. */
export function routerOneCatalogueBuildCharges(entries: Array<{ model?: string; routerOneReceipt?: RouterOneCatalogueReceipt;
  routerOneAccountingConflict?: boolean; usage: { inputTokens: number; outputTokens: number }; unbilled?: unknown; phase?: string }>, barren: ReadonlySet<string>) {
  let total = 0n, billable = 0n, estTotal = 0n, estBillable = 0n, estCalls = 0; const seen = new Set<string>();
  for (const entry of entries) {
    try { routerOneCatalogueEntryCost(entry); } catch { continue; }
    const receipt = entry.routerOneReceipt!;
    if (seen.has(receipt.callId)) continue; // one charge per physical call, exact or estimated
    seen.add(receipt.callId);
    const cost = BigInt(receipt.costAttoUsd); total += cost;
    const billed = !entry.unbilled && !(entry.phase && barren.has(entry.phase));
    if (billed) billable += cost;
    // A zero estimate (no billable response) is not an estimated charge: no label for it.
    if (receipt.kind === 'catalogue-estimated' && cost > 0n) { estCalls++; estTotal += cost; if (billed) estBillable += cost; }
  }
  // Same markup as the verified path (× 5/2). The `estimated` block is present ONLY when an estimate was
  // used, so a build of verified receipts returns exactly the shape it always did.
  return { costUsd: Number(total) / 1e18, billedUsd: Number(billable * 5n / 2n) / 1e18, absorbedUsd: Number(total - billable) / 1e18,
    ...(estCalls ? { estimated: { calls: estCalls, costUsd: Number(estTotal) / 1e18, billedUsd: Number(estBillable * 5n / 2n) / 1e18,
      label: ROUTER_ONE_ESTIMATED_BILL_LABEL } } : {}) };
}
/** The billing label for any Router One portion priced by estimate. */
/** User-visible (report message): neutral, no supplier, no pricing mechanics. Markup stays admin-only. */
export const ROUTER_ONE_ESTIMATED_BILL_LABEL = 'This step\'s cost was estimated because the engine did not return a full usage receipt.';

/** Keep accounting branches outside the bounded chat handler. */
export function recordRouterOneScopeUsage(ledger: Pick<import('../../AgentV3/ProviderUsageLedger').ProviderUsageLedger, 'add'>): void {
  for (const receipt of currentRouterOneCatalogueReceipts()) ledger.add('ENGINE_R1', {
    inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens,
    cacheReadInputTokens: receipt.cacheReadTokens ?? 0, routerOneReceipt: receipt,
  }, receipt.model);
}
export function routerOneCostUnconfirmed(provider: string, receipt: unknown): boolean {
  return isRouterOneAccountingProvider(provider) && !isRouterOneCatalogueReceipt(receipt);
}

/** Owner 2026-11-15 (BR2388): the build report names any Router One share priced by estimate. Our own
 *  cost rides an `[engine-diag: …]` marker, which the user's report strips (userFacingReport). */
export function recordRouterOneEstimatedBill(diag: { record(issue: { phase: 'build'; severity: 'info'; code: string; autoResolved: boolean; message: string; detail: string }): unknown },
  estimated: { calls: number; costUsd: number; billedUsd: number; label: string } | undefined): void {
  if (!estimated) return;
  try {
    diag.record({ phase: 'build', severity: 'info', code: 'ENGINE_COST_ESTIMATED', autoResolved: true,
      message: estimated.label,
      // Admin-only (stripped from the user's report): published tariff, same × 5/2 markup as verified usage.
      detail: `[engine-diag: estimated_calls=${estimated.calls} estimated_cost_usd=${estimated.costUsd.toFixed(6)} estimated_bill_usd=${estimated.billedUsd.toFixed(6)} pricing=published_tariff markup=same_as_verified_x5_2]` });
  } catch { /* diagnostics are best-effort */ }
}
