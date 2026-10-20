import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuildRequestCoordination, normalQueuedModuleRetirementAllowed, startBuildLeaseHeartbeat } from '../src/server/AgentV3/BuildRequestCoordination';
import { BUILD_QUEUE_COLLECTION, createBuildQueueStore, __bindBuildQueueDbForTests, type QueueDb } from '../src/server/AgentV3/BuildQueueStore';
import { enqueue, emptyQueue, serializeQueue } from '../src/server/AgentV3/BuildQueue';
import { BUILD_REQUEST_COLLECTION, type BuildRequestStore } from '../src/server/lib/buildRequestReceipt';
import { claimWorkspaceBuild, releaseWorkspaceBuild, LEASE_HEARTBEAT_MS, WORKSPACE_BUILD_LEASE_COLLECTION, type BuildLeaseStore } from '../src/server/AgentV3/workspaceBuildLease';
import type { RunningBuild } from '../src/server/AgentV3/runningBuildRegistry';
import { createBuildSourcePublication } from '../src/server/AgentV3/BuildSourcePublication';
import { persistBuildAssets } from '../src/server/AgentV3/buildAssets';
import { withTimeout } from '../src/server/AgentV3/asyncUtils';

const WS = 'agentv3-owner-session123';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const R3 = '33333333-3333-4333-8333-333333333333';

/** Buffered optimistic commits with callback replay and an explicit post-commit ACK-loss fault. */
function database() {
  const docs = new Map<string, any>();
  const versions = new Map<string, number>();
  let loseNextAck = false;
  let unavailable = false;
  let afterCommit: ((deletes: Set<string>) => Promise<void>) | undefined;
  const db: QueueDb & BuildRequestStore & BuildLeaseStore = {
    collection: (name) => ({ doc: (id) => ({ key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
    runTransaction: async (body: any) => {
      for (let tries = 0; tries < 12; tries++) {
        if (unavailable) throw Error('UNAVAILABLE');
        const reads = new Map<string, number>();
        const writes = new Map<string, any>();
        const deleted = new Set<string>();
        const result = await body({
          get: async (ref: any) => { if (writes.size || deleted.size) throw Error('read after write'); reads.set(ref.key, versions.get(ref.key) ?? 0); return snapshot(ref.key); },
          set: (ref: any, value: any) => writes.set(ref.key, structuredClone(value)),
          delete: (ref: any) => deleted.add(ref.key),
        });
        await Promise.resolve();
        if ([...reads].some(([key, version]) => (versions.get(key) ?? 0) !== version)) continue;
        for (const key of deleted) { docs.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1); }
        for (const [key, value] of writes) { docs.set(key, value); versions.set(key, (versions.get(key) ?? 0) + 1); }
        if ((writes.size || deleted.size) && loseNextAck) { loseNextAck = false; throw Error('committed acknowledgement lost'); }
        await afterCommit?.(deleted);
        return result;
      }
      throw Error('contention exceeded');
    },
  };
  function snapshot(key: string) { return { exists: docs.has(key), data: () => structuredClone(docs.get(key)) }; }
  const queue = createBuildQueueStore(db);
  let initial = emptyQueue(WS);
  for (const id of ['A', 'B']) initial = enqueue(initial, { id, prompt: `Build step ${id}`, source: 'planner', createdTs: 1 }).queue;
  docs.set(`${BUILD_QUEUE_COLLECTION}/${WS}`, { queue: serializeQueue(initial) });
  __bindBuildQueueDbForTests(db);
  return { db, docs, queue, loseAck: () => { loseNextAck = true; }, offline: () => { unavailable = true; }, online: () => { unavailable = false; },
    holdRetirementAck: () => { let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; }); afterCommit = async (deleted) => { if (deleted.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)) await held; }; return release; } };
}
afterEach(() => { __bindBuildQueueDbForTests(undefined); vi.useRealTimers(); });

async function firstWindow(capable = true) {
  const f = database();
  const claimed = (await f.queue.claim(WS, 'claim-A')).result!;
  expect((await claimWorkspaceBuild(f.db, { workspaceId: WS, token: A, owner: 'worker-A' })).ok).toBe(true);
  const options = { workspaceId: WS, ownerId: 'owner', attemptId: A,
    input: { prompt: claimed.prompt, requestId: R1, queueItemId: claimed.id, queueClaimToken: claimed.claimToken, ...(capable ? { queueContinuationProtocol: 1 } : {}) },
    prompt: () => claimed.prompt, store: () => f.db };
  const request = createBuildRequestCoordination(options);
  expect(await request.admit()).toBeNull();
  const events: any[] = [];
  const publish = (event: any) => request.publish(event, (value) => events.push(value));
  return { ...f, options, request, events, publish };
}
const moduleResult = { type: 'result', ok: true, resumable: true, planRemaining: 3, summary: 'Module complete; three remain.', steps: 2, billedUsd: 0.25, billedInr: 20 };
function nextOptions(f: Awaited<ReturnType<typeof firstWindow>>, handoff: any, attemptId = B, requestId = R2) {
  return { workspaceId: WS, ownerId: 'owner', attemptId,
    input: { prompt: 'continue', requestId, queueItemId: 'A', queueClaimToken: 'claim-A', queueContinuationProtocol: 1, queueContinuationNonce: handoff.nonce, queuePredecessorAttemptId: handoff.predecessorAttemptId },
    prompt: () => 'continue', store: () => f.db };
}

describe('real queue/request coordination across normal successful module windows', () => {
  it('keeps A active through pending/ready/next window and only completes A on its final result', async () => {
    const f = await firstWindow();
    f.publish(moduleResult);
    await f.request.flushPublication();
    const handoff = f.events.find((e) => e.type === 'result').queueContinuation;
    expect(handoff).toMatchObject({ itemId: 'A', state: 'pending', predecessorAttemptId: A, planRemaining: 3, ordinal: 1 });
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', continuation: { phase: 'pending' } });
    expect((await f.queue.claim(WS)).result).toBeNull();
    expect(await f.request.retireNormalModule(true)).toBe(true);
    expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(false);
    await f.request.release();
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', continuation: { phase: 'ready' } });
    expect((await f.queue.claim(WS)).result).toBeNull();
    expect((await claimWorkspaceBuild(f.db, { workspaceId: WS, token: B, owner: 'worker-B' })).ok).toBe(true);
    const next = createBuildRequestCoordination(nextOptions(f, handoff));
    expect(await next.admit()).toBeNull();
    expect(next.billingRef('legacy')).not.toBe(f.request.billingRef('legacy'));
    expect(next.billingRef('another fallback')).toBe(next.billingRef('legacy'));
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', boundAttemptId: B, continuationWindow: { requestId: R2 } });
    next.publish({ type: 'result', ok: true, summary: 'All modules complete.' }, () => {});
    await next.release();
    expect((await f.queue.load(WS)).items.map((i) => [i.id, i.status])).toEqual([['A', 'done'], ['B', 'pending']]);
    expect((await f.queue.claim(WS)).result).toBeNull(); // The successor still owns its normal lease.
    await releaseWorkspaceBuild(f.db, { workspaceId: WS, token: B });
    expect((await f.queue.claim(WS)).result?.id).toBe('B');
    const receipts = [...f.docs.entries()].filter(([key]) => key.startsWith(BUILD_REQUEST_COLLECTION + '/')).map(([, value]) => value);
    expect(receipts).toHaveLength(2);
    expect(receipts.every((receipt) => receipt.state === 'terminal' && receipt.outcome === 'complete')).toBe(true);
  });

  it('generic release cannot open a pending handoff, including a late result after premature release', async () => {
    const f = await firstWindow();
    await f.request.release();
    f.publish(moduleResult);
    await f.request.flushPublication();
    expect(f.events.find((e) => e.type === 'result')).toMatchObject({ resumable: false, code: 'QUEUE_CONTINUATION_UNAVAILABLE' });
    expect(f.events.find((e) => e.type === 'result')).not.toHaveProperty('queuePaused'); // The old binding already settled; this late event cannot claim a fresh pause ACK.
    expect(await f.request.retireNormalModule(true)).toBe(false);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
  });

  it.each(['error', 'abort', 'deadline', 'generic-release'] as const)('never makes a proposed handoff ready after %s', async (cause) => {
    const f = await firstWindow();
    f.publish(moduleResult);
    await f.request.flushPublication();
    if (cause === 'error') f.publish({ type: 'error', message: 'cleanup failed' });
    if (cause === 'generic-release') await f.request.release();
    const signal = new AbortController();
    if (cause === 'abort') signal.abort();
    const eligible = normalQueuedModuleRetirementAllowed(signal.signal, { requiresBodyExit: cause === 'deadline' });
    expect(await f.request.retireNormalModule(eligible)).toBe(false);
    expect((await f.queue.load(WS)).items[0].continuation).toBeUndefined();
    expect((await f.queue.load(WS)).paused).toBe(true);
  });

  it('old bundled clients get an honest module pause without a false logical completion', async () => {
    const f = await firstWindow(false);
    f.publish(moduleResult);
    await f.request.flushPublication();
    await f.request.retireNormalModule(true);
    await f.request.release();
    expect(f.events.find((e) => e.type === 'result')).toMatchObject({ ok: true, resumable: false, billedUsd: 0.25, billedInr: 20, queuePaused: true });
    expect(f.events.some((e) => e.type === 'narration' && e.text.includes('paused for review'))).toBe(true);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ id: 'A', status: 'failed' }, { id: 'B', status: 'pending' }] });
  });

  it('lost proposal acknowledgement suppresses automatic continuation even though the write committed', async () => {
    const f = await firstWindow();
    f.loseAck(); f.publish(moduleResult);
    await f.request.flushPublication();
    expect(f.events.find((e) => e.type === 'result')).toMatchObject({ resumable: false, code: 'QUEUE_CONTINUATION_UNAVAILABLE' });
    expect(await f.request.retireNormalModule(true)).toBe(false);
    expect((await f.queue.load(WS)).paused).toBe(true);
  });

  it('unknown durable pause is never acknowledged as queuePaused', async () => {
    const f = await firstWindow(false);
    f.offline(); f.publish(moduleResult);
    await f.request.flushPublication();
    const result = f.events.find((e) => e.type === 'result');
    expect(result).toMatchObject({ resumable: false, code: 'QUEUE_CONTINUATION_UNAVAILABLE' });
    expect(result).not.toHaveProperty('queuePaused');
    expect(result.summary).toContain('could not be confirmed');
    f.online(); await f.request.release();
  });

  it.each([true, false])('a second non-resumable result invalidates the earlier intermediate result (ok=%s)', async (ok) => {
    const f = await firstWindow();
    f.publish(moduleResult); await f.request.flushPublication();
    f.publish({ type: 'result', ok, resumable: false, summary: 'late replacement result' });
    await f.request.flushPublication();
    expect(await f.request.retireNormalModule(true)).toBe(false);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
    expect(f.events.at(-1)).toMatchObject({ resumable: false, queuePaused: true });
  });

  it('an earlier recoverable tool error does not prevent a later successful normal module handoff', async () => {
    const f = await firstWindow();
    f.publish({ type: 'error', message: 'recoverable fixture tool error' });
    f.publish(moduleResult); await f.request.flushPublication();
    expect(await f.request.retireNormalModule(true)).toBe(true);
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', continuation: { phase: 'ready' } });
  });

  it('a deadline/advisory app success is not proof that logical queued A completed', async () => {
    const f = await firstWindow();
    f.request.invalidateQueuedWindow();
    f.publish({ type: 'result', ok: true, summary: 'The app rendered before the advisory cap.', billedUsd: 0.25 });
    await f.request.flushPublication();
    expect(await f.request.retireNormalModule(false)).toBe(false);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
    expect(f.events.find((e) => e.type === 'result')).toMatchObject({ ok: true, billedUsd: 0.25, resumable: false });
  });

  it('joins source publication before sealing and refuses an error that arrives during that join', async () => {
    const f = await firstWindow(); f.publish(moduleResult); await f.request.flushPublication();
    let finish!: (value: boolean) => void; const source = new Promise<boolean>((resolve) => { finish = resolve; });
    const closed = vi.fn(async () => true);
    const retirement = f.request.retireNormalModule(true, closed, () => source);
    await Promise.resolve(); f.publish({ type: 'error', message: 'late owned source failure' });
    finish(true); expect(await retirement).toBe(false);
    expect(closed).not.toHaveBeenCalled();
    expect((await f.queue.load(WS)).paused).toBe(true);
  });

  it.each([false, true])('an asset report timeout pauses automatic handoff even if the raw save later finishes (stillPending=%s)', async (stillPending) => {
    vi.useFakeTimers();
    const f = await firstWindow();
    const source = createBuildSourcePublication();
    let finishSave!: () => void;
    const saved = new Promise<void>((resolve) => { finishSave = resolve; });
    const assets = new Map<string, string>();
    let saveStarted = false;
    const rawAssets = source.track(persistBuildAssets({
      listFiles: async () => ['public/logo.png'], readBinaryFile: async () => 'YWJj',
    }, WS, {
      heldPaths: async () => [],
      save: async (_workspace, files) => { saveStarted = true; await saved; assets.set('public/logo.png', files['public/logo.png']); },
    }));
    const reported = source.track(withTimeout(rawAssets, 20_000, 'build-assets')).catch(() => 'timed-out');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await reported).toBe('timed-out');
    expect(saveStarted).toBe(true);
    f.publish(moduleResult); await f.request.flushPublication();
    const closeDelivery = vi.fn(async () => true);
    expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('pending');
    expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(true);
    if (!stillPending) { finishSave(); await rawAssets; }
    const retirement = f.request.retireNormalModule(
      () => normalQueuedModuleRetirementAllowed(new AbortController().signal, {}, !source.uncertain()),
      closeDelivery, () => source.join());
    if (stillPending) await vi.advanceTimersByTimeAsync(15_000);
    expect(await retirement).toBe(false);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
    expect(closeDelivery).not.toHaveBeenCalled();
    expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(true);
    finishSave(); await rawAssets; // A timeout did not physically cancel the old storage call.
    expect(assets.get('public/logo.png')).toBe('data:image/png;base64,YWJj');
    expect((await f.queue.load(WS)).items[0].continuation).toBeUndefined();
  });

  it('rechecks actual Stop eligibility after delayed delivery cleanup instead of using a captured boolean', async () => {
    const f = await firstWindow(); f.publish(moduleResult); await f.request.flushPublication();
    const stop = new AbortController(); let finish!: (value: boolean) => void;
    const delivery = new Promise<boolean>((resolve) => { finish = resolve; });
    let closing = false;
    const retirement = f.request.retireNormalModule(() => !stop.signal.aborted, () => { closing = true; return delivery; });
    for (let i = 0; i < 30 && !closing; i++) await Promise.resolve();
    expect(closing).toBe(true); stop.abort(); finish(true);
    expect(await retirement).toBe(false);
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
  });

  it('an observed late source writer during delivery cleanup invalidates readiness even after its first join', async () => {
    const f = await firstWindow(); f.publish(moduleResult); await f.request.flushPublication();
    const source = createBuildSourcePublication(); source.close();
    let finish!: (value: boolean) => void; const delivery = new Promise<boolean>((resolve) => { finish = resolve; });
    let closing = false;
    const retirement = f.request.retireNormalModule(() => !source.uncertain(), () => { closing = true; return delivery; }, () => source.join());
    for (let i = 0; i < 30 && !closing; i++) await Promise.resolve();
    expect(closing).toBe(true);
    await source.issue(async () => 'saved'); // Suppressed, but evidence that this old body is not quiescent.
    finish(true); expect(await retirement).toBe(false);
    expect((await f.queue.load(WS)).paused).toBe(true);
  });

  it('a held retirement ACK and lost-token heartbeat join the same retirement without canceling READY', async () => {
    vi.useFakeTimers();
    const f = await firstWindow(); f.publish(moduleResult); await f.request.flushPublication();
    const rb = { abort: new AbortController(), ended: true, exited: false } as RunningBuild;
    const release = vi.fn(() => f.request.release());
    const lost = vi.fn();
    const timer = startBuildLeaseHeartbeat({ store: f.db, workspaceId: WS, token: A, admittedAt: Date.now(), build: () => rb, current: () => rb, active: () => true, release, lost });
    await vi.advanceTimersByTimeAsync(LEASE_HEARTBEAT_MS - 1000);
    const deliverAck = f.holdRetirementAck();
    const retirement = f.request.retireNormalModule(true, async () => true);
    for (let i = 0; i < 100 && f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`); i++) await Promise.resolve();
    expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('ready');
    await vi.advanceTimersByTimeAsync(1000);
    expect(lost).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', continuation: { phase: 'ready' } });
    const before = f.events.length;
    f.publish({ type: 'error', message: 'detached stale callback after normal publication seal' });
    f.publish({ type: 'result', ok: false });
    expect(f.events).toHaveLength(before);
    deliverAck(); expect(await retirement).toBe(true); await release.mock.results[0].value;
    expect((await f.queue.load(WS)).items[0]).toMatchObject({ status: 'running', continuation: { phase: 'ready' } });
    clearInterval(timer);
  });

  it('one receipt wins a concurrent same-window retry; terminal replay never creates another execution', async () => {
    const f = await firstWindow();
    f.publish(moduleResult); await f.request.flushPublication();
    const handoff = f.events.find((e) => e.type === 'result').queueContinuation;
    await f.request.retireNormalModule(true); await f.request.release();
    await claimWorkspaceBuild(f.db, { workspaceId: WS, token: B, owner: 'worker-B' });
    const one = createBuildRequestCoordination(nextOptions(f, handoff));
    const retry = createBuildRequestCoordination(nextOptions(f, handoff));
    const outcomes = await Promise.all([one.admit(), retry.admit()]);
    expect(outcomes.filter((value) => value === null)).toHaveLength(1);
    expect(outcomes.find(Boolean)).toMatchObject({ status: 409, payload: { code: 'BUILD_REQUEST_IN_PROGRESS' } });
    const accepted = outcomes[0] === null ? one : retry;
    accepted.publish({ type: 'result', ok: true }, () => {}); await accepted.release();
    await releaseWorkspaceBuild(f.db, { workspaceId: WS, token: B });
    await claimWorkspaceBuild(f.db, { workspaceId: WS, token: C, owner: 'worker-C' });
    const replay = createBuildRequestCoordination(nextOptions(f, handoff, C));
    expect(await replay.admit()).toMatchObject({ status: 409, payload: { code: 'BUILD_REQUEST_TERMINAL' } });
    const changedUuidReplay = createBuildRequestCoordination(nextOptions(f, handoff, C, R3));
    expect(await changedUuidReplay.admit()).toMatchObject({ status: 409, payload: { code: 'QUEUE_CLAIM_CONFLICT' } });
    await changedUuidReplay.release();
  });
});
