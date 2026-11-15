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
import { calculateCatalogueChatCost, catalogueSnapshotIssue, catalogueUsageIntegrityIssue, type CatalogueEstimateBasis } from './catalogueMath';
import { estimateMessagesTokens, estimateTokens } from '../../AgentV3/TokenEstimator';
import { RouterOnePublicPriceSource, routerOnePublicPrices, ROUTER_ONE_PRICE_MAX_AGE_MS, type PublicPriceSnapshot } from './publicPriceSource';
import { isRouterOneAccountingProvider, RouterOneAccountingUnavailableError, routerOneAccountingGate } from './accounting';
import { markRestOfBuildSkip } from '../../lib/engineSafeDiag';

export interface CatalogueCallBinding { buildId: string; uid: string; workspaceId: string }
export interface RouterOneCatalogueReceipt extends CatalogueCallBinding {
  /** Complete usage is priced exactly. The estimate variant is retained as an inactive
   * compatibility shape; this conservative adapter does not issue or bill it. */
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
    const admitted = await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), next = keyState(previous.exists ? previous.data() : undefined);
      for (const [id, deadline] of Object.entries(next.active)) if (deadline <= this.now()) next.unresolved[id] = true;
      // Timeout is not evidence of settled supplier expense or terminated execution.
      // Preserve original rows and correlation IDs; late finish remains possible.
      if (Object.keys(next.unresolved).length) { tx.set(state, next); return false; }
      if (next.active[callId]) throw new RouterOneAccountingUnavailableError('reserve_duplicate');
      next.active[callId] = deadlineAt;
      tx.create(attempt, { ...binding, callId, credentialSha256: key, snapshot, status: 'reserved', createdAt: this.now(), deadlineAt,
        ...(Number.isSafeInteger(requestInputTokens) && (requestInputTokens as number) >= 0 ? { requestInputTokens } : {}) });
      tx.set(state, next); return true;
    });
    if (!admitted) throw new RouterOneAccountingUnavailableError('reserve_fenced_unresolved');
  }
  async finish(callId: string, key: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`), attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), row = await tx.get(attempt);
      const next = keyState(previous.exists ? previous.data() : undefined);
      if (!next.active[callId] || row.data()?.credentialSha256 !== key || row.data()?.status !== 'reserved') throw new RouterOneAccountingUnavailableError('finish_state');
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
      const settled = row.data()?.status === 'catalogue-calculated' && row.data()?.credentialSha256 === key;
      // Lost release acknowledgements can retry a verified exact release without reopening unknown cost.
      if (settled && !next.active[callId] && !next.unresolved[callId]) return;
      if (!next.active[callId] || !next.unresolved[callId] || !settled) throw new RouterOneAccountingUnavailableError('release_state');
      delete next.active[callId]; delete next.unresolved[callId];
      tx.set(state, next);
    });
  }
}
/** Bounded worker-local backoff; expiry never authorizes spending because durable unresolved
 * attempts stay fenced. Saturation with live holds fails closed. */
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
  requestId: string | null; done: boolean; receipt?: RouterOneCatalogueReceipt; settlement?: Promise<void>;
  /** Observational request size, received output, HTTP status and deadline; not billing authority. */
  requestInputTokens: number; outputChars: number; httpStatus: number | null; deadlineAt: number;
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
function finish(attempt: Attempt, model: string, usage: unknown, complete: boolean, conflictingStream = false): Promise<void> {
  // All finalizers await the same persistence attempt; none observes "done" before acknowledgement.
  // A failed/uncertain write stops the scope and remains durably fenced, not automatically replayed.
  if (attempt.settlement) return attempt.settlement;
  attempt.settlement = settleAttempt(attempt, model, usage, complete, conflictingStream).finally(() => { attempt.done = true; });
  return attempt.settlement;
}
async function settleAttempt(attempt: Attempt, model: string, usage: unknown, complete: boolean, conflictingStream: boolean): Promise<void> {
  const invalidEvidence = conflictingStream || (!!model && model !== attempt.snapshot.model) || catalogueUsageIntegrityIssue(usage);
  const calculated = invalidEvidence ? { kind: 'pending' as const, reason: 'invalid-accounting-evidence' } : calculateCatalogueChatCost(attempt.snapshot, model, usage, complete,
    attempt.snapshot.fetchedAt, ROUTER_ONE_PRICE_MAX_AGE_MS);
  // Snapshot freshness is checked at dispatch, not after a long successful response.
  const receipt: RouterOneCatalogueReceipt | undefined = calculated.kind === 'catalogue-calculated' ? Object.freeze({
    ...attempt.scope.binding!, kind: 'catalogue-calculated', expenseEvidence: 'official-public-tariff', settledWalletDebit: false,
    callId: attempt.callId, credentialSha256: attempt.key, model, requestId: attempt.requestId,
    costAttoUsd: calculated.costAttoUsd, modelSubtotalAttoUsd: calculated.modelSubtotalAttoUsd,
    inputTokens: calculated.inputTokens, outputTokens: calculated.outputTokens, cacheReadTokens: calculated.cacheReadTokens,
    snapshot: attempt.snapshot,
  }) as RouterOneCatalogueReceipt : undefined;
  // Estimated customer billing is not enabled by this repair. Unknown expense stays pending;
  // integrity failure is not missing evidence, and neither authorizes charging or timed release.
  try {
    await attempt.store.finish(attempt.callId, attempt.key, receipt ?? { kind: 'pending',
      reason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage', requestId: attempt.requestId });
    if (receipt) {
      issued.add(receipt); attempt.receipt = receipt; attempt.scope.receipts.push(receipt);
      // A release failure cannot revoke acknowledged, billable evidence or replay output.
      try { await attempt.store.releaseVerified(attempt.callId, attempt.key); }
      catch { attempt.scope.stopped = true; uncertainKeys.add(attempt.key, attempt.deadlineAt); }
      try { audit(receipt.kind === 'catalogue-estimated' ? 'ROUTER_ONE_CATALOGUE_ESTIMATED' : 'ROUTER_ONE_CATALOGUE_PRICED', { buildId: receipt.buildId, callId: receipt.callId,
        model: receipt.model, expenseEvidence: receipt.expenseEvidence, settledWalletDebit: false,
        costAttoUsd: receipt.costAttoUsd, modelSubtotalAttoUsd: receipt.modelSubtotalAttoUsd,
        source: receipt.snapshot.source, sourceSha256: receipt.snapshot.sourceSha256,
        ...(receipt.kind === 'catalogue-estimated' ? { estimated: true, estimateBasis: receipt.estimateBasis, estimateLabel: receipt.estimateLabel, pendingReason: receipt.pendingReason } : {}) }); } catch { /* observation only */ }
    }
    else {
      attempt.scope.stopped = true;
      try { audit('ROUTER_ONE_ACCOUNTING_PENDING', { buildId: attempt.scope.binding?.buildId,
        callId: attempt.callId, reason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage', furtherDispatchBlocked: true }); } catch { /* observation only */ }
    }
  } catch {
    // The write is uncertain: fence this key on this worker until the call's own deadline. After it, the
    // durable store still requires verified reconciliation; local expiry cannot release its fence.
    uncertainKeys.add(attempt.key, attempt.deadlineAt);
    attempt.scope.stopped = true;
  }
}
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
          } finally { await finish(attempt, model, usage, complete && !conflict, conflict); }
        } };
        return wrapped;
      }
      attempt.outputChars += outputCharsOf((raw as { choices?: unknown }).choices, 'message');
      await finish(attempt, raw.model ?? '', raw.usage, true);
      return raw;
    } catch (error) { await finish(attempt, '', undefined, false); throw error; }
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
  if (entry.routerOneAccountingConflict || !isRouterOneCatalogueReceipt(receipt) || receipt.kind !== 'catalogue-calculated' || receipt.model !== entry.model
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
    if (receipt.kind === 'catalogue-estimated') { estCalls++; estTotal += cost; if (billed) estBillable += cost; }
  }
  // Same markup as the verified path (× 5/2). The `estimated` block is present ONLY when an estimate was
  // used, so a build of verified receipts returns exactly the shape it always did.
  return { costUsd: Number(total) / 1e18, billedUsd: Number(billable * 5n / 2n) / 1e18, absorbedUsd: Number(total - billable) / 1e18,
    ...(estCalls ? { estimated: { calls: estCalls, costUsd: Number(estTotal) / 1e18, billedUsd: Number(estBillable * 5n / 2n) / 1e18,
      label: ROUTER_ONE_ESTIMATED_BILL_LABEL } } : {}) };
}
/** The billing label for any Router One portion priced by estimate. */
export const ROUTER_ONE_ESTIMATED_BILL_LABEL = 'Estimated: part of this engine usage had no complete usage receipt, so it is priced from the published per-model tariff (see each call\'s estimate basis), with the same markup as verified usage.';

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

/** Inactive estimate-report compatibility helper, not authorization to charge estimates. Our own
 *  cost rides an `[engine-diag: …]` marker, which the user's report strips (userFacingReport). */
export function recordRouterOneEstimatedBill(diag: { record(issue: { phase: 'build'; severity: 'info'; code: string; autoResolved: boolean; message: string; detail: string }): unknown },
  estimated: { calls: number; costUsd: number; billedUsd: number; label: string } | undefined): void {
  if (!estimated) return;
  try {
    diag.record({ phase: 'build', severity: 'info', code: 'ENGINE_COST_ESTIMATED', autoResolved: true,
      message: estimated.label,
      detail: `[engine-diag: estimated_calls=${estimated.calls} estimated_cost_usd=${estimated.costUsd.toFixed(6)} estimated_bill_usd=${estimated.billedUsd.toFixed(6)}]` });
  } catch { /* diagnostics are best-effort */ }
}

