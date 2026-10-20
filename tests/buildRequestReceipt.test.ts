import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD_REQUEST_CALL_TIMEOUT_MS, BUILD_REQUEST_COLLECTION, buildRequestIdentity, buildRequestInputDigest,
  completeBuildRequest, reserveBuildRequest, validBuildRequestId,
  type BuildRequestReceipt, type BuildRequestStore,
} from '../src/server/lib/buildRequestReceipt';

const REQUEST = '12345678-1234-4123-8123-123456789abc';
const ATTEMPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER = 'owner';
const WORKSPACE = 'agentv3-owner-session123';
const args = (extra: Record<string, unknown> = {}) => ({
  ownerId: OWNER, workspaceId: WORKSPACE, requestId: REQUEST, attemptId: ATTEMPT_A,
  input: { requestId: REQUEST, prompt: 'Build my app', powerLevel: 'normal', options: { backend: true } }, nowMs: 1000,
  ...extra,
});
const key = (owner = OWNER, workspace = WORKSPACE, request = REQUEST) =>
  `${BUILD_REQUEST_COLLECTION}/${buildRequestIdentity(owner, workspace, request).id}`;

/** Buffered optimistic transactions: no partial state, real revision conflicts, callback re-execution. */
class ReceiptDb implements BuildRequestStore {
  rows = new Map<string, unknown>();
  versions = new Map<string, number>();
  attempts = 0;
  writes = 0;
  rejectNextCommit = false;
  loseNextAcknowledgement = false;
  beforeCommit?: () => Promise<void>;
  collection(name: string) { return { doc: (id: string) => `${name}/${id}` }; }
  put(path: string, value: unknown) { this.rows.set(path, structuredClone(value)); this.versions.set(path, (this.versions.get(path) ?? 0) + 1); }
  async runTransaction<T>(body: Parameters<BuildRequestStore['runTransaction']>[0]): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      this.attempts++;
      const reads = new Map<string, number>();
      const pending = new Map<string, BuildRequestReceipt>();
      const result = await body({
        get: async (path: string) => {
          if (pending.size) throw new Error('read after write');
          reads.set(path, this.versions.get(path) ?? 0);
          const value = structuredClone(this.rows.get(path));
          return { exists: value !== undefined, data: () => structuredClone(value) };
        },
        set: (path: string, row: BuildRequestReceipt) => { pending.set(path, structuredClone(row)); },
      });
      await this.beforeCommit?.();
      if ([...reads].some(([path, version]) => (this.versions.get(path) ?? 0) !== version)) continue;
      if (pending.size && this.rejectNextCommit) { this.rejectNextCommit = false; throw new Error('atomic commit rejected'); }
      for (const [path, row] of pending) { this.put(path, row); this.writes++; }
      if (pending.size && this.loseNextAcknowledgement) { this.loseNextAcknowledgement = false; throw new Error('commit acknowledgement lost'); }
      return result as T;
    }
    throw new Error('retry limit');
  }
}

async function accepted(db: ReceiptDb, extra: Record<string, unknown> = {}) {
  const result = await reserveBuildRequest(db, args(extra));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.receipt;
}

afterEach(() => vi.useRealTimers());

describe('execution input identity', () => {
  it('accepts UUIDs and rejects absent, arbitrary and nil ids', () => {
    expect(validBuildRequestId(REQUEST)).toBe(true);
    expect(validBuildRequestId(REQUEST.toUpperCase())).toBe(true);
    for (const id of ['', undefined, null, 'a/b', 'request-1', 12, '00000000-0000-0000-0000-000000000000']) {
      expect(validBuildRequestId(id)).toBe(false);
    }
  });

  it('uses owner/workspace/request scope and stable billing identity independently of attempt/start time', () => {
    expect(buildRequestIdentity(OWNER, WORKSPACE, REQUEST)).toEqual(buildRequestIdentity(OWNER, WORKSPACE, REQUEST.toUpperCase()));
    expect(buildRequestIdentity('other', WORKSPACE, REQUEST)).not.toEqual(buildRequestIdentity(OWNER, WORKSPACE, REQUEST));
    expect(buildRequestIdentity(OWNER, `${WORKSPACE}-other`, REQUEST)).not.toEqual(buildRequestIdentity(OWNER, WORKSPACE, REQUEST));
    expect(buildRequestIdentity(OWNER, WORKSPACE, REQUEST).buildRef).toMatch(/^build-request_[a-f0-9]{64}$/);
  });

  it('canonicalizes object order recursively but preserves array order and each execution value', () => {
    const digest = buildRequestInputDigest({ prompt: 'p', options: { a: 1, b: [2, 3] }, requestId: REQUEST });
    expect(digest).toBe(buildRequestInputDigest({ requestId: 'different transport field', options: { b: [2, 3], a: 1 }, prompt: 'p' }));
    for (const input of [
      { prompt: 'q', options: { a: 1, b: [2, 3] } },
      { prompt: 'p', options: { a: 1, b: [3, 2] } },
      { prompt: 'p', options: { a: 1, b: [2, 3] }, powerLevel: 'strong' },
      { prompt: 'p', options: { a: 1, b: [2, 3], requestId: 'nested execution field' } },
    ]) expect(buildRequestInputDigest(input)).not.toBe(digest);
  });

  it('follows JSON missing-value semantics without ambiguous non-JSON or cyclic inputs', () => {
    expect(buildRequestInputDigest({ a: undefined, b: [undefined, -0] })).toBe(buildRequestInputDigest({ b: [null, 0] }));
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [cycle, { a: NaN }, { a: Infinity }, { a: () => 1 }, new Date(), { a: 1n }]) {
      expect(() => buildRequestInputDigest(value)).toThrow();
    }
    const getter = Object.defineProperty({}, 'a', { enumerable: true, get() { throw new Error('getter invoked'); } });
    expect(() => buildRequestInputDigest(getter)).toThrow('plain JSON');
  });
});

describe('durable request admission and terminal replay protection', () => {
  it('persists only the bounded receipt, never raw execution input or a reusable provider credential', async () => {
    const db = new ReceiptDb();
    const receipt = await accepted(db, { input: { prompt: 'private prompt', secret: 'provider-secret', options: { images: ['private-image'] } } });
    expect(db.rows.get(key())).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(/private prompt|provider-secret|private-image/);
    expect(Object.keys(receipt).sort()).toEqual(['attemptId', 'buildRef', 'createdAt', 'digest', 'id', 'ownerId', 'requestId', 'state', 'updatedAt', 'version', 'workspaceId']);
  });

  it.each([
    { ownerId: 'other' }, { ownerId: '' }, { ownerId: 'anon', workspaceId: 'agentv3-anon-session123' },
    { workspaceId: 'agentv3-other-session123' }, { workspaceId: 'agentv3-owner-../escape' },
  ])('refuses unowned/anonymous/unsafe workspace before store access: %j', async (input) => {
    const db = new ReceiptDb();
    expect(await reserveBuildRequest(db, args(input))).toEqual({ ok: false, code: 'forbidden' });
    expect(db.attempts).toBe(0); expect(db.rows.size).toBe(0);
  });

  it('fails closed for invalid input, missing store and failed commit, without a durable execution permission', async () => {
    const db = new ReceiptDb();
    expect(await reserveBuildRequest(db, args({ requestId: 'not-uuid' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await reserveBuildRequest(db, args({ attemptId: '' }))).toEqual({ ok: false, code: 'invalid' });
    expect(await reserveBuildRequest(db, args({ input: { x: NaN } }))).toEqual({ ok: false, code: 'invalid' });
    expect(await reserveBuildRequest(null, args())).toEqual({ ok: false, code: 'unavailable' });
    db.rejectNextCommit = true;
    expect(await reserveBuildRequest(db, args())).toEqual({ ok: false, code: 'unavailable' });
    expect(db.rows.size).toBe(0);
    expect((await reserveBuildRequest(db, args({ attemptId: ATTEMPT_B }))).ok).toBe(true);
  });

  it('admits exactly one concurrent owner and never grants an existing running receipt, even to the same attempt', async () => {
    const db = new ReceiptDb();
    let arrivals = 0; let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    db.beforeCommit = async () => { if (++arrivals === 2) release(); await ready; };
    const results = await Promise.all([
      reserveBuildRequest(db, args()), reserveBuildRequest(db, args({ attemptId: ATTEMPT_B })),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: 'in-progress' });
    expect(db.attempts).toBe(3);
    expect(db.rows.size).toBe(1); expect(db.writes).toBe(1);
    expect(await reserveBuildRequest(db, args())).toMatchObject({ ok: false, code: 'in-progress' });
  });

  it('rejects changed execution inputs for the same UUID without replacing the original receipt', async () => {
    const db = new ReceiptDb(); const receipt = await accepted(db);
    expect(await reserveBuildRequest(db, args({ input: { prompt: 'different', powerLevel: 'strong' } })))
      .toEqual({ ok: false, code: 'input-mismatch' });
    expect(db.rows.get(key())).toEqual(receipt); expect(db.writes).toBe(1);
  });

  it.each(['complete', 'failed', 'stopped', 'unknown'] as const)('terminal %s is immutable and never restarts', async (outcome) => {
    const db = new ReceiptDb(); const receipt = await accepted(db);
    const terminal = await completeBuildRequest(db, receipt, outcome, 2000);
    expect(terminal).toMatchObject({ ok: true, receipt: { state: 'terminal', outcome, updatedAt: 2000 } });
    const writes = db.writes;
    expect(await completeBuildRequest(db, receipt, outcome, 3000)).toEqual(terminal);
    expect(db.writes).toBe(writes);
    expect(await reserveBuildRequest(db, args({ attemptId: ATTEMPT_B, nowMs: 10_000_000_000 })))
      .toMatchObject({ ok: false, code: 'terminal', receipt: { buildRef: receipt.buildRef, outcome } });
    expect(await completeBuildRequest(db, receipt, outcome === 'complete' ? 'failed' : 'complete'))
      .toEqual({ ok: false, code: 'stale' });
  });

  it('a stale or forged completion cannot alter an accepted receipt or create a missing one', async () => {
    const db = new ReceiptDb(); const receipt = await accepted(db);
    for (const forged of [{ ...receipt, attemptId: ATTEMPT_B }, { ...receipt, digest: '0'.repeat(64) }]) {
      expect(await completeBuildRequest(db, forged, 'complete')).toEqual({ ok: false, code: 'stale' });
    }
    expect(await completeBuildRequest(db, { ...receipt, ownerId: 'other' }, 'complete')).toEqual({ ok: false, code: 'invalid' });
    const fresh = new ReceiptDb();
    expect(await completeBuildRequest(fresh, receipt, 'complete')).toEqual({ ok: false, code: 'stale' });
    expect(fresh.rows.size).toBe(0); expect(db.rows.get(key())).toEqual(receipt);
  });

  it('does not turn a corrupted existing record into execution permission', async () => {
    const db = new ReceiptDb(); db.put(key(), { version: 1, state: 'running' });
    const before = structuredClone(db.rows.get(key()));
    expect(await reserveBuildRequest(db, args())).toEqual({ ok: false, code: 'unavailable' });
    expect(db.rows.get(key())).toEqual(before); expect(db.writes).toBe(0);
  });

  it('unknown in-progress receipts survive process reload and age without ever being reclaimed', async () => {
    const db = new ReceiptDb(); const receipt = await accepted(db);
    vi.resetModules();
    const fresh = await import('../src/server/lib/buildRequestReceipt');
    expect(await fresh.reserveBuildRequest(db, args({ nowMs: 10_000_000_000, attemptId: ATTEMPT_B })))
      .toMatchObject({ ok: false, code: 'in-progress', receipt: { buildRef: receipt.buildRef } });
    expect(db.rows.get(key())).toEqual(receipt);
  });

  it('a reservation committed without acknowledgement never allows a retry to execute', async () => {
    const db = new ReceiptDb(); db.loseNextAcknowledgement = true;
    expect(await reserveBuildRequest(db, args())).toEqual({ ok: false, code: 'unavailable' });
    expect(db.rows.size).toBe(1);
    expect(await reserveBuildRequest(db, args({ attemptId: ATTEMPT_B })))
      .toMatchObject({ ok: false, code: 'in-progress' });
    expect(db.writes).toBe(1);
  });

  it('a timeout is not permission, and a late reservation commit still blocks a new attempt', async () => {
    vi.useFakeTimers();
    const db = new ReceiptDb(); let release!: () => void;
    db.beforeCommit = () => new Promise<void>((resolve) => { release = resolve; });
    const reservation = reserveBuildRequest(db, args());
    await vi.advanceTimersByTimeAsync(BUILD_REQUEST_CALL_TIMEOUT_MS);
    expect(await reservation).toEqual({ ok: false, code: 'unavailable' });
    release(); await vi.advanceTimersByTimeAsync(0); db.beforeCommit = undefined;
    expect(db.rows.size).toBe(1);
    expect(await reserveBuildRequest(db, args({ attemptId: ATTEMPT_B })))
      .toMatchObject({ ok: false, code: 'in-progress' });
  });

  it('an uncertain terminal commit remains terminal on retry rather than resurrecting a completed request', async () => {
    const db = new ReceiptDb(); const receipt = await accepted(db); db.loseNextAcknowledgement = true;
    expect(await completeBuildRequest(db, receipt, 'complete', 2000)).toEqual({ ok: false, code: 'unavailable' });
    expect(await reserveBuildRequest(db, args({ attemptId: ATTEMPT_B }))).toMatchObject({ ok: false, code: 'terminal' });
    expect(await completeBuildRequest(db, receipt, 'complete', 3000))
      .toMatchObject({ ok: true, receipt: { state: 'terminal', outcome: 'complete', updatedAt: 2000 } });
  });
});
