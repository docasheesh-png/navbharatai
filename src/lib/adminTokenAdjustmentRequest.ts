import { readAdminReason, readTokenDelta } from './adminActionReason';
import { newRequestIdentity } from './requestIdentity';
import { ADMIN_TOKEN_REASON_DIGEST_DOMAIN, readAdminTokenAdjustmentReceiptResponse,
  type AdminTokenAdjustmentReceiptResponse } from './adminTokenAdjustmentReceipt';

export const ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY = 'navbharatai.admin-token-adjustment.v1';
export const ADMIN_TOKEN_ADJUSTMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 30_000;
const SESSION_DOMAIN = 'navbharatai/admin-token-adjustment/session/v1\0';
const STORAGE_BLOCKED = 'The saved adjustment cannot be safely resumed in this Admin session. Do not delete it or start another grant; explicit reconciliation is required.';

/** The exact reason is held only in memory and sent to the existing authorized server route. */
export interface AdminTokenAdjustmentIntent {
  version: 1;
  userId: string;
  requestId: string;
  delta: number;
  reason: string;
  createdAt: number;
  attempted: boolean;
}

/** No credentials, email, free-text reason, balance, or server receipt is persisted. */
export interface PendingAdminTokenAdjustmentIntent {
  version: 1;
  userId: string;
  requestId: string;
  delta: number;
  reasonDigest: string;
  sessionScope: string;
  createdAt: number;
  attempted: boolean;
}

export interface AdminTokenAdjustmentSession {
  readonly scope: string;
  readonly crypto: Pick<Crypto, 'subtle'>;
  readonly now: () => number;
}
export type AdminTokenAdjustmentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface AdminTokenAdjustmentLocks {
  request<T>(name: string, options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}
export type PendingAdminTokenAdjustment =
  | { status: 'empty' }
  | { status: 'pending'; intent: PendingAdminTokenAdjustmentIntent }
  | { status: 'blocked'; reason: string };
export interface ConfirmedAdminTokenAdjustment {
  status: 'confirmed';
  previousBalance: number;
  newBalance: number;
  walletId: string;
  replayed: boolean;
  /** Success remains durable until the administrator explicitly acknowledges its displayed receipt. */
  pendingRetained: true;
  message: string;
}
export type AdminTokenAdjustmentResult = (ConfirmedAdminTokenAdjustment
  | { status: 'refused'; pendingRetained: boolean; message: string }
  | { status: 'unknown'; pendingRetained: true; message: string }) & {
    /** Undefined means uncertainty; false is returned only when no dispatch/prior attempt is proven. */
    attempted?: boolean;
  };
export interface SubmitAdminTokenAdjustmentOptions {
  session: AdminTokenAdjustmentSession;
  headers: HeadersInit;
  storage?: AdminTokenAdjustmentStorage | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Optional cross-tab serialization; the synchronous page latch also works without Web Locks. */
  locks?: AdminTokenAdjustmentLocks | null;
}
export interface AdminTokenAcknowledgementOptions {
  locks?: AdminTokenAdjustmentLocks | null;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface InspectSavedAdminTokenReceiptOptions extends AdminTokenAcknowledgementOptions {
  headers: HeadersInit;
  storage?: AdminTokenAdjustmentStorage | null;
  fetch?: typeof fetch;
}
export type SavedAdminTokenReceiptResult = {
  status: 'confirmed';
  receipt: AdminTokenAdjustmentReceiptResponse['receipt'];
  currentWallet: AdminTokenAdjustmentReceiptResponse['currentWallet'];
  /** Bind acknowledgement to the exact review the administrator actually saw, not a newer review. */
  reviewId: string;
  pendingRetained: true;
  message: string;
} | { status: 'unknown'; pendingRetained: true; message: string };

interface SavedAdjustmentSnapshot {
  raw: string;
  record: PendingAdminTokenAdjustmentIntent;
  removalAttempted?: boolean;
}

const sessions = new WeakSet<AdminTokenAdjustmentSession>();
const inFlight = new WeakMap<AdminTokenAdjustmentStorage, {
  scope: string;
  /** Memory-only comparison; never serialized. Shared callers must supply the same credential. */
  authHeader: string;
  intent: AdminTokenAdjustmentIntent;
  promise: Promise<AdminTokenAdjustmentResult>;
}>();
// This memory-only receipt authorizes cleanup, never a new credit. Scope is checked before every read.
const confirmedCleanup = new WeakMap<AdminTokenAdjustmentStorage, {
  scope: string;
  intent: AdminTokenAdjustmentIntent;
  record: PendingAdminTokenAdjustmentIntent;
  result: ConfirmedAdminTokenAdjustment;
  snapshot: SavedAdjustmentSnapshot;
}>();
// Browser storage disappearing cannot turn a same-page unknown operation into permission to mint
// another identity. Only metadata is retained; the free-text reason must still be re-entered.
const unresolved = new WeakMap<AdminTokenAdjustmentStorage, PendingAdminTokenAdjustmentIntent>();
const inspectedReceiptCleanup = new WeakMap<AdminTokenAdjustmentStorage, {
  scope: string;
  reviewId: string;
  generation: object;
  snapshot: SavedAdjustmentSnapshot;
}>();
const inspectionGeneration = new WeakMap<AdminTokenAdjustmentStorage, object>();
let inspectionSequence = 0;

async function digest(crypto: Pick<Crypto, 'subtle'>, text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** A noncredential scope, not an authentication decision. The opaque Admin token is never retained. */
export async function createAdminTokenAdjustmentSession(
  adminToken: string,
  options: { crypto?: Pick<Crypto, 'subtle'>; now?: () => number } = {},
): Promise<AdminTokenAdjustmentSession | null> {
  try {
    if (typeof adminToken !== 'string' || !adminToken) return null;
    const crypto = options.crypto ?? globalThis.crypto;
    if (!crypto?.subtle) return null;
    const scope = await digest(crypto, SESSION_DOMAIN + adminToken);
    const session = Object.freeze({ scope, crypto, now: options.now ?? Date.now });
    sessions.add(session);
    return session;
  } catch { return null; }
}

function validSession(session: AdminTokenAdjustmentSession | null): session is AdminTokenAdjustmentSession {
  return !!session && sessions.has(session);
}
function storageOrNull(storage?: AdminTokenAdjustmentStorage | null): AdminTokenAdjustmentStorage | null {
  try { return storage === undefined ? globalThis.localStorage ?? null : storage; }
  catch { return null; }
}
function validUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && value.trim() === value && !/[\/\u0000-\u001f\u007f]/.test(value);
}
function validIdentity(value: unknown): value is string {
  // Identical format to the server's validRequestId; no server validation is weakened.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}
function exactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(record, key));
}
function validTime(createdAt: unknown): createdAt is number {
  return typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt > 0;
}
function fresh(createdAt: number, session: AdminTokenAdjustmentSession): boolean {
  const age = session.now() - createdAt;
  return Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= ADMIN_TOKEN_ADJUSTMENT_TTL_MS;
}
function readIntent(value: unknown): AdminTokenAdjustmentIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['version', 'userId', 'requestId', 'delta', 'reason', 'createdAt', 'attempted'])) return null;
  const reason = readAdminReason(record.reason);
  const delta = readTokenDelta(record.delta);
  if (record.version !== 1 || !validUserId(record.userId) || !validIdentity(record.requestId)
    || typeof record.delta !== 'number' || delta.ok === false || reason.ok === false || reason.reason !== record.reason
    || !validTime(record.createdAt) || typeof record.attempted !== 'boolean') return null;
  return { version: 1, userId: record.userId, requestId: record.requestId, delta: delta.delta,
    reason: reason.reason, createdAt: record.createdAt, attempted: record.attempted };
}
function readRecord(value: unknown): PendingAdminTokenAdjustmentIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ['version', 'userId', 'requestId', 'delta', 'reasonDigest', 'sessionScope', 'createdAt', 'attempted'])) return null;
  const delta = readTokenDelta(record.delta);
  if (record.version !== 1 || !validUserId(record.userId) || !validIdentity(record.requestId)
    || typeof record.delta !== 'number' || delta.ok === false || !validTime(record.createdAt)
    || typeof record.attempted !== 'boolean' || typeof record.reasonDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.reasonDigest)
    || typeof record.sessionScope !== 'string' || !/^[a-f0-9]{64}$/.test(record.sessionScope)) return null;
  return { version: 1, userId: record.userId, requestId: record.requestId, delta: delta.delta,
    reasonDigest: record.reasonDigest, sessionScope: record.sessionScope, createdAt: record.createdAt, attempted: record.attempted };
}
function sameBase(a: AdminTokenAdjustmentIntent | PendingAdminTokenAdjustmentIntent, b: AdminTokenAdjustmentIntent | PendingAdminTokenAdjustmentIntent): boolean {
  return a.version === b.version && a.userId === b.userId && a.requestId === b.requestId
    && a.delta === b.delta && a.createdAt === b.createdAt;
}
function sameIntent(a: AdminTokenAdjustmentIntent, b: AdminTokenAdjustmentIntent): boolean {
  return sameBase(a, b) && a.reason === b.reason;
}
function sameRecord(a: PendingAdminTokenAdjustmentIntent, b: PendingAdminTokenAdjustmentIntent): boolean {
  return sameBase(a, b) && a.reasonDigest === b.reasonDigest && a.sessionScope === b.sessionScope;
}

export function createAdminTokenAdjustmentIntent(
  input: { userId: string; delta: number; reason: string },
  options: { mint?: () => string | undefined; now?: () => number } = {},
): { ok: true; intent: AdminTokenAdjustmentIntent } | { ok: false; reason: string } {
  try {
    const reason = readAdminReason(input.reason);
    const delta = readTokenDelta(input.delta);
    if (!validUserId(input.userId)) return { ok: false, reason: 'A valid target account is required.' };
    if (reason.ok === false) return { ok: false, reason: reason.error };
    if (delta.ok === false) return { ok: false, reason: delta.error };
    const requestId = (options.mint ?? newRequestIdentity)();
    if (!validIdentity(requestId)) return { ok: false, reason: 'A secure request identity is unavailable. No adjustment was sent.' };
    const intent = readIntent({ version: 1, userId: input.userId, requestId, delta: delta.delta,
      reason: reason.reason, createdAt: (options.now ?? Date.now)(), attempted: false });
    return intent ? { ok: true, intent } : { ok: false, reason: 'The adjustment identity could not be prepared safely.' };
  } catch { return { ok: false, reason: 'The adjustment identity could not be prepared safely. No adjustment was sent.' }; }
}

function readStored(storage: AdminTokenAdjustmentStorage, session: AdminTokenAdjustmentSession): PendingAdminTokenAdjustment {
  try {
    const guard = unresolved.get(storage);
    if (guard && (guard.sessionScope !== session.scope || !fresh(guard.createdAt, session))) return { status: 'blocked', reason: STORAGE_BLOCKED };
    const raw = storage.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY);
    if (raw === null) return { status: 'empty' };
    const intent = raw.length <= 4096 ? readRecord(JSON.parse(raw)) : null;
    if (!intent || intent.sessionScope !== session.scope || !fresh(intent.createdAt, session)) return { status: 'blocked', reason: STORAGE_BLOCKED };
    if (guard && (!sameRecord(guard, intent) || !intent.attempted)) return { status: 'blocked', reason: STORAGE_BLOCKED };
    if (intent.attempted && !guard) unresolved.set(storage, { ...intent });
    return { status: 'pending', intent };
  } catch { return { status: 'blocked', reason: STORAGE_BLOCKED }; }
}

export async function readPendingAdminTokenAdjustment(
  session: AdminTokenAdjustmentSession | null, storage?: AdminTokenAdjustmentStorage | null,
): Promise<PendingAdminTokenAdjustment> {
  try {
    const target = storageOrNull(storage);
    if (!target || !validSession(session)) return { status: 'blocked', reason: 'Secure adjustment recovery is unavailable in this Admin session. No new adjustment can be sent safely.' };
    // A checked GET is independent of the old login/TTL, but it is not permission to skip explicit
    // acknowledgement. This also guards a removal whose readback failed before the modal was closed.
    if (inspectedReceiptCleanup.has(target)) return { status: 'blocked', reason: STORAGE_BLOCKED };
    const known = confirmedCleanup.get(target);
    if (known && (known.scope !== session.scope || !fresh(known.record.createdAt, session))) return { status: 'blocked', reason: STORAGE_BLOCKED };
    const pending = readStored(target, session);
    // An acknowledged removal with failed readback must remain recoverable after modal close.
    const guarded = unresolved.get(target) ?? known?.record;
    return pending.status === 'empty' && guarded ? { status: 'pending', intent: { ...guarded } } : pending;
  } catch { return { status: 'blocked', reason: STORAGE_BLOCKED }; }
}
function unknown(message: string): AdminTokenAdjustmentResult {
  return { status: 'unknown', pendingRetained: true, message };
}
function writeVerified(storage: AdminTokenAdjustmentStorage, record: PendingAdminTokenAdjustmentIntent, session: AdminTokenAdjustmentSession): boolean {
  try {
    storage.setItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY, JSON.stringify(record));
    const saved = readStored(storage, session);
    return saved.status === 'pending' && sameRecord(saved.intent, record) && saved.intent.attempted === record.attempted;
  } catch { return false; }
}
function clearMatching(storage: AdminTokenAdjustmentStorage, record: PendingAdminTokenAdjustmentIntent, session: AdminTokenAdjustmentSession): boolean {
  try {
    const saved = readStored(storage, session);
    if (saved.status !== 'pending' || !sameRecord(saved.intent, record) || !saved.intent.attempted) return false;
    storage.removeItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY);
    if (readStored(storage, session).status !== 'empty') return false;
    if (sameRecord(unresolved.get(storage) ?? record, record)) unresolved.delete(storage);
    return true;
  } catch { return false; }
}

function snapshotGuardsMatch(storage: AdminTokenAdjustmentStorage, record: PendingAdminTokenAdjustmentIntent): boolean {
  const guard = unresolved.get(storage);
  const confirmed = confirmedCleanup.get(storage);
  return (!guard || (sameRecord(guard, record) && guard.attempted === record.attempted))
    && (!confirmed || (sameRecord(confirmed.record, record) && confirmed.record.attempted === record.attempted));
}

/** Scope/age are deliberately not accepted as mutation authority: this snapshot is only a GET lookup target. */
function readReceiptSnapshot(storage: AdminTokenAdjustmentStorage): SavedAdjustmentSnapshot | null {
  try {
    const raw = storage.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY);
    if (raw === null || raw.length > 4096) return null;
    const record = readRecord(JSON.parse(raw));
    return record && snapshotGuardsMatch(storage, record) ? { raw, record } : null;
  } catch { return null; }
}

function boundedAdminOperation<T>(options: AdminTokenAcknowledgementOptions, unavailable: () => T,
  execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    const controller = new AbortController();
    const externalSignal = options.signal;
    return new Promise<T>((resolve) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (value: T) => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        externalSignal?.removeEventListener('abort', interrupt);
        resolve(value);
      };
      const interrupt = () => { controller.abort(); finish(unavailable()); };
      const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
        ? Math.min(options.timeoutMs!, 120_000) : DEFAULT_TIMEOUT_MS;
      timer = setTimeout(interrupt, timeoutMs);
      externalSignal?.addEventListener('abort', interrupt, { once: true });
      if (externalSignal?.aborted) interrupt();
      void Promise.resolve().then(() => controller.signal.aborted ? unavailable() : execute(controller.signal))
        .then(finish, () => finish(unavailable()));
    });
  } catch { return Promise.resolve(unavailable()); }
}

function resolvedLocks(options: AdminTokenAcknowledgementOptions): AdminTokenAdjustmentLocks | null {
  return options.locks === undefined ? globalThis.navigator?.locks ?? null : options.locks;
}

/** Caller MUST hold the shared Web Lock. No await may separate comparison, removal and readback. */
function removeCheckedSnapshot(storage: AdminTokenAdjustmentStorage, snapshot: SavedAdjustmentSnapshot): boolean {
  try {
    if (!snapshotGuardsMatch(storage, snapshot.record)) return false;
    const raw = storage.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY);
    // Only a previously attempted acknowledgement may finish a removal whose readback had failed.
    if (raw === null) return snapshot.removalAttempted === true;
    if (raw !== snapshot.raw) return false;
    snapshot.removalAttempted = true;
    storage.removeItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY);
    return storage.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY) === null;
  } catch { return false; }
}

function releaseMatchingGuards(storage: AdminTokenAdjustmentStorage, record: PendingAdminTokenAdjustmentIntent): void {
  const guard = unresolved.get(storage);
  if (guard && sameRecord(guard, record) && guard.attempted === record.attempted) unresolved.delete(storage);
  const confirmed = confirmedCleanup.get(storage);
  if (confirmed && sameRecord(confirmed.record, record) && confirmed.record.attempted === record.attempted) confirmedCleanup.delete(storage);
  const inspected = inspectedReceiptCleanup.get(storage);
  if (inspected && sameRecord(inspected.snapshot.record, record) && inspected.snapshot.record.attempted === record.attempted) {
    inspectedReceiptCleanup.delete(storage);
    inspectionGeneration.delete(storage);
  }
}

/** Explicit acknowledgement of a displayed checked receipt; never a discard-unknown operation. */
export async function clearConfirmedAdminTokenAdjustment(
  intent: AdminTokenAdjustmentIntent, session: AdminTokenAdjustmentSession | null,
  storage?: AdminTokenAdjustmentStorage | null,
  options: AdminTokenAcknowledgementOptions = {},
): Promise<{ cleared: boolean; message: string }> {
  const unavailable = () => ({ cleared: false,
    message: 'Acknowledgement could not complete safely. The checked adjustment remains confirmed; retain its saved identity and do not start another grant.' });
  try {
    const target = storageOrNull(storage);
    const saved = target && confirmedCleanup.get(target);
    if (!target || !validSession(session) || !saved || saved.scope !== session.scope
      || !sameIntent(saved.intent, intent) || !fresh(saved.record.createdAt, session)) {
      return { cleared: false, message: 'No checked confirmation is available in this Admin session. Reconcile the saved request without starting another grant.' };
    }
    const locks = resolvedLocks(options);
    if (!locks) return { cleared: false, message: 'Acknowledgement is unavailable in this browser because secure cross-tab locking is unavailable. Keep the saved adjustment and review its receipt in a supported browser; do not start another grant.' };
    return boundedAdminOperation(options, unavailable, (signal) => locks.request(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY, { signal }, async () => {
      if (signal.aborted || confirmedCleanup.get(target) !== saved || inFlight.has(target)
        || saved.scope !== session.scope || !fresh(saved.record.createdAt, session)) return unavailable();
      const cleared = removeCheckedSnapshot(target, saved.snapshot);
      if (cleared) releaseMatchingGuards(target, saved.record);
      return { cleared, message: cleared ? 'The confirmed adjustment was acknowledged and its saved record cleared.'
        : 'The adjustment is confirmed, but its saved record changed or cleanup is blocked. Do not start another grant.' };
    }));
  } catch { return unavailable(); }
}

/** Read-only recovery of an immutable operation receipt. Neither expiry nor a new login authorizes a POST. */
export async function inspectSavedAdminTokenReceipt(session: AdminTokenAdjustmentSession | null,
  options: InspectSavedAdminTokenReceiptOptions): Promise<SavedAdminTokenReceiptResult> {
  const unavailable = (): SavedAdminTokenReceiptResult => ({ status: 'unknown', pendingRetained: true,
    message: 'The saved adjustment receipt could not be verified. Keep the saved identity; do not reset it or create another grant.' });
  try {
    const target = storageOrNull(options.storage);
    if (!target || !validSession(session)) return unavailable();
    const headers = new Headers(options.headers);
    const token = headers.get('x-admin-token');
    if (!token || inFlight.has(target)) return unavailable();
    const prior = inspectedReceiptCleanup.get(target);
    const generation = {};
    inspectionGeneration.set(target, generation);
    const reviewId = `receipt-review-${++inspectionSequence}`;
    return boundedAdminOperation(options, unavailable, async (signal) => {
      if (await digest(session.crypto, SESSION_DOMAIN + token) !== session.scope || signal.aborted
        || inspectionGeneration.get(target) !== generation) return unavailable();
      const inspect = async (): Promise<SavedAdminTokenReceiptResult> => {
        if (signal.aborted || inspectionGeneration.get(target) !== generation || inFlight.has(target)) return unavailable();
        let snapshot = readReceiptSnapshot(target);
        // Preserve recovery when this page removed the exact reviewed record but verification failed.
        // A missing record without that checked acknowledgement history is never invented or reset.
        if (!snapshot && prior?.snapshot.removalAttempted && target.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY) === null
          && snapshotGuardsMatch(target, prior.snapshot.record)) snapshot = { ...prior.snapshot };
        if (!snapshot) return unavailable();
        const fetcher = options.fetch ?? globalThis.fetch;
        const response = await fetcher(`/api/v1/admin/token-adjustments/${encodeURIComponent(snapshot.record.requestId)}/receipt`, {
          method: 'GET', headers, signal, cache: 'no-store',
        });
        const body: unknown = await response.json();
        if (signal.aborted || inspectionGeneration.get(target) !== generation || response.status !== 200 || response.ok !== true) return unavailable();
        const checked = readAdminTokenAdjustmentReceiptResponse(body);
        if (!checked || checked.receipt.requestId !== snapshot.record.requestId
          || checked.receipt.requestedUserId !== snapshot.record.userId || checked.receipt.delta !== snapshot.record.delta
          || checked.receipt.reasonDigest !== snapshot.record.reasonDigest) return unavailable();
        const current = readReceiptSnapshot(target);
        const sameSnapshot = current?.raw === snapshot.raw || (snapshot.removalAttempted === true
          && target.getItem(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY) === null && snapshotGuardsMatch(target, snapshot.record));
        if (!sameSnapshot || signal.aborted || inspectionGeneration.get(target) !== generation) return unavailable();
        // Cache only the checked metadata proof. No credential, free-text reason, or caller-mutable DTO is retained.
        inspectedReceiptCleanup.set(target, { scope: session.scope, reviewId, generation, snapshot });
        return { status: 'confirmed', receipt: checked.receipt, currentWallet: checked.currentWallet, reviewId,
          pendingRetained: true, message: 'The original operation receipt is verified. Review it and the separately refreshed wallet, then explicitly acknowledge this saved operation.' };
      };
      const locks = resolvedLocks(options);
      return locks ? locks.request(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY, { signal }, inspect) : inspect();
    });
  } catch { return unavailable(); }
}

/** Clears only the exact metadata reviewed through a checked GET, under the submission lock. */
export async function acknowledgeSavedAdminTokenReceipt(session: AdminTokenAdjustmentSession | null,
  storage?: AdminTokenAdjustmentStorage | null,
  options: AdminTokenAcknowledgementOptions & { reviewId?: string } = {},
): Promise<{ cleared: boolean; message: string }> {
  const unavailable = () => ({ cleared: false,
    message: 'The reviewed operation cannot be acknowledged safely. Keep its saved identity and do not create another grant.' });
  try {
    const target = storageOrNull(storage);
    const saved = target && inspectedReceiptCleanup.get(target);
    if (!target || !validSession(session) || !saved || saved.scope !== session.scope || !options.reviewId || options.reviewId !== saved.reviewId
      || inspectionGeneration.get(target) !== saved.generation) return unavailable();
    const locks = resolvedLocks(options);
    if (!locks) return { cleared: false, message: 'Acknowledgement is unavailable in this browser because secure cross-tab locking is unavailable. Keep the saved adjustment and use a supported browser to review its receipt; do not start another grant.' };
    return boundedAdminOperation(options, unavailable, (signal) => locks.request(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY, { signal }, async () => {
      if (signal.aborted || inspectedReceiptCleanup.get(target) !== saved || inFlight.has(target) || saved.scope !== session.scope
        || inspectionGeneration.get(target) !== saved.generation) return unavailable();
      const cleared = removeCheckedSnapshot(target, saved.snapshot);
      if (cleared) {
        inspectedReceiptCleanup.delete(target);
        inspectionGeneration.delete(target);
        releaseMatchingGuards(target, saved.snapshot.record);
      }
      return { cleared, message: cleared ? 'The verified operation receipt was acknowledged. No tokens or money were changed.'
        : 'The saved operation changed or cleanup could not be verified. Nothing else was cleared; do not create another grant.' };
    }));
  } catch { return unavailable(); }
}
function checkedSuccess(value: unknown): value is { ok: true; previousBalance: number; newBalance: number; walletId: string; replayed?: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.ok === true && typeof body.previousBalance === 'number' && Number.isFinite(body.previousBalance)
    && typeof body.newBalance === 'number' && Number.isFinite(body.newBalance) && validUserId(body.walletId)
    && (body.replayed === undefined || typeof body.replayed === 'boolean') && body.error === undefined;
}
function checkedError(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  return body.ok !== true && typeof body.error === 'string' && body.error.trim().length > 0 ? body.error.trim().slice(0, 500) : null;
}

interface OperationState {
  dispatched: boolean;
  priorAttempted?: boolean;
}
function interruptionResult(intent: AdminTokenAdjustmentIntent, storage: AdminTokenAdjustmentStorage,
  session: AdminTokenAdjustmentSession, operation: OperationState): AdminTokenAdjustmentResult {
  if (operation.dispatched || operation.priorAttempted === true) {
    return unknown('This attempt was interrupted. A request may already have committed; retain and reconcile the same saved request before starting another grant.');
  }
  const saved = readStored(storage, session);
  if (saved.status === 'blocked' || confirmedCleanup.has(storage) || inspectedReceiptCleanup.has(storage) || unresolved.has(storage)
    || (saved.status === 'pending' && (!sameBase(saved.intent, intent)
      || (operation.priorAttempted === undefined && saved.intent.attempted)))) {
    return unknown('This attempt was interrupted before dispatch, but an earlier adjustment may remain unresolved. Keep the saved request for reconciliation.');
  }
  return { status: 'refused', pendingRetained: saved.status === 'pending',
    message: 'This attempt timed out or was cancelled before any request was sent. No adjustment was made by this attempt.' };
}

async function dispatch(intent: AdminTokenAdjustmentIntent, storage: AdminTokenAdjustmentStorage,
  options: SubmitAdminTokenAdjustmentOptions, operation: OperationState): Promise<AdminTokenAdjustmentResult> {
  const session = options.session;
  const interrupted = () => interruptionResult(intent, storage, session, operation);
  if (options.signal?.aborted) return interrupted();
  // Bind the supplied authentication header too, not just a caller-provided session object.
  const headers = new Headers(options.headers);
  const token = headers.get('x-admin-token');
  if (!token || await digest(session.crypto, SESSION_DOMAIN + token) !== session.scope) return unknown(STORAGE_BLOCKED);
  if (options.signal?.aborted) return interrupted();
  const record: PendingAdminTokenAdjustmentIntent = { version: 1, userId: intent.userId, requestId: intent.requestId,
    delta: intent.delta, createdAt: intent.createdAt, attempted: intent.attempted, sessionScope: session.scope,
    reasonDigest: await digest(session.crypto, ADMIN_TOKEN_REASON_DIGEST_DOMAIN + intent.reason) };
  if (options.signal?.aborted) return interrupted();
  const known = confirmedCleanup.get(storage);
  if (known) {
    if (known.scope !== session.scope || !fresh(known.record.createdAt, session)) return unknown(STORAGE_BLOCKED);
    if (!sameIntent(known.intent, intent)) return { status: 'refused', pendingRetained: true,
      message: 'A saved confirmation is awaiting acknowledgement. Re-enter its original reason without changing the account, amount, or request ID.' };
    return { ...known.result }; // Explicit Done, not another Submit, acknowledges successful completion.
  }
  if (inspectedReceiptCleanup.has(storage)) return unknown('An operation receipt has been reviewed. Acknowledge that exact reviewed receipt before starting or retrying an adjustment.');
  let saved = readStored(storage, session);
  if (saved.status === 'blocked') return unknown(saved.reason);
  const guard = unresolved.get(storage);
  if (guard && !sameRecord(guard, record)) return { status: 'refused', pendingRetained: true,
    message: 'An earlier request remains unresolved. Restore its exact account, amount, request ID, and original reason; do not create another grant.' };
  if (saved.status === 'empty' && guard) {
    // The metadata in memory still proves the original identity. Restore only that exact record,
    // never a newly minted request, so the server can replay its existing durable receipt safely.
    if (!writeVerified(storage, guard, session)) return unknown('The original request identity could not be restored safely. Reconcile it without starting another grant.');
    saved = { status: 'pending', intent: { ...guard } };
  }
  if (saved.status === 'pending' && !sameRecord(saved.intent, record)) {
    return { status: 'refused', pendingRetained: true,
      message: 'Resume the saved account, amount, and request ID, and re-enter the same original reason. No new request was sent; the saved adjustment remains unchanged.' };
  }
  if (saved.status === 'empty') {
    if (intent.attempted) return unknown('An attempted adjustment has lost its saved identity. Reconcile its server receipt before starting another grant.');
    if (!writeVerified(storage, record, session)) return unknown('The adjustment could not be saved and verified. This attempt was not sent; resolve browser storage before continuing.');
    saved = { status: 'pending', intent: record };
  }
  const previouslyAttempted = saved.intent.attempted || intent.attempted;
  operation.priorAttempted = previouslyAttempted;
  if (options.signal?.aborted) return interrupted();
  const attempted = { ...saved.intent, attempted: true };
  if (!writeVerified(storage, attempted, session)) return unknown('The dispatch marker could not be saved and verified. This attempt was not sent; any earlier attempt still needs reconciliation.');

  const controller = new AbortController();
  let abortListener: (() => void) | undefined;
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      const interrupt = () => { controller.abort(); reject(new Error('Adjustment response interrupted.')); };
      abortListener = interrupt;
      options.signal?.addEventListener('abort', interrupt, { once: true });
      if (options.signal?.aborted) interrupt();
    });
    const received = (async () => {
      // A lock provider or crypto operation may ignore abort. The final gate still forbids a late POST.
      if (options.signal?.aborted) throw new Error('Adjustment cancelled before dispatch.');
      const fetcher = options.fetch ?? globalThis.fetch;
      operation.dispatched = true;
      const response = await fetcher(`/api/v1/admin/users/${encodeURIComponent(intent.userId)}/tokens`, {
        method: 'POST', headers, signal: controller.signal,
        body: JSON.stringify({ delta: intent.delta, reason: intent.reason, requestId: intent.requestId }),
      });
      const body: unknown = await response.json();
      return { response, body };
    })();
    // Includes JSON parsing. Late responses cannot run cleanup after an unknown outcome.
    const { response, body } = await Promise.race([received, interrupted]);
    if (options.signal?.aborted) return interruptionResult(intent, storage, session, operation);
    const current = readStored(storage, session);
    if (current.status !== 'pending' || !sameRecord(current.intent, attempted) || !current.intent.attempted) {
      return unknown('A response arrived, but its durable identity could not be verified. Reconcile the saved request before starting another grant.');
    }
    if (response.status === 200 && response.ok === true && checkedSuccess(body)) {
      const snapshot = readReceiptSnapshot(storage);
      if (!snapshot || !sameRecord(snapshot.record, attempted) || snapshot.record.attempted !== attempted.attempted) {
        return unknown('The server answered, but its saved operation snapshot could not be verified. Reconcile the original receipt without starting another grant.');
      }
      const result: ConfirmedAdminTokenAdjustment = { status: 'confirmed', previousBalance: body.previousBalance,
        newBalance: body.newBalance, walletId: body.walletId, replayed: body.replayed === true, pendingRetained: true,
        message: 'The server confirmed this adjustment. Review the receipt, then choose Done to acknowledge it before starting another grant.' };
      confirmedCleanup.set(storage, { scope: session.scope, intent: { ...intent, attempted: true }, record: attempted, result, snapshot });
      return { ...result };
    }
    const error = checkedError(body);
    if (!response.ok && [400, 401, 403, 404, 409].includes(response.status) && error) {
      if (previouslyAttempted) return unknown(`This attempt was refused: ${error} A previous attempt may already have committed. Keep the same saved request and reconcile it; do not start another grant.`);
      const cleared = clearMatching(storage, attempted, session);
      return { status: 'refused', pendingRetained: !cleared,
        message: cleared ? `Not applied: ${error}` : `Not applied: ${error} Record cleanup is blocked; do not start another grant.` };
    }
    return unknown('The response did not prove whether the adjustment committed. Retry only this saved request to check its receipt; do not start another grant.');
  } catch {
    return unknown('The complete response was not received, so the adjustment outcome is unknown. Retry only this saved request; do not create another grant.');
  } finally {
    if (abortListener) options.signal?.removeEventListener('abort', abortListener);
  }
}

/**
 * Explicit submission, never automatic retry. Durable server receipts remain authoritative.
 * Storage survives close/reload but is not a cross-tab CAS; optional Web Locks serialize cooperating
 * tabs. Without Web Locks only the synchronous same-page latch is atomic. Free text is never stored.
 */
export function submitAdminTokenAdjustment(input: AdminTokenAdjustmentIntent, options: SubmitAdminTokenAdjustmentOptions): Promise<AdminTokenAdjustmentResult> {
  try {
    const intent = readIntent(input);
    if (!intent) return Promise.resolve({ status: 'refused', pendingRetained: true,
      message: 'The adjustment identity is invalid. This attempt was not sent; reconcile any saved adjustment first.' });
    const session = options.session;
    if (!validSession(session) || !fresh(intent.createdAt, session)) return Promise.resolve(unknown(STORAGE_BLOCKED));
    const storage = storageOrNull(options.storage);
    if (!storage) return Promise.resolve(unknown('Browser storage is unavailable. This attempt was not sent; any earlier request still needs reconciliation.'));
    const headers = new Headers(options.headers);
    const authHeader = headers.get('x-admin-token');
    if (!authHeader) return Promise.resolve(unknown(STORAGE_BLOCKED));
    const active = inFlight.get(storage);
    if (active) {
      if (active.scope !== session.scope || active.authHeader !== authHeader) return Promise.resolve(unknown(STORAGE_BLOCKED));
      return sameIntent(active.intent, intent) ? active.promise : Promise.resolve(unknown('Another adjustment is still in flight. Wait for that request before continuing.'));
    }
    const controller = new AbortController();
    const operation: OperationState = { dispatched: false, priorAttempted: intent.attempted ? true : undefined };
    const externalSignal = options.signal;
    let settle!: (result: AdminTokenAdjustmentResult) => void;
    const promise = new Promise<AdminTokenAdjustmentResult>((resolve) => { settle = resolve; });
    inFlight.set(storage, { scope: session.scope, authHeader, intent, promise }); // Before yielding, not after React rerenders.
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: AdminTokenAdjustmentResult) => {
      if (finished) return;
      finished = true;
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', interrupt);
      if (inFlight.get(storage)?.promise === promise) inFlight.delete(storage);
      const observed = readStored(storage, session);
      const attempted = operation.dispatched || operation.priorAttempted === true || intent.attempted || unresolved.get(storage)?.attempted || inspectedReceiptCleanup.has(storage)
        ? true : operation.priorAttempted === false || observed.status === 'empty'
          || (observed.status === 'pending' && sameBase(observed.intent, intent) && !observed.intent.attempted) ? false : undefined;
      settle({ ...result, attempted });
    };
    const interrupt = () => {
      const result = interruptionResult(intent, storage, session, operation);
      controller.abort();
      finish(result);
    };
    const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
      ? Math.min(options.timeoutMs!, 120_000) : DEFAULT_TIMEOUT_MS;
    // The deadline includes lock acquisition and cryptographic checks, not just the network phase.
    timer = setTimeout(interrupt, timeoutMs);
    externalSignal?.addEventListener('abort', interrupt, { once: true });
    if (externalSignal?.aborted) interrupt();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return interruptionResult(intent, storage, session, operation);
      const locks = options.locks === undefined ? globalThis.navigator?.locks : options.locks;
      const execute = () => controller.signal.aborted
        ? Promise.resolve(interruptionResult(intent, storage, session, operation))
        : dispatch(intent, storage, { ...options, headers, signal: controller.signal }, operation);
      return locks ? await locks.request(ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY, { signal: controller.signal }, execute) : await execute();
    }).then(finish, () => {
      finish(controller.signal.aborted ? interruptionResult(intent, storage, session, operation)
        : unknown('The adjustment could not complete safely. Retain its identity and reconcile it before starting another grant.'));
    });
    return promise;
  } catch { return Promise.resolve(unknown('The adjustment could not be prepared safely. Reconcile any saved request before continuing.')); }
}
