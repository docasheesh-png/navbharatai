/** Restricted pilot preparation only: no route, environment flag or client header activates this scope. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { checkedSandboxManifest, sandboxManifestHash, type CanarySandboxManifest } from './canarySandboxPolicy';
import { maximumCostNanoUsd } from '../../AI/FreeChain/spendCap';

const ENDPOINT = 'https://api.moonshot.ai/v1/chat/completions';
const MODEL = 'kimi-k2.7-code';
const INPUT_CONTEXT = 262_144;
const OUTPUT_LIMIT = 32_768;
const CAPABILITIES = new Set(['builder-OpenAiToolRunner', 'builder-review-judge', 'builder-scope-classifier', 'clarity-judge']);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export class CanarySpendBlocked extends Error {
  readonly code = 'BENCHMARK_CANARY_BLOCKED';
  constructor(readonly reason: string) { super('The restricted benchmark cannot continue safely. No new request was authorized.'); }
}
function demand(v: unknown, reason: string): asserts v { if (!v) throw new CanarySpendBlocked(reason); }
export interface CanaryBinding { uid: string; requestId: string; fixtureHash: string; tier: 'weak' }
/** Manually reviewed server-only authority, never copied from an HTTP request. No issuer ships here. */
export interface CanaryAuthority extends CanaryBinding {
  version: 1; enabled: true; expiresAtMs: number;
  sandboxManifestSha256?: string;
  accountCredentialSha256: string; tariffEvidence: string;
  inputPerMillionNanoUsd: number; outputPerMillionNanoUsd: number;
  maxPhysicalAttempts: number; maxApiPaise: number;
  /** Reviewed all-in conversion ceiling including applicable tax/fees, not a market-rate guess. */
  allInPaisePerUsdCeiling: number;
}
interface State { attempts: number; reservedNanoUsd: number; halted: boolean; authorityHash: string; executionId: string; totalBudgetPaise?: number }
type Db = Pick<Firestore, 'doc' | 'runTransaction'>;
export const canaryAuthorityPath = (id: string) => {
  demand(/^[a-zA-Z0-9_-]{1,100}$/.test(id), 'invalid-authority-id');
  return `benchmark_canary_authorities/${id}`;
};
function validateAuthority(value: unknown, binding: CanaryBinding, now: number): CanaryAuthority {
  const a = value as CanaryAuthority;
  demand(a && a.version === 1 && a.enabled === true && a.tier === 'weak', 'authority-unavailable');
  demand(a.uid === binding.uid && a.requestId === binding.requestId && a.fixtureHash === binding.fixtureHash && binding.tier === 'weak', 'scope-mismatch');
  demand(typeof a.uid === 'string' && !!a.uid && typeof a.requestId === 'string' && !!a.requestId && digest(a.fixtureHash), 'invalid-binding');
  demand(integer(a.expiresAtMs) && now < a.expiresAtMs, 'authority-expired');
  demand(digest(a.accountCredentialSha256) && typeof a.tariffEvidence === 'string' && a.tariffEvidence.trim(), 'account-tariff-unverified');
  // Published prices are a floor, NOT proof that this account has these prices.
  demand(integer(a.inputPerMillionNanoUsd) && a.inputPerMillionNanoUsd >= 950_000_000 && integer(a.outputPerMillionNanoUsd) && a.outputPerMillionNanoUsd >= 4_000_000_000, 'tariff-unbounded');
  demand(integer(a.maxPhysicalAttempts) && a.maxPhysicalAttempts > 0 && a.maxPhysicalAttempts <= 12, 'attempt-cap-invalid');
  demand(integer(a.maxApiPaise) && a.maxApiPaise > 0 && a.maxApiPaise <= 100_000 && integer(a.allInPaisePerUsdCeiling) && a.allInPaisePerUsdCeiling > 0, 'currency-bound-unverified');
  return a;
}
/** Persistent compare-and-reserve. Holds are NEVER refunded, even on a timeout, 4xx or crash. */
export class CanaryReservationStore {
  private readonly executionId = randomUUID();
  private poisoned = false;
  assertActive(): void { demand(!this.poisoned, 'execution-stopped'); }
  constructor(private readonly db: Db, private readonly now = Date.now) {}
  async reserve(id: string, binding: CanaryBinding, physicalId: string, credentialHash: string, outputTokens: number): Promise<void> {
    this.assertActive();
    try { await this.reserveInternal(id, binding, physicalId, credentialHash, outputTokens); }
    catch (error) { this.poisoned = true; throw error; }
  }
  private async reserveInternal(id: string, binding: CanaryBinding, physicalId: string, credentialHash: string, outputTokens: number): Promise<void> {
    demand(/^[a-zA-Z0-9_-]{1,100}$/.test(physicalId), 'invalid-physical-id');
    demand(integer(outputTokens) && outputTokens > 0 && outputTokens <= OUTPUT_LIMIT, 'output-unbounded');
    const path = canaryAuthorityPath(id);
    const authorityRef = this.db.doc(path), stateRef = this.db.doc(`${path}/ledger/total`), attemptRef = this.db.doc(`${path}/attempts/${physicalId}`);
    await this.db.runTransaction(async tx => {
      const authority = await tx.get(authorityRef), snapshot = await tx.get(stateRef), attempt = await tx.get(attemptRef);
      const a = validateAuthority(authority.data(), binding, this.now());
      demand(a.accountCredentialSha256 === credentialHash, 'credential-binding-mismatch');
      demand(!attempt.exists, 'duplicate-physical-dispatch');
      const authorityHash = sha(JSON.stringify(a, Object.keys(a).sort()));
      const state: State = snapshot.exists ? snapshot.data() as State : { attempts: 0, reservedNanoUsd: 0, halted: false, authorityHash, executionId: this.executionId };
      demand(state.authorityHash === authorityHash, 'authority-changed');
      // A crash/restart or another instance cannot resume outstanding reservations automatically.
      demand(state.executionId === this.executionId, 'execution-requires-reconciliation');
      demand(integer(state.attempts) && integer(state.reservedNanoUsd) && state.halted === false, 'ledger-unavailable-or-halted');
      const cost = maximumCostNanoUsd(INPUT_CONTEXT, outputTokens, a.inputPerMillionNanoUsd, a.outputPerMillionNanoUsd);
      const total = state.reservedNanoUsd + cost;
      demand(Number.isSafeInteger(total) && state.attempts < a.maxPhysicalAttempts, 'attempt-cap-reached');
      demand(state.totalBudgetPaise === undefined || integer(state.totalBudgetPaise), 'invalid-total-budget');
      const budget = Math.min(a.maxApiPaise, state.totalBudgetPaise ?? a.maxApiPaise);
      demand(BigInt(total) * BigInt(a.allInPaisePerUsdCeiling) <= BigInt(budget) * 1_000_000_000n, 'api-budget-exhausted');
      tx.set(stateRef, { ...state, attempts: state.attempts + 1, reservedNanoUsd: total, halted: false, authorityHash, executionId: this.executionId });
      tx.create(attemptRef, { reservedNanoUsd: cost, createdAtMs: this.now(), model: MODEL, status: 'reserved-unreconciled' });
    });
  }
  /** One create claim, sharing the SAME total ledger as all physical model requests. */
  async reserveSandbox(id: string, binding: CanaryBinding, credentialHash: string): Promise<CanarySandboxManifest> {
    this.assertActive();
    try {
      const path = canaryAuthorityPath(id);
      return await this.db.runTransaction(async tx => {
        const aSnap = await tx.get(this.db.doc(path));
        const mSnap = await tx.get(this.db.doc(`${path}/sandbox/manifest`));
        const stateRef = this.db.doc(`${path}/ledger/total`);
        const snapshot = await tx.get(stateRef);
        const a = validateAuthority(aSnap.data(), binding, this.now());
        const m = checkedSandboxManifest(mSnap.data(), binding, this.now());
        demand(a.sandboxManifestSha256 === sandboxManifestHash(m), 'sandbox-manifest-unbound');
        demand(m.expiresAtMs <= a.expiresAtMs, 'sandbox-outlives-authority');
        demand(m.credentialSha256 === credentialHash, 'sandbox-account-mismatch');
        const claimRef = this.db.doc(`benchmark_canary_workspaces/${m.workspaceId}`);
        const claim = await tx.get(claimRef);
        demand(!claim.exists, 'sandbox-create-already-claimed');
        const authorityHash = sha(JSON.stringify(a, Object.keys(a).sort()));
        const state: State = snapshot.exists ? snapshot.data() as State : { attempts: 0, reservedNanoUsd: 0, halted: false, authorityHash, executionId: this.executionId };
        demand(state.authorityHash === authorityHash && state.executionId === this.executionId, 'sandbox-execution-requires-reconciliation');
        demand(integer(state.attempts) && integer(state.reservedNanoUsd) && state.halted === false, 'ledger-unavailable-or-halted');
        const cost = m.nanoUsdPerBillableSecond * m.billableSecondsCeiling;
        const total = state.reservedNanoUsd + cost;
        demand(Number.isSafeInteger(total), 'sandbox-liability-overflow');
        demand(BigInt(total) * BigInt(a.allInPaisePerUsdCeiling) <= BigInt(Math.min(a.maxApiPaise, m.maxAllCostsPaise)) * 1_000_000_000n, 'sandbox-total-budget-exhausted');
        tx.set(stateRef, { ...state, reservedNanoUsd: total, totalBudgetPaise: Math.min(a.maxApiPaise, m.maxAllCostsPaise) });
        tx.create(claimRef, { authorityId: id, executionId: this.executionId, ...binding, expiresAtMs: m.expiresAtMs, reservedNanoUsd: cost, status: 'reserved-unreconciled' });
        return m;
      });
    } catch (error) { this.poisoned = true; throw error; }
  }
  /** Revalidate the durable lease before each tool; a different worker's halt cannot be ignored. */
  async assertSandboxLease(id: string, binding: CanaryBinding, manifest: CanarySandboxManifest): Promise<void> {
    this.assertActive();
    try {
      const path = canaryAuthorityPath(id);
      await this.db.runTransaction(async tx => {
        const authority = await tx.get(this.db.doc(path));
        const state = await tx.get(this.db.doc(`${path}/ledger/total`));
        const claim = await tx.get(this.db.doc(`benchmark_canary_workspaces/${manifest.workspaceId}`));
        const a = validateAuthority(authority.data(), binding, this.now());
        const ledger = state.data() as State | undefined;
        const lease = claim.data();
        demand(a.sandboxManifestSha256 === sandboxManifestHash(manifest), 'sandbox-manifest-changed');
        demand(ledger && ledger.halted === false && ledger.executionId === this.executionId && ledger.authorityHash === sha(JSON.stringify(a, Object.keys(a).sort())), 'sandbox-lease-halted');
        demand(lease && lease.authorityId === id && lease.executionId === this.executionId && lease.uid === binding.uid
          && lease.requestId === binding.requestId && lease.fixtureHash === binding.fixtureHash
          && lease.expiresAtMs === manifest.expiresAtMs && this.now() < manifest.expiresAtMs, 'sandbox-lease-expired-or-mismatched');
      });
    } catch (error) { this.poisoned = true; throw error; }
  }
  async halt(id: string): Promise<void> {
    this.poisoned = true;
    const ref = this.db.doc(`${canaryAuthorityPath(id)}/ledger/total`);
    await this.db.runTransaction(async tx => {
      const s = await tx.get(ref);
      // Never erase counters or manufacture an empty ledger after an uncertain commit.
      demand(s.exists, 'missing-ledger');
      tx.set(ref, { ...s.data(), halted: true });
    });
  }
}
interface Scope { id: string; binding: CanaryBinding; store: CanaryReservationStore; stopped: boolean }
const scopes = new AsyncLocalStorage<Scope>();
/** Server composition seam only. No production caller exists until activation is separately reviewed. */
export function runWithCanarySpendGuard<T>(id: string, binding: CanaryBinding, store: CanaryReservationStore, run: () => T): T {
  demand(!scopes.getStore(), 'nested-authority-replacement');
  canaryAuthorityPath(id);
  return scopes.run({ id, binding: Object.freeze({ ...binding }), store, stopped: false }, run);
}
export function assertCanaryLegacyAllowed(capability: string): void {
  if (scopes.getStore()) demand(CAPABILITIES.has(capability), `unbounded-capability:${capability}`);
}
function requestPayload(input: RequestInfo | URL, init?: RequestInit): { output: number; credentialHash: string } {
  const url = input instanceof Request ? input.url : String(input);
  demand(url === ENDPOINT && init?.method?.toUpperCase() === 'POST', 'unreviewed-endpoint');
  demand(typeof init.body === 'string' && Buffer.byteLength(init.body) <= 2_000_000, 'unsupported-request-body');
  const body = JSON.parse(init.body) as Record<string, unknown>;
  const allowed = new Set(['model', 'messages', 'tools', 'tool_choice', 'parallel_tool_calls', 'max_tokens', 'temperature', 'top_p', 'stream', 'stream_options', 'stop']);
  demand(Object.keys(body).every(k => allowed.has(k)) && body.model === MODEL, 'unreviewed-model-or-parameter');
  demand(integer(body.max_tokens) && body.max_tokens > 0 && body.max_tokens <= OUTPUT_LIMIT, 'output-unbounded');
  demand(Array.isArray(body.messages) && body.messages.length > 0, 'missing-messages');
  // Reject multimodal/provider-hosted tools; function tools consume only the already reserved text budget.
  demand(body.messages.every(m => m && typeof m === 'object' && (typeof m.content === 'string' || m.content === null || m.content === undefined) && !('audio' in m)), 'non-text-payload');
  demand(body.tools === undefined || Array.isArray(body.tools) && body.tools.every(t => t && t.type === 'function'), 'unbounded-provider-tool');
  const authorization = new Headers(init.headers).get('authorization');
  demand(authorization && /^Bearer \S+$/.test(authorization), 'missing-account-binding');
  return { output: body.max_tokens, credentialHash: sha(authorization) };
}
/** Installed on SDK factories, evaluated at each physical HTTP attempt, even for cached clients. */
export function canaryFetch(transport: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const scope = scopes.getStore();
    if (!scope) return transport(input, init);
    demand(!scope.stopped, 'canary-stopped');
    scope.store.assertActive();
    // Bind the reservation to immutable wire values before the first async boundary.
    const wireUrl = input instanceof Request ? input.url : String(input);
    const wireInit = { ...init, headers: new Headers(init?.headers) };
    const payload = requestPayload(wireUrl, wireInit);
    try {
      await scope.store.reserve(scope.id, scope.binding, randomUUID(), payload.credentialHash, payload.output);
    } catch (error) { scope.stopped = true; throw error; }
    const stop = async () => { scope.stopped = true; await scope.store.halt(scope.id); };
    const signal = wireInit.signal;
    const onAbort = () => { void stop().catch(() => { /* Local poison remains; no new dispatch is permitted. */ }); };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      demand(!scope.stopped && !signal?.aborted, 'canary-stopped-before-dispatch');
      scope.store.assertActive();
      const response = await transport(wireUrl, { ...wireInit, redirect: 'error' });
      if (!response.ok) { cleanup(); await stop(); return response; }
      if (!response.body) { await stop(); throw new CanarySpendBlocked('missing-response-body'); }
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) { cleanup(); controller.close(); } else controller.enqueue(chunk.value);
          } catch (error) { cleanup(); try { await stop(); } finally { controller.error(error); } }
        },
        async cancel(reason) { cleanup(); try { await stop(); } finally { await reader.cancel(reason); } },
      });
      // Usage is not an invoice receipt. Every reservation remains unreconciled, including HTTP 200.
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { cleanup(); try { await stop(); } finally { throw error; } }
  };
}
