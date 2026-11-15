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
import { calculateCatalogueChatCost, catalogueSnapshotIssue } from './catalogueMath';
import { RouterOnePublicPriceSource, routerOnePublicPrices, ROUTER_ONE_PRICE_MAX_AGE_MS, type PublicPriceSnapshot } from './publicPriceSource';
import { isRouterOneAccountingProvider, RouterOneAccountingUnavailableError } from './accounting';

export interface CatalogueCallBinding { buildId: string; uid: string; workspaceId: string }
export interface RouterOneCatalogueReceipt extends CatalogueCallBinding {
  kind: 'catalogue-calculated'; expenseEvidence: 'official-public-tariff'; settledWalletDebit: false;
  callId: string; model: string; credentialSha256: string; requestId: string | null;
  costAttoUsd: string; modelSubtotalAttoUsd: string; inputTokens: number; outputTokens: number;
  cacheReadTokens: number | null; snapshot: PublicPriceSnapshot;
}
const issued = new WeakSet<object>();
export function isRouterOneCatalogueReceipt(v: unknown): v is RouterOneCatalogueReceipt {
  return !!v && typeof v === 'object' && issued.has(v);
}
export interface CatalogueAttemptStore {
  reserve(binding: CatalogueCallBinding, callId: string, credentialSha256: string, snapshot: PublicPriceSnapshot, deadlineAt: number): Promise<void>;
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
    || Object.values(v.unresolved).some(t => t !== true)) throw new RouterOneAccountingUnavailableError();
  return { version: 2, active: { ...v.active }, unresolved: { ...v.unresolved } };
}
export class FirestoreCatalogueAttemptStore implements CatalogueAttemptStore {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>, private readonly now = Date.now) {}
  async reserve(binding: CatalogueCallBinding, callId: string, key: string, snapshot: PublicPriceSnapshot, deadlineAt: number): Promise<void> {
    if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= this.now()) throw new RouterOneAccountingUnavailableError();
    const state = this.db.doc(`router_one_accounting_keys/${key}`);
    const attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    const admitted = await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), next = keyState(previous.exists ? previous.data() : undefined);
      for (const [id, deadline] of Object.entries(next.active)) if (deadline <= this.now()) next.unresolved[id] = true;
      if (Object.keys(next.unresolved).length) { tx.set(state, next); return false; }
      if (next.active[callId]) throw new RouterOneAccountingUnavailableError();
      next.active[callId] = deadlineAt;
      tx.create(attempt, { ...binding, callId, credentialSha256: key, snapshot, status: 'reserved', createdAt: this.now(), deadlineAt });
      tx.set(state, next); return true;
    });
    if (!admitted) throw new RouterOneAccountingUnavailableError();
  }
  async finish(callId: string, key: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`), attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state), row = await tx.get(attempt);
      const next = keyState(previous.exists ? previous.data() : undefined);
      if (!next.active[callId] || row.data()?.status !== 'reserved') throw new RouterOneAccountingUnavailableError();
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
      if (!next.active[callId] || !next.unresolved[callId] || row.data()?.status !== 'catalogue-calculated') throw new RouterOneAccountingUnavailableError();
      delete next.active[callId]; delete next.unresolved[callId];
      tx.set(state, next);
    });
  }
}
/** Never evict an unresolved hold to admit more spending. Saturation fences this
 * worker's Router One dispatches until restart; durable attempt deadlines still apply. */
export function createRouterOneUncertainFence(maxKeys = 64) {
  const keys = new BoundedCache<string, true>({ maxEntries: maxKeys });
  let saturated = false;
  return {
    has: (key: string): boolean => saturated || keys.has(key),
    add(key: string): void {
      if (keys.has(key) || saturated) return;
      if (keys.size >= keys.maxEntries) { saturated = true; return; }
      keys.set(key, true);
    },
  };
}
const uncertainKeys = createRouterOneUncertainFence();
interface Scope { binding?: CatalogueCallBinding; stopped: boolean; receipts: RouterOneCatalogueReceipt[] }
interface Attempt {
  callId: string; key: string; snapshot: PublicPriceSnapshot; scope: Scope; store: CatalogueAttemptStore;
  requestId: string | null; done: boolean; receipt?: RouterOneCatalogueReceipt;
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
export function recordRouterOneRequestId(requestId: string | null): void {
  const attempt = dispatches.getStore(); if (attempt) attempt.requestId = requestId;
}
/** Injectable scope for non-network regression tests; no trust in HTTP body fields. */
export function runInRouterOneAccountingScope<T>(binding: CatalogueCallBinding, fn: () => T): T {
  return scopes.run({ binding: Object.freeze({ ...binding }), stopped: false, receipts: [] }, fn);
}
export function currentRouterOneCatalogueReceipts(): readonly RouterOneCatalogueReceipt[] { return scopes.getStore()?.receipts.slice() ?? []; }
async function finish(attempt: Attempt, model: string, usage: unknown, complete: boolean): Promise<void> {
  if (attempt.done) return;
  attempt.done = true;
  const calculated = calculateCatalogueChatCost(attempt.snapshot, model, usage, complete,
    attempt.snapshot.fetchedAt, ROUTER_ONE_PRICE_MAX_AGE_MS);
  // Snapshot freshness is checked at dispatch, not after a long successful response.
  const receipt: RouterOneCatalogueReceipt | undefined = calculated.kind === 'catalogue-calculated' ? Object.freeze({
    ...attempt.scope.binding!, kind: 'catalogue-calculated', expenseEvidence: 'official-public-tariff', settledWalletDebit: false,
    callId: attempt.callId, credentialSha256: attempt.key, model, requestId: attempt.requestId,
    costAttoUsd: calculated.costAttoUsd, modelSubtotalAttoUsd: calculated.modelSubtotalAttoUsd,
    inputTokens: calculated.inputTokens, outputTokens: calculated.outputTokens, cacheReadTokens: calculated.cacheReadTokens,
    snapshot: attempt.snapshot,
  }) : undefined;
  try {
    await attempt.store.finish(attempt.callId, attempt.key, receipt ?? { kind: 'pending',
      reason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage', requestId: attempt.requestId });
    if (receipt) {
      issued.add(receipt); attempt.receipt = receipt; attempt.scope.receipts.push(receipt);
      // A release failure cannot revoke acknowledged, billable evidence or replay output.
      try { await attempt.store.releaseVerified(attempt.callId, attempt.key); }
      catch { attempt.scope.stopped = true; uncertainKeys.add(attempt.key); }
      try { audit('ROUTER_ONE_CATALOGUE_PRICED', { buildId: receipt.buildId, callId: receipt.callId,
        model: receipt.model, expenseEvidence: receipt.expenseEvidence, settledWalletDebit: false,
        costAttoUsd: receipt.costAttoUsd, modelSubtotalAttoUsd: receipt.modelSubtotalAttoUsd,
        source: receipt.snapshot.source, sourceSha256: receipt.snapshot.sourceSha256 }); } catch { /* observation only */ }
    }
    else {
      attempt.scope.stopped = true;
      try { audit('ROUTER_ONE_ACCOUNTING_PENDING', { buildId: attempt.scope.binding?.buildId,
        callId: attempt.callId, reason: calculated.kind === 'pending' ? calculated.reason : 'incomplete-usage', furtherDispatchBlocked: true }); } catch { /* observation only */ }
    }
  } catch {
    uncertainKeys.add(attempt.key);
    // Stop this worker immediately. Across workers, a failed write remains fenced by its persisted deadline.
    attempt.scope.stopped = true;
  }
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
    if (!scope?.binding) throw new RouterOneAccountingUnavailableError('no-accounting-scope');
    if (scope.stopped) throw new RouterOneAccountingUnavailableError('scope-stopped-after-pending-attempt');
    if (!turn) throw new RouterOneAccountingUnavailableError('no-turn-scope');
    if (options?.signal?.aborted) throw new RouterOneAccountingUnavailableError('aborted');
    if (!key.trim()) throw new RouterOneAccountingUnavailableError('no-api-key');
    if (!Number.isSafeInteger(request.max_tokens) || request.max_tokens! <= 0 || request.max_tokens! > 65536) throw new RouterOneAccountingUnavailableError('max-tokens-out-of-range');
    const fetched = await (deps.prices ?? routerOnePublicPrices).snapshot(request.model);
    const snapshot: PublicPriceSnapshot = Object.freeze({ ...fetched, bands: Object.freeze(fetched.bands.map(b => Object.freeze({ ...b }))) });
    if (snapshot.model !== request.model || catalogueSnapshotIssue(snapshot, (deps.now ?? Date.now)(), ROUTER_ONE_PRICE_MAX_AGE_MS)
      || snapshot.parserVersion !== 'router-one-product-jsonld-v1' || !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256)) throw new RouterOneAccountingUnavailableError('price-snapshot-invalid-or-stale');
    const db = deps.store ? undefined : getServerDb();
    const store = deps.store ?? (db ? new FirestoreCatalogueAttemptStore(db) : undefined);
    if (!store) throw new RouterOneAccountingUnavailableError('no-attempt-store');
    if (scope.stopped || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError('stopped-or-aborted');
    const attempt: Attempt = { callId: randomUUID(), key: createHash('sha256').update(key).digest('hex'), snapshot,
      scope, store, requestId: null, done: false };
    if (uncertainKeys.has(attempt.key)) throw new RouterOneAccountingUnavailableError('key-fenced-by-earlier-uncertain-attempt');
    if (!Number.isSafeInteger(deps.maxDurationMs) || deps.maxDurationMs <= 0) throw new RouterOneAccountingUnavailableError('bad-max-duration');
    await store.reserve(scope.binding, attempt.callId, attempt.key, snapshot, (deps.now ?? Date.now)() + deps.maxDurationMs);
    turn.attempts.push(attempt);
    try {
      if (scope.stopped || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError('stopped-or-aborted-before-dispatch');
      const raw = await dispatches.run(attempt, () => client.chat.completions.create(request, options));
      if (Symbol.asyncIterator in raw) {
        const stream = raw as OpenAiChatStream;
        const wrapped: OpenAiChatStream = { controller: stream.controller, async *[Symbol.asyncIterator]() {
          let usage: unknown; let model = ''; let complete = false; let conflict = false;
          try {
            for await (const chunk of stream) {
              if (chunk.model) { if (model && model !== chunk.model) conflict = true; model = chunk.model; }
              if (chunk.usage) { if (usage && JSON.stringify(usage) !== JSON.stringify(chunk.usage)) conflict = true; usage = chunk.usage; }
              yield chunk;
            }
            complete = true;
          } finally { await finish(attempt, model, usage, complete && !conflict); }
        } };
        return wrapped;
      }
      await finish(attempt, raw.model ?? '', raw.usage, true);
      return raw;
    } catch (error) { await finish(attempt, '', undefined, false); throw error; }
  } } } };
}
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
        if (attempts.length === 1 && attempts[0].receipt) result.usage.routerOneReceipt = attempts[0].receipt;
        return result;
      } catch (error) {
        const attempts = turns.getStore()!.attempts;
        const abandoned = abandonedTurnUsage(error);
        if (abandoned && attempts.length === 1 && attempts[0].receipt) abandoned.usage.routerOneReceipt = attempts[0].receipt;
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
    || receipt.inputTokens !== entry.usage.inputTokens || receipt.outputTokens !== entry.usage.outputTokens) throw new RouterOneAccountingUnavailableError();
  return Number(BigInt(receipt.costAttoUsd)) / 1e18;
}
/** Exact addition before the existing wallet number/currency boundary. */
export function routerOneCatalogueBuildCharges(entries: Array<{ model?: string; routerOneReceipt?: RouterOneCatalogueReceipt;
  routerOneAccountingConflict?: boolean; usage: { inputTokens: number; outputTokens: number }; unbilled?: unknown; phase?: string }>, barren: ReadonlySet<string>) {
  let total = 0n, billable = 0n; const seen = new Set<string>();
  for (const entry of entries) {
    try { routerOneCatalogueEntryCost(entry); } catch { continue; }
    const receipt = entry.routerOneReceipt!;
    if (seen.has(receipt.callId)) continue;
    seen.add(receipt.callId);
    const cost = BigInt(receipt.costAttoUsd); total += cost;
    if (!entry.unbilled && !(entry.phase && barren.has(entry.phase))) billable += cost;
  }
  return { costUsd: Number(total) / 1e18, billedUsd: Number(billable * 5n / 2n) / 1e18, absorbedUsd: Number(total - billable) / 1e18 };
}

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
