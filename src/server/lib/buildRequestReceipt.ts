// One execution receipt per verified owner's build request. A workspace lease protects concurrent
// writers; it does not remember a request after that lease is released. These small account-lifetime
// tombstones prevent a transport replay from starting paid work again, even after the build finished.
// No prompt, source, secret or provider response is persisted. The wallet still settles through its
// existing wallet_ops transaction, using the stable buildRef returned here.

import { createHash } from 'node:crypto';
import { ownedByVerifiedUid } from './workspaceIdentity';

export const BUILD_REQUEST_COLLECTION = 'agentv3_build_requests';
export const BUILD_REQUEST_CALL_TIMEOUT_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const OUTCOMES = new Set(['complete', 'failed', 'stopped', 'unknown']);

export type BuildRequestOutcome = 'complete' | 'failed' | 'stopped' | 'unknown';
export interface BuildRequestReceipt {
  version: 1;
  id: string;
  ownerId: string;
  workspaceId: string;
  requestId: string;
  digest: string;
  /** Independent of server attempt/start time; used by the existing wallet debit coordinator. */
  buildRef: string;
  attemptId: string;
  state: 'running' | 'terminal';
  createdAt: number;
  updatedAt: number;
  outcome?: BuildRequestOutcome;
}

interface Snapshot { exists: boolean | (() => boolean); data(): unknown }
interface ReceiptTransaction { get(ref: any): Promise<Snapshot>; set(ref: any, data: BuildRequestReceipt): void }
export interface BuildRequestStore {
  collection(name: string): { doc(id: string): any };
  runTransaction<T>(body: (transaction: ReceiptTransaction) => Promise<T>): Promise<T>;
}

export type BuildRequestRefusal = 'invalid' | 'forbidden' | 'input-mismatch' | 'in-progress' | 'terminal' | 'unavailable';
export type ReserveBuildRequestResult =
  | { ok: true; receipt: BuildRequestReceipt }
  | { ok: false; code: BuildRequestRefusal; receipt?: BuildRequestReceipt };

export function validBuildRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function ownedReceiptWorkspace(ownerId: string, workspaceId: string): boolean {
  return ownerId !== 'anon' && typeof workspaceId === 'string' && workspaceId.length <= 256
    && /^agentv3-[A-Za-z0-9_-]+$/.test(workspaceId) && ownedByVerifiedUid(ownerId, workspaceId);
}

/** A stable scoped key. Delimited JSON avoids ambiguous concatenations; all stored keys are hashes. */
export function buildRequestIdentity(ownerId: string, workspaceId: string, requestId: string) {
  const hash = createHash('sha256').update(JSON.stringify([ownerId, workspaceId, requestId.toLowerCase()])).digest('hex');
  return { id: `req_${hash}`, buildRef: `build-request_${hash}` };
}

/**
 * Hash JSON execution inputs with sorted object keys and preserved array order. Only top-level
 * requestId is excluded: any other changed option/body value conservatively rejects reuse. This
 * hashes incrementally, never retaining another complete serialized body or storing any input.
 */
export function buildRequestInputDigest(input: unknown): string {
  const hash = createHash('sha256');
  const seen = new Set<object>();
  let bytes = 0;
  let nodes = 0;
  const append = (text: string) => {
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_INPUT_BYTES) throw new Error('Build request inputs are too large');
    hash.update(text);
  };
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 100_000 || depth > 64) throw new Error('Build request inputs are too complex');
    if (value === null || value === undefined) { append('null'); return; }
    if (typeof value === 'string' || typeof value === 'boolean') { append(JSON.stringify(value)); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Build request inputs are not JSON');
      append(JSON.stringify(value)); return;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Build request inputs are not JSON');
    seen.add(value);
    if (Array.isArray(value)) {
      append('[');
      for (let index = 0; index < value.length; index++) { if (index) append(','); visit(value[index], depth + 1); }
      append(']');
    } else {
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new Error('Build request inputs are not plain JSON');
      append('{');
      let first = true;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const key of Object.keys(value).sort()) {
        if (depth === 0 && key === 'requestId') continue;
        const descriptor = descriptors[key];
        if (!('value' in descriptor)) throw new Error('Build request inputs are not plain JSON');
        if (descriptor.value === undefined) continue;
        if (!first) append(','); first = false;
        append(JSON.stringify(key)); append(':'); visit(descriptor.value, depth + 1);
      }
      append('}');
    }
    seen.delete(value);
  };
  visit(input, 0);
  return hash.digest('hex');
}

const exists = (snapshot: Snapshot) => typeof snapshot.exists === 'function' ? snapshot.exists() : snapshot.exists;

function validReceipt(value: unknown, identity: Pick<BuildRequestReceipt, 'id' | 'ownerId' | 'workspaceId' | 'requestId' | 'buildRef'>): value is BuildRequestReceipt {
  if (!value || typeof value !== 'object') return false;
  const row = value as BuildRequestReceipt;
  return row.version === 1 && row.id === identity.id && row.ownerId === identity.ownerId
    && row.workspaceId === identity.workspaceId && row.requestId === identity.requestId
    && row.buildRef === identity.buildRef && DIGEST.test(row.digest) && validBuildRequestId(row.attemptId)
    && Number.isFinite(row.createdAt) && row.createdAt >= 0 && Number.isFinite(row.updatedAt) && row.updatedAt >= row.createdAt
    && (row.state === 'running' ? row.outcome === undefined : row.state === 'terminal' && OUTCOMES.has(row.outcome ?? ''));
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Build request store timed out')), BUILD_REQUEST_CALL_TIMEOUT_MS);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * Call after rate limiting and verified workspace/lease admission, before paid work or source writes.
 * Only the call that durably creates the receipt may execute. Existing running receipts are UNKNOWN
 * or in flight and never reclaimed on age; terminal receipts also never execute again. On an uncertain
 * commit/timeout, refuse and reconcile: the underlying transaction may still commit after the timeout.
 */
export async function reserveBuildRequest(
  store: BuildRequestStore | null | undefined,
  input: { ownerId: string; workspaceId: string; requestId: string; attemptId: string; input: unknown; nowMs?: number },
): Promise<ReserveBuildRequestResult> {
  if (!validBuildRequestId(input.requestId) || !validBuildRequestId(input.attemptId)) return { ok: false, code: 'invalid' };
  if (!ownedReceiptWorkspace(input.ownerId, input.workspaceId)) return { ok: false, code: 'forbidden' };
  let digest: string;
  try { digest = buildRequestInputDigest(input.input); } catch { return { ok: false, code: 'invalid' }; }
  if (!store) return { ok: false, code: 'unavailable' };
  const now = input.nowMs ?? Date.now();
  if (!Number.isFinite(now) || now < 0) return { ok: false, code: 'invalid' };
  const requestId = input.requestId.toLowerCase();
  const identity = { ...buildRequestIdentity(input.ownerId, input.workspaceId, requestId),
    ownerId: input.ownerId, workspaceId: input.workspaceId, requestId };
  const fresh: BuildRequestReceipt = { ...identity, version: 1, digest, attemptId: input.attemptId.toLowerCase(),
    state: 'running', createdAt: now, updatedAt: now };
  try {
    const ref = store.collection(BUILD_REQUEST_COLLECTION).doc(fresh.id);
    return await bounded(store.runTransaction(async (transaction): Promise<ReserveBuildRequestResult> => {
      const snapshot = await transaction.get(ref);
      if (exists(snapshot)) {
        const prior = snapshot.data();
        if (!validReceipt(prior, identity)) return { ok: false, code: 'unavailable' };
        if (prior.digest !== digest) return { ok: false, code: 'input-mismatch' };
        return { ok: false, code: prior.state === 'terminal' ? 'terminal' : 'in-progress', receipt: prior };
      }
      transaction.set(ref, fresh);
      return { ok: true, receipt: fresh };
    }));
  } catch { return { ok: false, code: 'unavailable' }; }
}

/**
 * Use the accepted server-side receipt handle; do not rehash a body the builder may have mutated.
 * A stale attempt cannot mark another attempt terminal. Missing/corrupt/changed data never creates a
 * replacement receipt. Identical terminal writes are replay-safe; conflicting outcomes are refused.
 */
export async function completeBuildRequest(
  store: BuildRequestStore | null | undefined,
  accepted: BuildRequestReceipt,
  outcome: BuildRequestOutcome,
  nowMs = Date.now(),
): Promise<{ ok: true; receipt: BuildRequestReceipt } | { ok: false; code: 'invalid' | 'stale' | 'unavailable' }> {
  if (!accepted || !validBuildRequestId(accepted.requestId) || !validBuildRequestId(accepted.attemptId)
    || !ownedReceiptWorkspace(accepted.ownerId, accepted.workspaceId) || !OUTCOMES.has(outcome)
    || !Number.isFinite(nowMs) || nowMs < 0) return { ok: false, code: 'invalid' };
  const identity = { ...buildRequestIdentity(accepted.ownerId, accepted.workspaceId, accepted.requestId),
    ownerId: accepted.ownerId, workspaceId: accepted.workspaceId, requestId: accepted.requestId };
  if (!validReceipt(accepted, identity)) return { ok: false, code: 'invalid' };
  if (!store) return { ok: false, code: 'unavailable' };
  try {
    const ref = store.collection(BUILD_REQUEST_COLLECTION).doc(accepted.id);
    return await bounded(store.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = exists(snapshot) ? snapshot.data() : null;
      if (!validReceipt(current, identity) || current.attemptId !== accepted.attemptId || current.digest !== accepted.digest) {
        return { ok: false as const, code: 'stale' as const };
      }
      if (current.state === 'terminal') return current.outcome === outcome
        ? { ok: true as const, receipt: current } : { ok: false as const, code: 'stale' as const };
      const terminal: BuildRequestReceipt = { ...current, state: 'terminal', outcome, updatedAt: Math.max(current.updatedAt, nowMs) };
      transaction.set(ref, terminal);
      return { ok: true as const, receipt: terminal };
    }));
  } catch { return { ok: false, code: 'unavailable' }; }
}
