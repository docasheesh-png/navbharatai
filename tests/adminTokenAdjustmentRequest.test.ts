import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY,
  ADMIN_TOKEN_ADJUSTMENT_TTL_MS,
  acknowledgeSavedAdminTokenReceipt,
  clearConfirmedAdminTokenAdjustment,
  createAdminTokenAdjustmentIntent,
  createAdminTokenAdjustmentSession,
  inspectSavedAdminTokenReceipt,
  readPendingAdminTokenAdjustment,
  submitAdminTokenAdjustment,
  type AdminTokenAdjustmentIntent,
  type AdminTokenAcknowledgementOptions,
  type AdminTokenAdjustmentLocks,
  type AdminTokenAdjustmentSession,
  type AdminTokenAdjustmentStorage,
  type PendingAdminTokenAdjustmentIntent,
  type InspectSavedAdminTokenReceiptOptions,
  type SubmitAdminTokenAdjustmentOptions,
} from '../src/lib/adminTokenAdjustmentRequest';
import { newRequestIdentity } from '../src/lib/requestIdentity';

const KEY = ADMIN_TOKEN_ADJUSTMENT_STORAGE_KEY;
const ID = 'request-synthetic-0001';
const NOW = 1_793_066_400_000;
const TOKEN = 'synthetic-admin-session-a';
const REASON = 'Synthetic build credit review';
const input = { userId: 'synthetic-owner', delta: 1000, reason: '  Synthetic build\n credit review  ' };
const receipt = { ok: true, previousBalance: 0, newBalance: 1000, walletId: 'synthetic-canonical', replayed: false };
let session: AdminTokenAdjustmentSession;

async function makeSession(token = TOKEN, now: () => number = () => NOW) {
  const made = await createAdminTokenAdjustmentSession(token, { crypto: webcrypto as unknown as Crypto, now });
  if (!made) throw new Error('Synthetic session could not be prepared');
  return made;
}
function makeIntent(overrides: Partial<AdminTokenAdjustmentIntent> = {}): AdminTokenAdjustmentIntent {
  const made = createAdminTokenAdjustmentIntent(input, { mint: () => ID, now: () => NOW });
  if (made.ok === false) throw new Error(made.reason);
  return { ...made.intent, ...overrides };
}
function metadata(intent = makeIntent(), owner = session): PendingAdminTokenAdjustmentIntent {
  return { version: 1, userId: intent.userId, requestId: intent.requestId, delta: intent.delta,
    createdAt: intent.createdAt, attempted: intent.attempted, sessionScope: owner.scope,
    reasonDigest: createHash('sha256').update('navbharatai/admin-token-adjustment/reason/v1\0' + intent.reason).digest('hex') };
}
function restore(saved: PendingAdminTokenAdjustmentIntent, reason = REASON): AdminTokenAdjustmentIntent {
  return { version: 1, userId: saved.userId, requestId: saved.requestId, delta: saved.delta,
    createdAt: saved.createdAt, attempted: saved.attempted, reason };
}
function memoryStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  return { storage, values };
}
function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function submit(intent: AdminTokenAdjustmentIntent, storage: AdminTokenAdjustmentStorage, fetcher: unknown,
  options: Partial<SubmitAdminTokenAdjustmentOptions> = {}) {
  return submitAdminTokenAdjustment(intent, { session,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': TOKEN },
    storage, fetch: fetcher as typeof fetch, locks: null, ...options });
}
const read = (storage: AdminTokenAdjustmentStorage, owner = session) => readPendingAdminTokenAdjustment(owner, storage);
const immediateLocks: AdminTokenAdjustmentLocks = { request: async (_name, options, callback) => {
  if (options.signal.aborted) throw new Error('Synthetic lock cancellation');
  return callback();
} };
const acknowledge = (intent: AdminTokenAdjustmentIntent, storage: AdminTokenAdjustmentStorage, owner = session,
  options: AdminTokenAcknowledgementOptions = {}) => clearConfirmedAdminTokenAdjustment(intent, owner, storage, { locks: immediateLocks, ...options });

beforeEach(async () => { session = await makeSession(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('durable token adjustment metadata without stored free text', () => {
  it('persists only scoped metadata and verifies attempted=true before sending the exact normalized payload', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(JSON.parse(values.get(KEY)!)).toEqual(metadata({ ...intent, attempted: true }));
      expect(Object.keys(JSON.parse(values.get(KEY)!)).sort()).toEqual([
        'attempted', 'createdAt', 'delta', 'reasonDigest', 'requestId', 'sessionScope', 'userId', 'version',
      ]);
      expect(values.get(KEY)).not.toContain(TOKEN);
      expect(values.get(KEY)).not.toContain(REASON);
      expect(values.get(KEY)).not.toContain('x-admin-token');
      expect(url).toBe('/api/v1/admin/users/synthetic-owner/tokens');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ delta: 1000, reason: REASON, requestId: ID }));
      return response(200, receipt);
    });
    expect(intent.reason).toBe(REASON);
    expect(await submit(intent, storage, fetcher)).toMatchObject({ status: 'confirmed', pendingRetained: true,
      previousBalance: 0, newBalance: 1000, walletId: 'synthetic-canonical' });
    expect(await read(storage)).toEqual({ status: 'pending', intent: metadata({ ...intent, attempted: true }) });
    expect(storage.removeItem).not.toHaveBeenCalled(); // Receipt must be acknowledged, not merely received.
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
    expect(storage.setItem.mock.calls.map(([, raw]) => JSON.parse(raw).attempted)).toEqual([false, true]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses secure random bytes in WebViews without randomUUID and never weakens request identity validation', () => {
    const source = { getRandomValues: (bytes: Uint8Array) => { bytes.fill(255); return bytes; } };
    const made = createAdminTokenAdjustmentIntent(input, { mint: () => newRequestIdentity(source as never), now: () => NOW });
    expect(made).toMatchObject({ ok: true, intent: { requestId: 'ffffffff-ffff-4fff-bfff-ffffffffffff' } });
    for (const requestId of [undefined, '', 'short', 'slash/identity', 'x'.repeat(81)]) {
      expect(createAdminTokenAdjustmentIntent(input, { mint: () => requestId })).toMatchObject({ ok: false });
    }
  });

  it.each([
    { ...input, userId: 'unsafe/owner' }, { ...input, delta: 0 }, { ...input, delta: 1.5 },
    { ...input, delta: 100_000_001 }, { ...input, reason: 'Admin adjustment' }, { ...input, reason: '' },
  ])('rejects invalid input without inventing an identity or reason', (bad) => {
    const mint = vi.fn(() => ID);
    expect(createAdminTokenAdjustmentIntent(bad, { mint })).toMatchObject({ ok: false });
    expect(mint).not.toHaveBeenCalled();
  });

  it('synchronously coalesces repeated calls before rerender and blocks another in-flight intent', async () => {
    const { storage } = memoryStorage();
    const delayed = deferred<Response>();
    const started = deferred<void>();
    const fetcher = vi.fn(() => { started.resolve(undefined); return delayed.promise; });
    const intent = makeIntent();
    const first = submit(intent, storage, fetcher);
    expect(submit({ ...intent }, storage, fetcher)).toBe(first);
    expect(await submit(makeIntent({ requestId: 'request-different', delta: 500 }), storage, fetcher))
      .toMatchObject({ status: 'unknown', pendingRetained: true });
    await started.promise;
    expect(fetcher).toHaveBeenCalledTimes(1);
    delayed.resolve(response(200, receipt));
    expect(await first).toMatchObject({ status: 'confirmed' });
    // Even after the Promise settles, repeated Submit only redisplays this unacknowledged receipt.
    expect(await submit(intent, storage, fetcher)).toMatchObject({ status: 'confirmed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: true });
  });

  it('replays a lost response after commit with the same ID and exact reason after close/reopen/reload', async () => {
    const { storage, values } = memoryStorage();
    let wallet = 0;
    const receipts = new Map<string, typeof receipt>();
    const payloads: string[] = [];
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      payloads.push(options.body as string);
      if (!receipts.has(body.requestId)) {
        wallet += body.delta;
        receipts.set(body.requestId, { ...receipt, newBalance: wallet });
        throw new Error('Synthetic response lost after commit');
      }
      return response(200, { ...receipts.get(body.requestId), replayed: true });
    });
    expect(await submit(makeIntent(), storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(wallet).toBe(1000);
    const reloaded = memoryStorage();
    reloaded.values.set(KEY, values.get(KEY)!);
    const resumedSession = await makeSession(); // Same auth session, new document state.
    const saved = await read(reloaded.storage, resumedSession);
    if (saved.status !== 'pending') throw new Error('Expected saved metadata');
    expect(saved.intent).not.toHaveProperty('reason');
    const restored = restore(saved.intent); // Explicit re-entry, never recovered free text.
    expect(await submit(restored, reloaded.storage, fetcher, { session: resumedSession }))
      .toMatchObject({ status: 'confirmed', replayed: true, pendingRetained: true });
    expect(wallet).toBe(1000);
    expect(payloads).toEqual([payloads[0], payloads[0]]);
    expect(await acknowledge(restored, reloaded.storage, resumedSession)).toMatchObject({ cleared: true });
  });

  it('retains successful identity until explicit Done, including reload before the receipt was displayed', async () => {
    const { storage, values } = memoryStorage();
    const fetcher = vi.fn().mockResolvedValue(response(200, receipt));
    await submit(makeIntent(), storage, fetcher);
    expect(values.has(KEY)).toBe(true);
    const reloaded = memoryStorage();
    reloaded.values.set(KEY, values.get(KEY)!);
    const saved = await read(reloaded.storage);
    if (saved.status !== 'pending') throw new Error('Expected durable success identity');
    expect(await acknowledge(restore(saved.intent), reloaded.storage)).toMatchObject({ cleared: false });
    const replay = vi.fn().mockResolvedValue(response(200, { ...receipt, replayed: true }));
    expect(await submit(restore(saved.intent), reloaded.storage, replay)).toMatchObject({ status: 'confirmed', replayed: true });
    expect(await acknowledge(restore(saved.intent), reloaded.storage)).toMatchObject({ cleared: true });
  });

  it('allows correcting an incorrectly reentered reason without clearing or posting the pending intent', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const original = values.get(KEY);
    const fetcher = vi.fn().mockResolvedValue(response(200, { ...receipt, replayed: true }));
    expect(await submit(makeIntent({ reason: 'Different synthetic reason' }), storage, fetcher))
      .toMatchObject({ status: 'refused', pendingRetained: true });
    expect(fetcher).not.toHaveBeenCalled();
    expect(values.get(KEY)).toBe(original);
    const corrected = createAdminTokenAdjustmentIntent({ ...input, reason: ' Synthetic  build credit review ' }, { mint: () => ID, now: () => NOW });
    if (corrected.ok === false) throw new Error(corrected.reason);
    expect(await submit(corrected.intent, storage, fetcher)).toMatchObject({ status: 'confirmed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['userId', 'delta', 'requestId', 'createdAt'] as const)('never overwrites a different pending %s', async (field) => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const changes = { userId: 'another-owner', delta: 2000, requestId: 'request-another', createdAt: NOW + 1 };
    const fetcher = vi.fn();
    expect(await submit(makeIntent({ [field]: changes[field] }), storage, fetcher)).toMatchObject({ status: 'refused', pendingRetained: true });
    expect(values.get(KEY)).toBe(JSON.stringify(saved));
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('blocks invalid, extra-field, legacy-plaintext, unreadable, or unavailable records without deleting them', async () => {
    for (const raw of ['not JSON', '', JSON.stringify(makeIntent()), JSON.stringify({ ...metadata(), reason: REASON }),
      JSON.stringify({ ...metadata(), adminToken: 'synthetic-secret' }), JSON.stringify({ ...metadata(), attempted: 'yes' }),
      JSON.stringify({ ...metadata(), version: 2 }), JSON.stringify({ ...metadata(), reasonDigest: 'invalid' })]) {
      const { storage, values } = memoryStorage();
      values.set(KEY, raw);
      const fetcher = vi.fn();
      expect(await read(storage)).toMatchObject({ status: 'blocked' });
      expect(await submit(makeIntent(), storage, fetcher)).toMatchObject({ status: 'unknown' });
      expect(values.get(KEY)).toBe(raw);
      expect(storage.removeItem).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
    const { storage } = memoryStorage();
    storage.getItem.mockImplementation(() => { throw new Error('Storage denied'); });
    expect(await read(storage)).toMatchObject({ status: 'blocked' });
    expect(await readPendingAdminTokenAdjustment(session, null)).toMatchObject({ status: 'blocked' });
    expect(await submitAdminTokenAdjustment(makeIntent(), { session, storage: null, headers: {} })).toMatchObject({ status: 'unknown' });
  });

  it('does not dispatch when storage is full, its write is lost, or the attempted marker cannot be verified', async () => {
    const full = memoryStorage();
    full.storage.setItem.mockImplementation(() => { throw new Error('Quota exceeded'); });
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), full.storage, fetcher)).toMatchObject({ status: 'unknown' });
    const dropped = memoryStorage();
    dropped.storage.setItem.mockImplementation(() => {});
    expect(await submit(makeIntent(), dropped.storage, fetcher)).toMatchObject({ status: 'unknown' });
    const marker = memoryStorage();
    marker.storage.setItem.mockImplementation((key, raw) => {
      if (JSON.parse(raw).attempted) throw new Error('Second write failed');
      marker.values.set(key, raw);
    });
    expect(await submit(makeIntent(), marker.storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(await read(marker.storage)).toMatchObject({ status: 'pending', intent: { attempted: false } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not recreate a missing record for an already-attempted intent', async () => {
    const { storage } = memoryStorage();
    const fetcher = vi.fn();
    expect(await submit(makeIntent({ attempted: true }), storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('retains scoped uncertainty when storage disappears after an unknown result and permits only exact-identity recovery', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    const lost = vi.fn().mockRejectedValue(new Error('Synthetic response lost'));
    expect(await submit(intent, storage, lost)).toMatchObject({ status: 'unknown', attempted: true });
    values.delete(KEY); // Same page: loss of storage must not mint permission for a second grant.
    const saved = await read(storage);
    expect(saved).toEqual({ status: 'pending', intent: metadata({ ...intent, attempted: true }) });
    expect(saved).not.toHaveProperty('intent.reason');
    const freshGrant = vi.fn();
    expect(await submit(makeIntent({ requestId: 'request-new-grant' }), storage, freshGrant))
      .toMatchObject({ status: 'refused', pendingRetained: true, attempted: true });
    expect(freshGrant).not.toHaveBeenCalled();
    expect(values.has(KEY)).toBe(false);
    const replay = vi.fn().mockResolvedValue(response(200, { ...receipt, replayed: true }));
    // Even the original caller's stale attempted=false cannot erase the guard's known attempt.
    expect(await submit(intent, storage, replay)).toMatchObject({ status: 'confirmed', replayed: true, attempted: true });
    expect(JSON.parse(replay.mock.calls[0][1].body)).toEqual({ delta: 1000, reason: REASON, requestId: ID });
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
  });

  it('does not reinterpret a later refusal as the first attempt after an unknown record disappears', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    await submit(intent, storage, vi.fn().mockRejectedValue(new Error('Synthetic interruption')));
    values.delete(KEY);
    const refused = vi.fn().mockResolvedValue(response(401, { error: 'Synthetic expired session' }));
    expect(await submit(intent, storage, refused)).toMatchObject({ status: 'unknown', pendingRetained: true, attempted: true });
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { attempted: true, requestId: ID } });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('guards previously read attempted metadata against disappearance, attempted downgrades, and replacement', async () => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    expect(await read(storage)).toEqual({ status: 'pending', intent: saved });
    values.delete(KEY);
    expect(await read(storage)).toEqual({ status: 'pending', intent: saved });
    values.set(KEY, JSON.stringify({ ...saved, attempted: false }));
    expect(await read(storage)).toMatchObject({ status: 'blocked' });
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
    values.set(KEY, JSON.stringify({ ...saved, requestId: 'request-replacement' }));
    expect(await read(storage)).toMatchObject({ status: 'blocked' });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe('Admin session scope and bounded retention', () => {
  it('does not reveal metadata or replay a saved request in a different Admin session', async () => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const other = await makeSession('synthetic-admin-session-b');
    const result = await read(storage, other);
    expect(result).toMatchObject({ status: 'blocked' });
    expect(result).not.toHaveProperty('intent');
    expect(JSON.stringify(result)).not.toContain(saved.userId);
    expect(JSON.stringify(result)).not.toContain(REASON);
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher, { session: other, headers: { 'x-admin-token': 'synthetic-admin-session-b' } }))
      .toMatchObject({ status: 'unknown' });
    expect(values.get(KEY)).toBe(JSON.stringify(saved));
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('binds the actual supplied credential header, not just a session object', async () => {
    const { storage } = memoryStorage();
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher, { headers: { 'x-admin-token': 'synthetic-admin-session-b' } }))
      .toMatchObject({ status: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('does not share an in-flight Promise with mismatched headers even when the caller reuses the old session object', async () => {
    const { storage } = memoryStorage();
    const delayed = deferred<Response>();
    const started = deferred<void>();
    const fetcher = vi.fn(() => { started.resolve(undefined); return delayed.promise; });
    const intent = makeIntent();
    const first = submit(intent, storage, fetcher);
    const differentCredential = submit(intent, storage, fetcher, { headers: { 'x-admin-token': 'synthetic-admin-session-b' } });
    expect(differentCredential).not.toBe(first);
    expect(await differentCredential).toMatchObject({ status: 'unknown' });
    await started.promise;
    delayed.resolve(response(200, receipt));
    expect(await first).toMatchObject({ status: 'confirmed' });
    expect(await submit(intent, storage, fetcher, { headers: { 'x-admin-token': 'synthetic-admin-session-b' } }))
      .toMatchObject({ status: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('never shares an old in-flight or cached confirmed result with a new Admin session', async () => {
    const { storage } = memoryStorage();
    const delayed = deferred<Response>();
    const fetcher = vi.fn(() => delayed.promise);
    const first = submit(makeIntent(), storage, fetcher);
    const other = await makeSession('synthetic-admin-session-b');
    const options = { session: other, headers: { 'x-admin-token': 'synthetic-admin-session-b' } };
    const blocked = await submit(makeIntent(), storage, fetcher, options);
    expect(blocked).toMatchObject({ status: 'unknown' });
    expect(blocked).not.toHaveProperty('walletId');
    delayed.resolve(response(200, receipt));
    expect(await first).toMatchObject({ status: 'confirmed' });
    expect(await read(storage, other)).toMatchObject({ status: 'blocked' });
    expect(await submit(makeIntent(), storage, fetcher, options)).toMatchObject({ status: 'unknown' });
    expect(await acknowledge(makeIntent(), storage, other)).toMatchObject({ cleared: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('blocks expired metadata after thirty days without deleting it or permitting a fresh grant', async () => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const expired = await makeSession(TOKEN, () => NOW + ADMIN_TOKEN_ADJUSTMENT_TTL_MS + 1);
    expect(await read(storage, expired)).toMatchObject({ status: 'blocked' });
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher, { session: expired })).toMatchObject({ status: 'unknown' });
    expect(await submit(makeIntent({ requestId: 'request-fresh', createdAt: expired.now() }), storage, fetcher, { session: expired }))
      .toMatchObject({ status: 'unknown' });
    expect(values.get(KEY)).toBe(JSON.stringify(saved));
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('fails closed when cryptographic session scoping is unavailable', async () => {
    expect(await createAdminTokenAdjustmentSession('', { crypto: webcrypto as unknown as Crypto })).toBeNull();
    expect(await createAdminTokenAdjustmentSession(TOKEN, { crypto: { subtle: undefined } as never })).toBeNull();
    const { storage } = memoryStorage();
    expect(await readPendingAdminTokenAdjustment(null, storage)).toMatchObject({ status: 'blocked' });
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher, { session: null as never })).toMatchObject({ status: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not reveal or replace a prior session memory guard when its durable record has disappeared', async () => {
    const { storage, values } = memoryStorage();
    await submit(makeIntent(), storage, vi.fn().mockRejectedValue(new Error('Synthetic interruption')));
    values.delete(KEY);
    const other = await makeSession('synthetic-admin-session-b');
    const recovered = await read(storage, other);
    expect(recovered).toMatchObject({ status: 'blocked' });
    expect(recovered).not.toHaveProperty('intent');
    const fetcher = vi.fn();
    expect(await submit(makeIntent({ requestId: 'request-new-session' }), storage, fetcher,
      { session: other, headers: { 'x-admin-token': 'synthetic-admin-session-b' } })).toMatchObject({ status: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(values.has(KEY)).toBe(false);
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { requestId: ID, attempted: true } });
  });
});

describe('authoritative response classification and explicit acknowledgement', () => {
  it.each([400, 401, 403, 404, 409])('clears a first-known checked HTTP %s refusal', async (status) => {
    const { storage } = memoryStorage();
    expect(await submit(makeIntent(), storage, vi.fn().mockResolvedValue(response(status, { error: 'Synthetic refusal' }))))
      .toEqual({ status: 'refused', pendingRetained: false, message: 'Not applied: Synthetic refusal', attempted: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
  });

  it.each([400, 401, 403, 404, 409])('retains HTTP %s refusal after a prior unknown outcome even if caller attempted=false', async (status) => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const result = await submit(makeIntent(), storage, vi.fn().mockResolvedValue(response(status, { error: 'Synthetic refusal' })));
    expect(result).toMatchObject({ status: 'unknown', pendingRetained: true });
    expect(result.message).toContain('previous attempt may already have committed');
    expect(JSON.parse(values.get(KEY)!)).toEqual(saved);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    [200, { ok: false, error: 'Not a checked success' }], [200, {}], [200, null],
    [200, { ...receipt, previousBalance: '0' }], [200, { ...receipt, newBalance: Infinity }],
    [200, { ...receipt, walletId: '' }], [200, { ...receipt, replayed: 'yes' }],
    [200, { ...receipt, error: 'Conflicting response' }], [500, receipt], [201, receipt],
    [400, { error: '' }], [403, { ok: true, error: 'Conflicting refusal' }], [429, { error: 'Try later' }],
  ])('retains uncertainty for HTTP %s with %j', async (status, body) => {
    const { storage } = memoryStorage();
    expect(await submit(makeIntent(), storage, vi.fn().mockResolvedValue(response(status as number, body))))
      .toMatchObject({ status: 'unknown', pendingRetained: true });
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { attempted: true } });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not accept a success if the durable record changed while the request was in flight', async () => {
    const { storage, values } = memoryStorage();
    const other = metadata(makeIntent({ requestId: 'request-another', userId: 'another-owner', attempted: true }));
    const fetcher = vi.fn(async () => { values.set(KEY, JSON.stringify(other)); return response(200, receipt); });
    expect(await submit(makeIntent(), storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(values.get(KEY)).toBe(JSON.stringify(other));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps a confirmed commit honest while failed acknowledgement blocks new grants', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    storage.removeItem.mockImplementation(() => { throw new Error('Removal denied'); });
    const fetcher = vi.fn().mockResolvedValue(response(200, receipt));
    expect(await submit(intent, storage, fetcher)).toMatchObject({ status: 'confirmed', pendingRetained: true });
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: false });
    expect(await submit(makeIntent({ requestId: 'request-new-grant' }), storage, fetcher)).toMatchObject({ status: 'refused', pendingRetained: true });
    expect(await submit(intent, storage, fetcher)).toMatchObject({ status: 'confirmed', pendingRetained: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    storage.removeItem.mockImplementation((key) => { values.delete(key); });
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
  });

  it('keeps recovery possible after removal succeeded but readback failed and the modal closed', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    storage.removeItem.mockImplementation((key) => {
      values.delete(key);
      storage.getItem.mockImplementationOnce(() => { throw new Error('Readback unavailable'); });
    });
    const fetcher = vi.fn().mockResolvedValue(response(200, receipt));
    await submit(intent, storage, fetcher);
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: false });
    expect(values.has(KEY)).toBe(false);
    const saved = await read(storage);
    if (saved.status !== 'pending') throw new Error('Expected recoverable metadata');
    expect(saved.intent).toEqual(metadata({ ...intent, attempted: true }));
    expect(saved.intent).not.toHaveProperty('reason');
    expect(await submit(restore(saved.intent), storage, fetcher)).toMatchObject({ status: 'confirmed' });
    expect(await acknowledge(restore(saved.intent), storage)).toMatchObject({ cleared: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cannot acknowledge an unknown attempt, another session, or another durable identity', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent({ attempted: true });
    values.set(KEY, JSON.stringify(metadata(intent)));
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: false });
    expect(storage.removeItem).not.toHaveBeenCalled();
    await submit(intent, storage, vi.fn().mockResolvedValue(response(200, receipt)));
    const other = metadata(makeIntent({ requestId: 'request-another', attempted: true }));
    values.set(KEY, JSON.stringify(other));
    expect(await acknowledge(intent, storage)).toMatchObject({ cleared: false });
    expect(values.get(KEY)).toBe(JSON.stringify(other));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('retains a first refusal if its cleanup fails', async () => {
    const { storage } = memoryStorage();
    storage.removeItem.mockImplementation(() => {});
    expect(await submit(makeIntent(), storage, vi.fn().mockResolvedValue(response(400, { error: 'Synthetic refusal' }))))
      .toMatchObject({ status: 'refused', pendingRetained: true });
    expect(await read(storage)).toMatchObject({ status: 'pending' });
  });
});

describe('bounded transport and cancellation', () => {
  it.each(['fetch', 'json'] as const)('bounds a hung %s and never automatically retries', async (phase) => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const started = deferred<void>();
    const never = new Promise<never>(() => {});
    const fetcher = vi.fn((_url: string, _options: RequestInit) => {
      started.resolve(undefined);
      return phase === 'fetch' ? never : Promise.resolve({ ...response(200, receipt), json: () => never });
    });
    const result = submit(makeIntent(), storage, fetcher, { timeoutMs: 25 });
    await started.promise; // Native crypto completes before the fetch/JSON timeout is measured.
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 'unknown', pendingRetained: true, attempted: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { attempted: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not clear a record for a late response after timeout', async () => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const delayed = deferred<Response>();
    const started = deferred<void>();
    const result = submit(makeIntent(), storage, vi.fn(() => { started.resolve(undefined); return delayed.promise; }), { timeoutMs: 25 });
    await started.promise;
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 'unknown' });
    delayed.resolve(response(200, receipt));
    await Promise.resolve();
    await Promise.resolve();
    expect(await read(storage)).toMatchObject({ status: 'pending' });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('retains cancellation metadata for reopening with explicit reason re-entry', async () => {
    const { storage } = memoryStorage();
    const controller = new AbortController();
    const started = deferred<void>();
    const fetcher = vi.fn(() => { started.resolve(undefined); return new Promise<Response>(() => {}); });
    const result = submit(makeIntent(), storage, fetcher, { signal: controller.signal });
    await started.promise;
    controller.abort();
    expect(await result).toMatchObject({ status: 'unknown' });
    const saved = await read(storage);
    if (saved.status !== 'pending') throw new Error('Expected saved metadata');
    expect(saved.intent).not.toHaveProperty('reason');
    const retry = vi.fn().mockResolvedValue(response(200, { ...receipt, replayed: true }));
    expect(await submit(restore(saved.intent), storage, retry)).toMatchObject({ status: 'confirmed' });
    expect(JSON.parse(retry.mock.calls[0][1].body)).toEqual({ delta: 1000, reason: REASON, requestId: ID });
  });

  it('does not dispatch or persist an already-aborted first attempt', async () => {
    const { storage } = memoryStorage();
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    expect(await submit(makeIntent(), storage, fetcher, { signal: controller.signal }))
      .toMatchObject({ status: 'refused', pendingRetained: false });
    expect(await read(storage)).toEqual({ status: 'empty' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('classifies malformed JSON and synchronous transport failures as unknown without throwing', async () => {
    const malformed = memoryStorage();
    const fetcher = vi.fn().mockResolvedValue({ ...response(200, receipt), json: async () => { throw new Error('Invalid JSON'); } });
    expect(await submit(makeIntent(), malformed.storage, fetcher)).toMatchObject({ status: 'unknown' });
    const throws = memoryStorage();
    expect(await submit(makeIntent(), throws.storage, () => { throw new Error('Transport setup failed'); })).toMatchObject({ status: 'unknown' });
  });

  it('uses a provided Web Lock and does not persist or dispatch before acquisition', async () => {
    const { storage } = memoryStorage();
    const gate = deferred<void>();
    const locks = { request: vi.fn(async <T>(_name: string, _options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> => { await gate.promise; return callback(); }) };
    const fetcher = vi.fn().mockResolvedValue(response(200, receipt));
    const pending = submit(makeIntent(), storage, fetcher, { locks });
    await Promise.resolve();
    expect(locks.request).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    gate.resolve(undefined);
    expect(await pending).toMatchObject({ status: 'confirmed' });
  });

  it.each(['timeout', 'abort'] as const)('bounds a held lock on %s, prevents late POST, and preserves a newer in-flight latch', async (stop) => {
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const gate = deferred<void>();
    const completed = deferred<void>();
    const locks = { request: vi.fn(async <T>(_name: string, _options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> => {
      await gate.promise; // Deliberately ignores AbortSignal, like an uncooperative lock implementation.
      try { return await callback(); } finally { completed.resolve(undefined); }
    }) };
    const controller = new AbortController();
    const oldFetch = vi.fn();
    const old = submit(makeIntent(), storage, oldFetch, { locks, timeoutMs: 25, signal: controller.signal });
    await Promise.resolve();
    expect(locks.request).toHaveBeenCalledTimes(1);
    if (stop === 'timeout') await vi.advanceTimersByTimeAsync(25);
    else controller.abort();
    expect(await old).toMatchObject({ status: 'refused', pendingRetained: false });
    expect(locks.request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(oldFetch).not.toHaveBeenCalled();

    const nextIntent = makeIntent({ requestId: 'request-next' });
    const nextResponse = deferred<Response>();
    const nextStarted = deferred<void>();
    const nextFetch = vi.fn(() => { nextStarted.resolve(undefined); return nextResponse.promise; });
    const next = submit(nextIntent, storage, nextFetch);
    await nextStarted.promise;
    gate.resolve(undefined);
    await completed.promise;
    // The old completion must not clear the new latch or overwrite its durable identity.
    expect(submit(nextIntent, storage, nextFetch)).toBe(next);
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { requestId: 'request-next', attempted: true } });
    expect(oldFetch).not.toHaveBeenCalled();
    expect(nextFetch).toHaveBeenCalledTimes(1);
    nextResponse.resolve(response(200, receipt));
    expect(await next).toMatchObject({ status: 'confirmed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not erase a prior unknown outcome when lock acquisition times out before this retry can dispatch', async () => {
    vi.useFakeTimers();
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const gate = deferred<void>();
    const completed = deferred<void>();
    const locks = { request: vi.fn(async <T>(_name: string, _options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> => {
      await gate.promise;
      try { return await callback(); } finally { completed.resolve(undefined); }
    }) };
    const fetcher = vi.fn();
    const result = submit(makeIntent(), storage, fetcher, { locks, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 'unknown', pendingRetained: true });
    gate.resolve(undefined);
    await completed.promise;
    expect(values.get(KEY)).toBe(JSON.stringify(saved));
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('consults the memory guard on lock timeout after an unknown durable record disappears', async () => {
    const { storage, values } = memoryStorage();
    await submit(makeIntent(), storage, vi.fn().mockRejectedValue(new Error('Synthetic interruption')));
    values.delete(KEY);
    vi.useFakeTimers();
    const gate = deferred<void>();
    const completed = deferred<void>();
    const locks = { request: vi.fn(async <T>(_name: string, _options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> => {
      await gate.promise;
      try { return await callback(); } finally { completed.resolve(undefined); }
    }) };
    const fetcher = vi.fn();
    const result = submit(makeIntent(), storage, fetcher, { locks, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 'unknown', pendingRetained: true, attempted: true });
    gate.resolve(undefined);
    await completed.promise;
    expect(fetcher).not.toHaveBeenCalled();
    expect(values.has(KEY)).toBe(false);
    expect(await read(storage)).toMatchObject({ status: 'pending', intent: { requestId: ID, attempted: true } });
  });

  it.each(['session binding', 'reason digest'] as const)('includes a stalled %s in the operation deadline and forbids late dispatch', async (phase) => {
    const native = webcrypto as unknown as Crypto;
    const digestGate = deferred<ArrayBuffer>();
    const digestStarted = deferred<void>();
    const completed = deferred<void>();
    let phaseStarted = false;
    let calls = 0;
    let delayedData: BufferSource | undefined;
    const hash = vi.fn((algorithm: AlgorithmIdentifier, data: BufferSource) => {
      if (phaseStarted && ++calls === (phase === 'session binding' ? 1 : 2)) {
        delayedData = data;
        digestStarted.resolve(undefined);
        return digestGate.promise;
      }
      return native.subtle.digest(algorithm, data);
    });
    const slowSession = await createAdminTokenAdjustmentSession(TOKEN, { crypto: { subtle: { digest: hash } as unknown as SubtleCrypto }, now: () => NOW });
    if (!slowSession) throw new Error('Expected synthetic session');
    phaseStarted = true;
    vi.useFakeTimers();
    const { storage } = memoryStorage();
    const locks = { request: vi.fn(async <T>(_name: string, _options: { signal: AbortSignal }, callback: () => Promise<T>): Promise<T> => {
      try { return await callback(); } finally { completed.resolve(undefined); }
    }) };
    const fetcher = vi.fn().mockResolvedValue(response(200, receipt));
    const result = submit(makeIntent(), storage, fetcher, { session: slowSession, locks, timeoutMs: 25 });
    await digestStarted.promise;
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toMatchObject({ status: 'refused', pendingRetained: false });
    digestGate.resolve(await native.subtle.digest('SHA-256', delayedData!));
    await completed.promise;
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function receiptResponse(saved = metadata(makeIntent({ attempted: true }))) {
  return {
    ok: true,
    receipt: { requestId: saved.requestId, requestedUserId: saved.userId, walletId: 'synthetic-wallet-at-commit',
      delta: saved.delta, reasonDigest: saved.reasonDigest, previousBalance: 25, newBalance: 1025,
      committedAt: new Date(NOW).toISOString() },
    currentWallet: { ok: true, canonicalUserId: 'synthetic-current-canonical', storedTokens: 150,
      ownerVisibleTokens: 150, weakEligibleTokens: 150, paidSpendableTokens: 0,
      refreshedAt: new Date(NOW + 1000).toISOString(), paused: true, pauseStateKnown: true, mergeResolutionEnabled: true },
  };
}
function inspectReceipt(storage: AdminTokenAdjustmentStorage, fetcher: unknown, owner = session,
  options: Partial<InspectSavedAdminTokenReceiptOptions> = {}) {
  return inspectSavedAdminTokenReceipt(owner, { headers: { 'x-admin-token': TOKEN }, storage,
    fetch: fetcher as typeof fetch, locks: null, ...options });
}
function acknowledgeReceipt(reviewId: string, storage: AdminTokenAdjustmentStorage, owner = session,
  options: AdminTokenAcknowledgementOptions = {}) {
  return acknowledgeSavedAdminTokenReceipt(owner, storage, { reviewId, locks: immediateLocks, ...options });
}
function nextReviewId(reviewId: string): string {
  return `receipt-review-${Number(reviewId.split('-').at(-1)) + 1}`;
}

describe('read-only immutable receipt recovery after a new login or expiry', () => {
  it('uses only GET to verify a cross-session expired operation, retains its metadata, and explicitly acknowledges it under lock', async () => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const original = values.get(KEY);
    const newToken = 'synthetic-admin-session-b';
    const current = await makeSession(newToken, () => NOW + ADMIN_TOKEN_ADJUSTMENT_TTL_MS + 1);
    expect(await read(storage, current)).toMatchObject({ status: 'blocked' });
    const body = receiptResponse(saved);
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe(`/api/v1/admin/token-adjustments/${ID}/receipt`);
      expect(options.method).toBe('GET');
      expect(options.body).toBeUndefined();
      expect(options.cache).toBe('no-store');
      return response(200, { ...body, reason: 'Synthetic private text must not enter the review',
        receipt: { ...body.receipt, reason: 'Synthetic private text must not enter the review' } });
    });
    const reviewed = await inspectReceipt(storage, fetcher, current, { headers: { 'x-admin-token': newToken } });
    expect(reviewed).toMatchObject({ status: 'confirmed', receipt: body.receipt, currentWallet: body.currentWallet, pendingRetained: true });
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    expect(reviewed.receipt).not.toHaveProperty('reason');
    expect(reviewed.receipt.newBalance).toBe(1025); // Immutable historical operation, not today's balance.
    if (reviewed.currentWallet.ok === false) throw new Error('Expected fresh wallet summary');
    expect(reviewed.currentWallet.storedTokens).toBe(150);
    expect(values.get(KEY)).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(await read(storage, current)).toMatchObject({ status: 'blocked' });
    expect(await acknowledgeReceipt(reviewed.reviewId, storage, current)).toMatchObject({ cleared: true });
    expect(await read(storage, current)).toEqual({ status: 'empty' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reconciles a retained checked POST after its session/age expires and releases only its matching memory guards', async () => {
    const { storage } = memoryStorage();
    const intent = makeIntent();
    await submit(intent, storage, vi.fn().mockResolvedValue(response(200, receipt)));
    const expired = await makeSession(TOKEN, () => NOW + ADMIN_TOKEN_ADJUSTMENT_TTL_MS + 1);
    expect(await acknowledge(intent, storage, expired)).toMatchObject({ cleared: false });
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())), expired);
    if (reviewed.status !== 'confirmed') throw new Error('Expected receipt recovery');
    expect(await acknowledgeReceipt(reviewed.reviewId, storage, expired)).toMatchObject({ cleared: true });
    expect(await read(storage, expired)).toEqual({ status: 'empty' });
  });

  it('keeps the immutable receipt confirmed when the current wallet is unavailable or has explicitly unknown values', async () => {
    for (const currentWallet of [
      { ok: false, refreshedAt: new Date(NOW).toISOString(), reason: 'Synthetic wallet read unavailable' },
      { ...receiptResponse().currentWallet, storedTokens: null, ownerVisibleTokens: null, weakEligibleTokens: null,
        paidSpendableTokens: null, pauseStateKnown: false, mergeResolutionEnabled: false },
    ]) {
      const { storage, values } = memoryStorage();
      values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
      const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, { ...receiptResponse(), currentWallet })));
      expect(reviewed).toMatchObject({ status: 'confirmed', currentWallet });
      if (reviewed.status !== 'confirmed') throw new Error('Expected immutable receipt despite unavailable projection');
      expect(await acknowledgeReceipt(reviewed.reviewId, storage)).toMatchObject({ cleared: true });
    }
  });

  it.each(['requestId', 'requestedUserId', 'delta', 'reasonDigest'] as const)('rejects an immutable %s mismatch without discarding the original intent', async (field) => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const original = values.get(KEY);
    const changes = { requestId: 'request-other', requestedUserId: 'synthetic-other-owner', delta: 2000, reasonDigest: 'a'.repeat(64) };
    const body = receiptResponse(saved);
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, {
      ...body, receipt: { ...body.receipt, [field]: changes[field] },
    })));
    expect(reviewed).toMatchObject({ status: 'unknown', pendingRetained: true });
    expect(reviewed).not.toHaveProperty('receipt');
    expect(values.get(KEY)).toBe(original);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(await acknowledgeSavedAdminTokenReceipt(session, storage, { locks: immediateLocks })).toMatchObject({ cleared: false });
  });

  it.each([404, 401, 403, 500, 200])('retains a saved operation when HTTP %s is not a checked successful receipt', async (status) => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const original = values.get(KEY);
    expect(await inspectReceipt(storage, vi.fn().mockResolvedValue(response(status,
      status === 500 ? receiptResponse() : { error: 'Synthetic receipt unavailable' }))))
      .toMatchObject({ status: 'unknown', pendingRetained: true });
    expect(values.get(KEY)).toBe(original);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['nonfinite', 'invalid-date', 'malformed-wallet', 'network', 'invalid-json'] as const)('does not authorize cleanup after a %s response failure', async (failure) => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const original = values.get(KEY);
    const body = receiptResponse();
    const invalid = failure === 'nonfinite' ? { ...body, receipt: { ...body.receipt, newBalance: Infinity } }
      : failure === 'invalid-date' ? { ...body, receipt: { ...body.receipt, committedAt: 'not-a-date' } }
        : { ...body, currentWallet: { ok: true } };
    const fetcher = failure === 'network' ? vi.fn().mockRejectedValue(new Error('Synthetic network failure'))
      : failure === 'invalid-json' ? vi.fn().mockResolvedValue({ ...response(200, body), json: async () => { throw new Error('Malformed JSON'); } })
        : vi.fn().mockResolvedValue(response(200, invalid));
    expect(await inspectReceipt(storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(values.get(KEY)).toBe(original);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('verifies current credentials before lookup and never exposes a cached proof to another session', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const fetcher = vi.fn().mockResolvedValue(response(200, receiptResponse()));
    expect(await inspectReceipt(storage, fetcher, session, { headers: { 'x-admin-token': 'synthetic-admin-session-b' } }))
      .toMatchObject({ status: 'unknown' });
    expect(fetcher).not.toHaveBeenCalled();
    const reviewed = await inspectReceipt(storage, fetcher);
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    const other = await makeSession('synthetic-admin-session-b');
    expect(await acknowledgeReceipt(reviewed.reviewId, storage, other)).toMatchObject({ cleared: false });
    expect(await acknowledgeSavedAdminTokenReceipt(session, storage, { locks: immediateLocks })).toMatchObject({ cleared: false });
    expect(await acknowledgeReceipt('receipt-review-wrong', storage)).toMatchObject({ cleared: false });
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('a new failed inspection invalidates an old displayed review until a new checked GET succeeds', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const first = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (first.status !== 'confirmed') throw new Error('Expected first review');
    expect(await inspectReceipt(storage, vi.fn().mockResolvedValue(response(404, { error: 'Synthetic missing receipt' }))))
      .toMatchObject({ status: 'unknown' });
    expect(await acknowledgeReceipt(first.reviewId, storage)).toMatchObject({ cleared: false });
    expect(storage.removeItem).not.toHaveBeenCalled();
    const refreshed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (refreshed.status !== 'confirmed') throw new Error('Expected refreshed review');
    expect(refreshed.reviewId).not.toBe(first.reviewId);
    expect(await acknowledgeReceipt(first.reviewId, storage)).toMatchObject({ cleared: false });
    expect(await acknowledgeReceipt(refreshed.reviewId, storage)).toMatchObject({ cleared: true });
  });

  it('retains invalid saved metadata and never guesses a receipt identity from it', async () => {
    for (const raw of ['not-json', JSON.stringify({ ...metadata(), reasonDigest: 'invalid' }), JSON.stringify(makeIntent())]) {
      const { storage, values } = memoryStorage();
      values.set(KEY, raw);
      const fetcher = vi.fn();
      expect(await inspectReceipt(storage, fetcher)).toMatchObject({ status: 'unknown' });
      expect(fetcher).not.toHaveBeenCalled();
      expect(values.get(KEY)).toBe(raw);
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
  });
});

describe('receipt recovery races and bounded acknowledgement', () => {
  it('rejects a newer intent written while GET was in flight without clearing it', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const next = metadata(makeIntent({ requestId: 'request-newer', delta: 2000, attempted: true }));
    const fetcher = vi.fn(async () => { values.set(KEY, JSON.stringify(next)); return response(200, receiptResponse()); });
    expect(await inspectReceipt(storage, fetcher)).toMatchObject({ status: 'unknown' });
    expect(values.get(KEY)).toBe(JSON.stringify(next));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('checks the exact snapshot again after acknowledgement acquires the shared lock', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    const gate = deferred<void>();
    const entered = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      entered.resolve(undefined); await gate.promise; return callback();
    } };
    const clearing = acknowledgeReceipt(reviewed.reviewId, storage, session, { locks });
    await entered.promise;
    const newer = metadata(makeIntent({ requestId: 'request-newer', delta: 2000, attempted: true }));
    values.set(KEY, JSON.stringify(newer)); // Another tab completed its write while this acknowledgement waited.
    gate.resolve(undefined);
    expect(await clearing).toMatchObject({ cleared: false });
    expect(values.get(KEY)).toBe(JSON.stringify(newer));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('requires secure lock support for both receipt acknowledgement and ordinary Done', async () => {
    const ordinary = memoryStorage();
    const intent = makeIntent();
    await submit(intent, ordinary.storage, vi.fn().mockResolvedValue(response(200, receipt)));
    const refused = await acknowledge(intent, ordinary.storage, session, { locks: null });
    expect(refused).toMatchObject({ cleared: false });
    expect(refused.message).toContain('locking is unavailable');
    expect(ordinary.storage.removeItem).not.toHaveBeenCalled();
    const recovered = memoryStorage();
    recovered.values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const reviewed = await inspectReceipt(recovered.storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    expect(await acknowledgeReceipt(reviewed.reviewId, recovered.storage, session, { locks: null })).toMatchObject({ cleared: false });
    expect(recovered.storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort'] as const)('does not allow a %s acknowledgement to clear after its late lock callback runs', async (stop) => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    vi.useFakeTimers();
    const gate = deferred<void>();
    const completed = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      await gate.promise;
      try { return await callback(); } finally { completed.resolve(undefined); }
    } };
    const controller = new AbortController();
    const clearing = acknowledgeReceipt(reviewed.reviewId, storage, session, { locks, signal: controller.signal, timeoutMs: 25 });
    await Promise.resolve();
    if (stop === 'timeout') await vi.advanceTimersByTimeAsync(25);
    else controller.abort();
    expect(await clearing).toMatchObject({ cleared: false });
    gate.resolve(undefined);
    await completed.promise;
    expect(values.has(KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds ordinary Done while waiting for its lock and never removes a newer record on late completion', async () => {
    const { storage, values } = memoryStorage();
    const intent = makeIntent();
    await submit(intent, storage, vi.fn().mockResolvedValue(response(200, receipt)));
    vi.useFakeTimers();
    const gate = deferred<void>();
    const completed = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      await gate.promise;
      try { return await callback(); } finally { completed.resolve(undefined); }
    } };
    const clearing = acknowledge(intent, storage, session, { locks, timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await clearing).toMatchObject({ cleared: false });
    const newer = metadata(makeIntent({ requestId: 'request-newer', attempted: true }));
    values.set(KEY, JSON.stringify(newer));
    gate.resolve(undefined);
    await completed.promise;
    expect(values.get(KEY)).toBe(JSON.stringify(newer));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'abort'] as const)('cannot cache a late receipt response after %s', async (stop) => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const previous = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (previous.status !== 'confirmed') throw new Error('Expected previous receipt');
    vi.useFakeTimers();
    const delayed = deferred<Response>();
    const started = deferred<void>();
    const completed = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      try { return await callback(); } finally { completed.resolve(undefined); }
    } };
    const controller = new AbortController();
    const lookup = inspectReceipt(storage, vi.fn(() => { started.resolve(undefined); return delayed.promise; }), session,
      { locks, timeoutMs: 25, signal: controller.signal });
    await started.promise;
    if (stop === 'timeout') await vi.advanceTimersByTimeAsync(25);
    else controller.abort();
    expect(await lookup).toMatchObject({ status: 'unknown' });
    delayed.resolve(response(200, receiptResponse()));
    await completed.promise;
    expect(await acknowledgeReceipt(previous.reviewId, storage)).toMatchObject({ cleared: false });
    expect(await acknowledgeReceipt(nextReviewId(previous.reviewId), storage)).toMatchObject({ cleared: false });
    expect(values.has(KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('does not let an older session lookup overwrite a newer checked inspection', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const delayed = deferred<Response>();
    const started = deferred<void>();
    const old = inspectReceipt(storage, vi.fn(() => { started.resolve(undefined); return delayed.promise; }));
    await started.promise;
    const newToken = 'synthetic-admin-session-b';
    const current = await makeSession(newToken);
    const latest = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())), current,
      { headers: { 'x-admin-token': newToken } });
    if (latest.status !== 'confirmed') throw new Error('Expected newer checked receipt');
    delayed.resolve(response(200, receiptResponse()));
    expect(await old).toMatchObject({ status: 'unknown' });
    expect(await acknowledgeReceipt(latest.reviewId, storage, session)).toMatchObject({ cleared: false });
    expect(await acknowledgeReceipt(latest.reviewId, storage, current)).toMatchObject({ cleared: true });
  });

  it('retains cleanup failure and permits a new checked review after its own removal readback failed', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    storage.removeItem.mockImplementation((key) => {
      values.delete(key);
      storage.getItem.mockImplementationOnce(() => { throw new Error('Synthetic readback failure'); });
    });
    expect(await acknowledgeReceipt(reviewed.reviewId, storage)).toMatchObject({ cleared: false });
    expect(values.has(KEY)).toBe(false);
    expect(await read(storage)).toMatchObject({ status: 'blocked' });
    const newGrant = vi.fn();
    expect(await submit(makeIntent({ requestId: 'request-new-grant' }), storage, newGrant)).toMatchObject({ status: 'unknown' });
    expect(newGrant).not.toHaveBeenCalled();
    const refreshed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (refreshed.status !== 'confirmed') throw new Error('Expected recovery of checked removal');
    expect(await acknowledgeReceipt(reviewed.reviewId, storage)).toMatchObject({ cleared: false });
    expect(await acknowledgeReceipt(refreshed.reviewId, storage)).toMatchObject({ cleared: true });
    expect(await read(storage)).toEqual({ status: 'empty' });
  });

  it('does not authorize a new intent by mutating a caller-visible checked DTO', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    reviewed.receipt.requestId = 'request-newer';
    reviewed.receipt.delta = 2000;
    const newer = metadata(makeIntent({ requestId: 'request-newer', delta: 2000, attempted: true }));
    values.set(KEY, JSON.stringify(newer));
    expect(await acknowledgeReceipt(reviewed.reviewId, storage)).toMatchObject({ cleared: false });
    expect(values.get(KEY)).toBe(JSON.stringify(newer));
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('compares raw snapshot bytes, not only an equivalent reserialized operation, before clearing', async () => {
    const { storage, values } = memoryStorage();
    const saved = metadata(makeIntent({ attempted: true }));
    values.set(KEY, JSON.stringify(saved));
    const reviewed = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (reviewed.status !== 'confirmed') throw new Error('Expected checked receipt');
    const replacement = JSON.stringify(saved, null, 2);
    values.set(KEY, replacement);
    expect(await acknowledgeReceipt(reviewed.reviewId, storage)).toMatchObject({ cleared: false });
    expect(values.get(KEY)).toBe(replacement);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('bounds receipt lock acquisition and forbids a GET from a late lock callback', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    vi.useFakeTimers();
    const gate = deferred<void>();
    const entered = deferred<void>();
    const completed = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      entered.resolve(undefined); await gate.promise;
      try { return await callback(); } finally { completed.resolve(undefined); }
    } };
    const fetcher = vi.fn();
    const lookup = inspectReceipt(storage, fetcher, session, { locks, timeoutMs: 25 });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(25);
    expect(await lookup).toMatchObject({ status: 'unknown' });
    gate.resolve(undefined);
    await completed.promise;
    expect(fetcher).not.toHaveBeenCalled();
    expect(values.has(KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('includes receipt JSON parsing in the deadline and cannot cache a late body', async () => {
    const { storage, values } = memoryStorage();
    values.set(KEY, JSON.stringify(metadata(makeIntent({ attempted: true }))));
    const old = await inspectReceipt(storage, vi.fn().mockResolvedValue(response(200, receiptResponse())));
    if (old.status !== 'confirmed') throw new Error('Expected original review');
    vi.useFakeTimers();
    const body = deferred<unknown>();
    const started = deferred<void>();
    const completed = deferred<void>();
    const locks: AdminTokenAdjustmentLocks = { request: async (_name, _options, callback) => {
      try { return await callback(); } finally { completed.resolve(undefined); }
    } };
    const fetcher = vi.fn(async () => ({ ...response(200, {}), json: () => { started.resolve(undefined); return body.promise; } }));
    const lookup = inspectReceipt(storage, fetcher, session, { locks, timeoutMs: 25 });
    await started.promise;
    await vi.advanceTimersByTimeAsync(25);
    expect(await lookup).toMatchObject({ status: 'unknown' });
    body.resolve(receiptResponse());
    await completed.promise;
    expect(await acknowledgeReceipt(nextReviewId(old.reviewId), storage)).toMatchObject({ cleared: false });
    expect(values.has(KEY)).toBe(true);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
