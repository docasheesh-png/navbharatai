import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { abandonedTurnUsage } from '../../AgentV3/unbilledTurns';
import type { TurnRunner } from '../../AgentV3/ClaudeClient';
import type { OpenAiChatClient, OpenAiChatStream } from '../../AgentV3/providers/OpenAiToolRunner';
import { audit } from '../../lib/audit';
import { getServerDb } from '../../lib/serverDb';
import { calculateCatalogueChatCost, catalogueSnapshotIssue } from './catalogueMath';
import { RouterOnePublicPriceSource, routerOnePublicPrices, ROUTER_ONE_PRICE_MAX_AGE_MS, type PublicPriceSnapshot } from './publicPriceSource';
import { RouterOneAccountingUnavailableError } from './accounting';

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
  reserve(binding: CatalogueCallBinding, callId: string, credentialSha256: string, snapshot: PublicPriceSnapshot): Promise<void>;
  finish(callId: string, credentialSha256: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void>;
}
/** One outstanding request per key across workers. A crash or ambiguous response leaves
 * the key blocked; only an explicit future reconciliation can reopen it. No automatic refunds.
 */
export class FirestoreCatalogueAttemptStore implements CatalogueAttemptStore {
  constructor(private readonly db: Pick<Firestore, 'doc' | 'runTransaction'>) {}
  async reserve(binding: CatalogueCallBinding, callId: string, key: string, snapshot: PublicPriceSnapshot): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`);
    const attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state);
      if (previous.exists && (previous.data()?.pending !== false || previous.data()?.inflight !== null)) throw new RouterOneAccountingUnavailableError();
      tx.create(attempt, { ...binding, callId, credentialSha256: key, snapshot, status: 'reserved', createdAt: Date.now() });
      tx.set(state, { inflight: callId, pending: false });
    });
  }
  async finish(callId: string, key: string, result: RouterOneCatalogueReceipt | { kind: 'pending'; reason: string; requestId: string | null }): Promise<void> {
    const state = this.db.doc(`router_one_accounting_keys/${key}`), attempt = this.db.doc(`router_one_catalogue_attempts/${callId}`);
    await this.db.runTransaction(async tx => {
      const previous = await tx.get(state);
      if (previous.data()?.inflight !== callId) throw new RouterOneAccountingUnavailableError();
      tx.update(attempt, { status: result.kind, result, completedAt: Date.now() });
      tx.set(state, { inflight: null, pending: result.kind === 'pending', lastCallId: callId });
    });
  }
}
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
export function bindRouterOneAccountingScope(binding: CatalogueCallBinding): void {
  const scope = scopes.getStore();
  if (!scope || scope.binding || !binding.uid || !binding.buildId || !binding.workspaceId) return;
  scope.binding = Object.freeze({ ...binding });
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
    // Reserved durable state fences the key even if final persistence fails. Preserve returned work.
    attempt.scope.stopped = true;
  }
}
export interface RouterOneAccountingDependencies {
  prices?: Pick<RouterOnePublicPriceSource, 'snapshot'>;
  store?: CatalogueAttemptStore;
  now?: () => number;
}
/** Wrap each physical SDK request, not a logical retry. No credentials are persisted. */
export function cataloguePricedRouterOneClient(client: OpenAiChatClient, key: string,
  deps: RouterOneAccountingDependencies = {}): OpenAiChatClient {
  return { chat: { completions: { create: async (request, options) => {
    const scope = scopes.getStore(), turn = turns.getStore();
    if (!scope?.binding || scope.stopped || !turn || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError();
    if (!key.trim() || !Number.isSafeInteger(request.max_tokens) || request.max_tokens! <= 0 || request.max_tokens! > 65536) throw new RouterOneAccountingUnavailableError();
    const fetched = await (deps.prices ?? routerOnePublicPrices).snapshot(request.model);
    const snapshot: PublicPriceSnapshot = Object.freeze({ ...fetched, bands: Object.freeze(fetched.bands.map(b => Object.freeze({ ...b }))) });
    if (snapshot.model !== request.model || catalogueSnapshotIssue(snapshot, (deps.now ?? Date.now)(), ROUTER_ONE_PRICE_MAX_AGE_MS)
      || snapshot.parserVersion !== 'router-one-product-jsonld-v1' || !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256)) throw new RouterOneAccountingUnavailableError();
    const db = deps.store ? undefined : getServerDb();
    const store = deps.store ?? (db ? new FirestoreCatalogueAttemptStore(db) : undefined);
    if (!store || scope.stopped || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError();
    const attempt: Attempt = { callId: randomUUID(), key: createHash('sha256').update(key).digest('hex'), snapshot,
      scope, store, requestId: null, done: false };
    await store.reserve(scope.binding, attempt.callId, attempt.key, snapshot);
    turn.attempts.push(attempt);
    try {
      if (scope.stopped || options?.signal?.aborted) throw new RouterOneAccountingUnavailableError();
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
