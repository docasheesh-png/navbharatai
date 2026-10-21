import { readFileSync } from 'node:fs';
import ts from 'typescript';
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
import { applySnapshotRestore, snapshotRestoreComplete, snapshotRestoreStopped, type SnapshotRestorePlan } from '../src/server/AgentV3/snapshotRestore';
import { buildRemoveCommand, reconcileCapturedWrites } from '../src/server/AgentV3/GreenGuard';

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

  it('keeps a chained durable deletion inside normal-module retirement until the actual delete returns', async () => {
    const f = await firstWindow();
    const source = createBuildSourcePublication();
    let finishSave!: () => void; let finishDelete!: () => void;
    const files = new Map([['obsolete.ts', 'old source']]);
    const finalSave = source.track(new Promise<void>((resolve) => { finishSave = resolve; }));
    const rawDelete = source.track(finalSave.then(async () => {
      await new Promise<void>((resolve) => { finishDelete = resolve; });
      files.delete('obsolete.ts'); return 1;
    }));
    const reported = source.track(withTimeout(rawDelete, 15_000, 'durable-delete'));
    f.publish(moduleResult); await f.request.flushPublication();
    const closeDelivery = vi.fn(async () => true);
    let joining = false;
    const retirement = f.request.retireNormalModule(true, closeDelivery, () => { joining = true; return source.join(); });
    for (let i = 0; i < 100 && !joining; i++) await Promise.resolve();
    expect(joining).toBe(true);
    finishSave();
    // Let an incorrectly empty join run through the actual transaction while the delete stays held.
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(finishDelete).toBeTypeOf('function');
    expect(files.has('obsolete.ts')).toBe(true);
    expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('pending');
    expect(closeDelivery).not.toHaveBeenCalled();
    finishDelete(); expect(await reported).toBe(1);
    expect(await retirement).toBe(true);
    expect(files.has('obsolete.ts')).toBe(false);
    expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('ready');
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


/** Execute the actual route adapter, including its publication tracking, with the real restore algorithm. */
function restoreAdapter(source: ReturnType<typeof createBuildSourcePublication>, effects: {
  write: (path: string, content: string) => Promise<void>;
  remove: () => Promise<{ exitCode: number }>;
  persist: (files: Record<string, string>) => Promise<{ status: string }>;
  forget: (paths: string[]) => Promise<number>;
  stopped?: () => boolean;
}) {
  const text = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const ast = ts.createSourceFile('agentv3.ts', text, ts.ScriptTarget.Latest, true);
  let initializer: string | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'applyGreenSnapshotRestore') initializer = node.initializer?.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(initializer).toBeTypeOf('string');
  const compiled = ts.transpileModule(`const restore = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const factory = new Function('runInPass', 'applySnapshotRestore', 'sourcePublication', 'snapshotRestoreStopped', 'abort', 'actuator', 'workspaceId', 'withTimeout', 'buildRemoveCommand', 'reconcileCapturedWrites', 'writtenFiles', 'mergeWorkspaceFiles', 'removeWorkspaceFiles', 'snapshotRestoreComplete', `${compiled}; return restore;`);
  const captured = new Map([['src/App.tsx', 'broken repair'], ['src/extra.ts', 'new failed repair']]);
  const restore = factory((_pass: string, job: () => Promise<unknown>) => job(), applySnapshotRestore, source, snapshotRestoreStopped,
    new AbortController(), { writeFile: (_workspace: string, path: string, content: string) => effects.write(path, content), runCommand: effects.remove }, WS, withTimeout, buildRemoveCommand,
    reconcileCapturedWrites, captured, (_workspace: string, files: Record<string, string>) => effects.persist(files),
    (_workspace: string, paths: string[]) => effects.forget(paths), snapshotRestoreComplete) as typeof applySnapshotRestore;
  return { restore: (plan: SnapshotRestorePlan) => (restore as any)(plan, effects.stopped), captured };
}

function heldEffect() {
  let release!: () => void; let started!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  return { pending, entered, release, wait: async () => { started(); await pending; } };
}
const restorePlan: SnapshotRestorePlan = { write: { 'src/App.tsx': 'confirmed green source' }, remove: ['src/extra.ts'] };

describe('actual shared snapshot restore publication before normal module handoff', () => {
  it.each(['command', 'persist', 'forget'] as const)('keeps the exact predecessor lease and A pending until raw restore %s finishes', async (stage) => {
    const f = await firstWindow(); const source = createBuildSourcePublication(); const held = heldEffect();
    const durable = new Map([['src/App.tsx', 'broken repair'], ['src/extra.ts', 'new failed repair']]);
    const sandbox = new Map(durable);
    const adapter = restoreAdapter(source, {
      write: async (path, content) => { sandbox.set(path, content); },
      remove: async () => { if (stage === 'command') await held.wait(); sandbox.delete('src/extra.ts'); return { exitCode: 0 }; },
      persist: async (files) => { if (stage === 'persist') await held.wait(); Object.entries(files).forEach(([path, content]) => durable.set(path, content)); return { status: 'saved' }; },
      forget: async (paths) => { if (stage === 'forget') await held.wait(); paths.forEach((path) => durable.delete(path)); return paths.length; },
    });
    const restoring = adapter.restore(restorePlan); await held.entered;
    f.publish(moduleResult); await f.request.flushPublication();
    const delivery = vi.fn(async () => true); let joining = false;
    const retirement = f.request.retireNormalModule(() => !source.uncertain(), delivery, () => { joining = true; return source.join(); });
    try {
      for (let i = 0; i < 100; i++) await Promise.resolve();
      expect(joining).toBe(true);
      expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('pending');
      expect((await f.queue.claim(WS)).result).toBeNull();
      expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(true);
      expect(delivery).not.toHaveBeenCalled();
      if (stage === 'persist') expect(durable.get('src/App.tsx')).toBe('broken repair');
      if (stage === 'forget') expect(durable.has('src/extra.ts')).toBe(true);
      held.release();
      const outcome = await restoring;
      expect(snapshotRestoreComplete(restorePlan, outcome)).toBe(true);
      expect(await retirement).toBe(true);
      expect([...durable]).toEqual([['src/App.tsx', 'confirmed green source']]);
      expect([...sandbox]).toEqual([...durable]);
      expect([...adapter.captured]).toEqual([...durable]);
      expect((await f.queue.load(WS)).items[0].continuation?.phase).toBe('ready');
      expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(false);
    } finally { held.release(); await restoring; await retirement; }
  });

  it.each(['partial-persist', 'unconfirmed-delete', 'failed-command', 'stopped'] as const)('pauses without READY after %s while preserving the actual restore outcome', async (failure) => {
    const f = await firstWindow(); const source = createBuildSourcePublication();
    const adapter = restoreAdapter(source, {
      write: async () => {}, remove: async () => ({ exitCode: failure === 'failed-command' ? 1 : 0 }),
      persist: async () => ({ status: failure === 'partial-persist' ? 'partial' : 'saved' }),
      forget: async (paths) => failure === 'unconfirmed-delete' ? 0 : paths.length,
      stopped: () => failure === 'stopped',
    });
    const outcome = await adapter.restore(restorePlan);
    expect(snapshotRestoreComplete(restorePlan, outcome)).toBe(false);
    expect(outcome.failed.length).toBeGreaterThan(0);
    f.publish(moduleResult); await f.request.flushPublication();
    const delivery = vi.fn(async () => true);
    expect(await f.request.retireNormalModule(() => !source.uncertain(), delivery, () => source.join())).toBe(false);
    expect(delivery).not.toHaveBeenCalled();
    expect((await f.queue.load(WS))).toMatchObject({ paused: true, items: [{ status: 'failed' }, { status: 'pending' }] });
    expect((await f.queue.load(WS)).items[0].continuation).toBeUndefined();
    expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(true);
  });

  it('keeps a raw command tracked after its reporting timeout and never recovers READY from its late completion', async () => {
    vi.useFakeTimers(); const f = await firstWindow(); const source = createBuildSourcePublication(); const held = heldEffect();
    let deleted = false;
    const adapter = restoreAdapter(source, { write: async () => {}, remove: async () => { await held.wait(); deleted = true; return { exitCode: 0 }; }, persist: async () => ({ status: 'saved' }), forget: async (paths) => paths.length });
    const restoring = adapter.restore(restorePlan); await held.entered;
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await restoring;
    expect(outcome.failed).toContain('src/extra.ts'); expect(deleted).toBe(false);
    let joined = false;
    const drain = source.join().then((safe) => { joined = true; return safe; });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(joined).toBe(false); // The raw command remains owned after the whole helper reports failure.
    f.publish(moduleResult); await f.request.flushPublication();
    const retiring = f.request.retireNormalModule(() => !source.uncertain(), async () => true, () => source.join());
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await drain).toBe(false);
    expect(await retiring).toBe(false);
    expect((await f.queue.load(WS)).paused).toBe(true);
    held.release(); await vi.advanceTimersByTimeAsync(0);
    expect(deleted).toBe(true);
    expect((await f.queue.load(WS)).items[0].continuation).toBeUndefined();
  });

  it('observes a rejected restore status mapper while returning the original rejection to its caller', async () => {
    const f = await firstWindow(); const source = createBuildSourcePublication();
    const error = Error('restore ownership lookup failed');
    const adapter = restoreAdapter(source, { write: async () => {}, remove: async () => ({ exitCode: 0 }), persist: async () => ({ status: 'saved' }), forget: async () => 1, stopped: () => { throw error; } });
    await expect(adapter.restore(restorePlan)).rejects.toBe(error);
    f.publish(moduleResult); await f.request.flushPublication();
    expect(await f.request.retireNormalModule(() => !source.uncertain(), async () => true, () => source.join())).toBe(false);
    expect((await f.queue.load(WS)).paused).toBe(true);
    expect(f.docs.has(`${WORKSPACE_BUILD_LEASE_COLLECTION}/${WS}`)).toBe(true);
  });
});
