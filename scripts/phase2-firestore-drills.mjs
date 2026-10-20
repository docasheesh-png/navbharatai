#!/usr/bin/env node
/**
 * Real, credential-free Phase 2 coordination drills. This is deliberately outside Vitest:
 * workers run the production queue/lease helpers against a loopback Firestore emulator.
 *
 * Start a local emulator (for example the official cloud-firestore-emulator-v1.22.0.jar):
 *   java -jar /path/to/cloud-firestore-emulator-v1.22.0.jar --host 127.0.0.1 --port 18781 \
 *     --project_id demo-navbharatai-phase2 --single_project_mode true --single_project_mode_error true
 * Then run with Node 22:
 *   node scripts/phase2-firestore-drills.mjs --emulator 127.0.0.1:18781
 * To prove the negative control, pass --repo /path/to/phase1/worktree --expect-regressions.
 * No production credentials, paid calls, rules changes, or global emulator resets are used.
 */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'demo-navbharatai-phase2';
const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const repo = path.resolve(option('--repo', path.join(HERE, '..')));
const endpoint = option('--emulator', '127.0.0.1:18781');
if (!/^127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Only a loopback emulator is allowed.');
const port = Number(endpoint.split(':')[1]);
if (!(port > 1024 && port <= 65535)) throw new Error('Invalid emulator port.');
const isWorker = args.includes('--worker');
const prefix = option('--prefix', `phase2-drill-${randomUUID()}`);
if (!/^phase2-drill-[a-z0-9-]+$/.test(prefix)) throw new Error('Unsafe fixture prefix.');

if (isWorker) {
  await worker();
} else {
  await coordinator();
}

async function worker() {
  // Never inherit app/provider credentials or rely on the repository's production project default.
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
  assert.equal(process.env.FIRESTORE_DATABASE_ID, '(default)');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint);
  assert.equal(process.env.VITEST, undefined);
  const req = createRequire(path.join(repo, 'package.json'));
  const admin = req('firebase-admin');
  admin.initializeApp({ projectId: PROJECT });
  const { getFirestore } = req('firebase-admin/firestore');
  const db = getFirestore(admin.app(), '(default)');
  db.settings({ ignoreUndefinedProperties: true });
  const load = (relative) => import(pathToFileURL(path.join(repo, relative)).href);
  const binding = await load('src/server/lib/serverDb.ts');
  let fault = null;
  const wrapped = {
    collection: (name) => db.collection(name),
    doc: (documentPath) => db.doc(documentPath),
    runTransaction: async (fn) => {
      const active = fault;
      fault = null;
      const actual = db.runTransaction(fn, { maxAttempts: 3 });
      if (active === 'deadline') {
        // The wire is actually cut by the parent. This short SDK-deadline injection keeps the
        // drill bounded; the child is killed before the wire is restored, preventing late retries.
        actual.catch(() => {});
        return Promise.race([actual, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Injected SDK deadline during real transport outage'), { code: 4 })), 250))]);
      }
      const result = await actual;
      if (active === 'ack-loss') throw Object.assign(new Error('Injected lost SDK acknowledgement AFTER real commit'), { code: 14 });
      return result;
    },
  };
  // This is a real emulator Admin SDK handle, injected only to make bootstrap and fault boundaries explicit.
  binding.setServerDb(wrapped);
  const queue = await load('src/server/AgentV3/BuildQueue.ts');
  const store = await load('src/server/AgentV3/BuildQueueStore.ts');
  const leases = await load('src/server/AgentV3/workspaceBuildLease.ts');
  const wallet = await load('src/server/lib/walletDebit.ts');
  const { TOKENS_PER_RUPEE } = await load('src/server/lib/payments.ts');
  const ledger = await load('src/server/lib/ledgerV2.ts');
  const receipt = existsSync(path.join(repo, 'src/server/lib/buildRequestReceipt.ts')) ? await load('src/server/lib/buildRequestReceipt.ts') : null;
  const modern = typeof store.createBuildQueueStore === 'function';
  const localStore = modern ? store.createBuildQueueStore(wrapped) : null;
  const workspace = (id) => {
    if (typeof id !== 'string' || !(id.startsWith(`${prefix}-`) || id.startsWith(`agentv3-${prefix}-`))) throw new Error('Refusing a non-fixture workspace.');
    return id;
  };
  process.on('message', async ({ id, action, data = {} }) => {
    try {
      let result;
      const ws = data.workspaceId ? workspace(data.workspaceId) : undefined;
      if (action === 'ping') {
        await db.collection('phase2_drill_controls').doc(prefix).set({ project: PROJECT, prefix });
        result = { modern, receipts: Boolean(receipt), pid: process.pid };
      } else if (action === 'enqueue') {
        fault = data.fault ?? null;
        const item = { id: data.itemId, prompt: data.prompt ?? data.itemId, source: 'user', createdTs: data.at ?? Date.now() };
        result = await store.mutateQueue(ws, (q) => queue.enqueue(q, item).queue);
      } else if (action === 'load') {
        result = await store.loadQueue(ws);
      } else if (action === 'claim') {
        if (modern) result = (await localStore.claim(ws, data.token ?? randomUUID(), data.now ?? Date.now(), data.resume ?? false)).result;
        else {
          let claimed = null;
          await store.mutateQueue(ws, (q) => { const next = queue.claimNext(q); claimed = next.claimed; return next.queue; });
          result = claimed;
        }
      } else if (action === 'bind') {
        result = modern ? (await localStore.bind(ws, data.prompt, data.attemptId, data.expected)).result
          : { itemId: data.expected.itemId, claimToken: data.expected.claimToken, attemptId: data.attemptId };
      } else if (action === 'settle') {
        if (modern) result = (await localStore.settle(ws, data.binding, data.ok, data.note)).result;
        else {
          let changed = false;
          await store.mutateQueue(ws, (q) => { const next = queue.completeRunning(q, data.ok, data.note); changed = next !== q; return next; });
          result = changed;
        }
      } else if (action === 'recover') {
        result = modern ? (await localStore.recover(ws, data.itemId, data.now ?? Date.now())).result : false;
      } else if (action === 'lease-claim') {
        result = await leases.claimWorkspaceBuild(wrapped, { workspaceId: ws, token: data.token, owner: data.owner, userId: 'phase2-demo-owner', nowMs: data.now });
      } else if (action === 'lease-renew') {
        result = await leases.renewWorkspaceBuild(wrapped, { workspaceId: ws, token: data.token, nowMs: data.now });
      } else if (action === 'lease-release') {
        result = await leases.releaseWorkspaceBuild(wrapped, { workspaceId: ws, token: data.token });
      } else if (action === 'durable') {
        const snap = await db.collection(data.collection ?? 'build_queues_v3').doc(ws).get();
        result = snap.exists ? snap.data() : null;
      } else if (action === 'wallet-seed') {
        await db.collection('user_token_wallets').doc(ws).set({ userId: ws, tokenBalance: 100 * TOKENS_PER_RUPEE,
          totalTokensUsed: 0, remaining_balance: 100, walletLedger: [], giftTokensRemaining: 0 });
        result = { tokensPerRupee: TOKENS_PER_RUPEE, initialTokens: 100 * TOKENS_PER_RUPEE };
      } else if (action === 'wallet-debit') {
        fault = data.fault ?? null;
        result = await wallet.debitWalletForBuild(wrapped, ws, { buildRef: data.buildRef, billedInr: 5, description: 'Local emulator drill' });
      } else if (action === 'wallet-audit') {
        const current = (await db.collection('user_token_wallets').doc(ws).get()).data();
        const operations = (await db.collection('wallet_ops').where('ownerId', '==', ws).get()).docs.map((row) => row.data());
        const rows = (await db.collection(ledger.WALLET_LEDGER_V2).where('ownerId', '==', ws).get()).docs.map((row) => row.data());
        result = { wallet: current, operations, rows, chain: ledger.checkLedgerV2Chain(rows, current.tokenBalance) };
      } else if (action === 'receipt-reserve') {
        if (!receipt || data.ownerId !== `${prefix}-owner`) throw new Error('Unavailable receipt API or non-fixture owner.');
        fault = data.fault ?? null;
        result = await receipt.reserveBuildRequest(wrapped, { ownerId: data.ownerId, workspaceId: ws, requestId: data.requestId,
          attemptId: data.attemptId, input: data.input });
      } else if (action === 'receipt-complete') {
        if (!receipt || data.receipt.ownerId !== `${prefix}-owner`) throw new Error('Unavailable receipt API or non-fixture owner.');
        result = await receipt.completeBuildRequest(wrapped, data.receipt, 'complete');
      } else if (action === 'cleanup') {
        const collections = ['build_queues_v3', 'agentv3_build_leases', 'agentv3_runtime_targets', 'phase2_drill_controls'];
        for (const name of collections) {
          const snaps = await db.collection(name).where(admin.firestore.FieldPath.documentId(), '>=', prefix).where(admin.firestore.FieldPath.documentId(), '<', `${prefix}\uf8ff`).get();
          if (!snaps.empty) { const batch = db.batch(); snaps.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
        }
        const wallets = await db.collection('user_token_wallets').where(admin.firestore.FieldPath.documentId(), '>=', prefix).where(admin.firestore.FieldPath.documentId(), '<', `${prefix}\uf8ff`).get();
        if (!wallets.empty) { const batch = db.batch(); wallets.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
        for (const name of ['wallet_ops', ledger.WALLET_LEDGER_V2, 'agentv3_build_requests']) {
          const rows = await db.collection(name).where('ownerId', '>=', prefix).where('ownerId', '<', `${prefix}\uf8ff`).get();
          if (!rows.empty) { const batch = db.batch(); rows.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
        }
        result = true;
      } else throw new Error(`Unknown action ${action}`);
      process.send?.({ id, ok: true, result });
    } catch (error) {
      process.send?.({ id, ok: false, error: { message: error.message, code: error.code ?? error.name } });
    }
  });
  process.send?.({ ready: true });
}

async function coordinator() {
  const workers = new Set();
  const records = [];
  const ws = (name) => `${prefix}-${name}`;
  const check = async (name, fn) => {
    const started = Date.now();
    try { const evidence = await fn(); records.push({ name, pass: true, ms: Date.now() - started, evidence }); }
    catch (error) { records.push({ name, pass: false, ms: Date.now() - started, error: error.message }); }
    console.log(JSON.stringify(records.at(-1)));
  };
  let proxy;
  let control;
  try {
    control = await startWorker(endpoint);
    const a = await startWorker(endpoint);
    const b = await startWorker(endpoint);
    const version = await control.ask('ping');
    assert.equal(version.ok, true, 'The emulator fixture could not be initialized.');
    if (!args.includes('--expect-regressions')) {
      assert.equal(version.result.modern, true, 'The current queue coordination API is required.');
      assert.equal(version.result.receipts, true, 'The current durable request receipt API is required.');
    }
    console.log(JSON.stringify({ project: PROJECT, emulator: endpoint, repo, prefix, modernQueue: version.result.modern, node: process.version, injection: 'Actual gRPC transport outage plus explicitly labelled SDK deadline/ack-loss injection; not a Cloud Run or E2B drill.' }));

    await check('fresh cross-process reads see another worker enqueue', async () => {
      assert.equal((await b.ok('load', { workspaceId: ws('fresh') })).items.length, 0);
      await a.ok('enqueue', { workspaceId: ws('fresh'), itemId: 'step-a' });
      const loaded = await b.ok('load', { workspaceId: ws('fresh') });
      assert.equal(loaded.items.length, 1, 'Another worker retained an empty admission cache after a durable enqueue.');
      return { items: loaded.items.length, distinctPids: [a.pid, b.pid] };
    });

    await check('two real workers admit exactly one queued command', async () => {
      const workspaceId = ws('queue-race');
      await control.ok('enqueue', { workspaceId, itemId: 'first' });
      await control.ok('enqueue', { workspaceId, itemId: 'second' });
      const claims = await Promise.all([a.ok('claim', { workspaceId, token: 'queue-a' }), b.ok('claim', { workspaceId, token: 'queue-b' })]);
      assert.equal(claims.filter(Boolean).length, 1, 'Concurrent workers both claimed commands from one serial queue.');
      const stored = JSON.parse((await control.ok('durable', { workspaceId })).queue);
      assert.equal(stored.items.filter((i) => i.status === 'running').length, 1);
      return { claims: claims.map((claim) => claim?.id ?? null), durableStatuses: stored.items.map((i) => i.status) };
    });

    await check('live lease cannot be reclaimed by another attempt with the same process owner', async () => {
      const workspaceId = ws('same-owner');
      const claims = await Promise.all([a.ok('lease-claim', { workspaceId, token: 'attempt-a', owner: 'shared-owner' }), b.ok('lease-claim', { workspaceId, token: 'attempt-b', owner: 'shared-owner' })]);
      assert.equal(claims.filter((claim) => claim.ok).length, 1, 'A shared process owner let two different attempt tokens hold a live lease.');
      return { accepted: claims.filter((claim) => claim.ok).length };
    });

    await check('expired attempt cannot renew or release a replacement lease', async () => {
      const workspaceId = ws('expired-lease');
      assert.equal((await a.ok('lease-claim', { workspaceId, token: 'expired', owner: 'old-owner', now: Date.now() - 90_001 })).ok, true);
      assert.equal((await b.ok('lease-claim', { workspaceId, token: 'replacement', owner: 'new-owner' })).ok, true);
      assert.equal(await a.ok('lease-renew', { workspaceId, token: 'expired' }), 'lost');
      await a.ok('lease-release', { workspaceId, token: 'expired' });
      const current = await control.ok('durable', { workspaceId, collection: 'agentv3_build_leases' });
      assert.equal(current.token, 'replacement');
      return { lateRenewal: 'lost', durableToken: current.token, expiryClock: 'first claim timestamp explicitly backdated90001ms' };
    });

    await check('killed worker stays running until explicit stale recovery', async () => {
      const dead = await startWorker(endpoint);
      const workspaceId = ws('crash');
      await dead.ok('enqueue', { workspaceId, itemId: 'crashed' });
      await dead.ok('enqueue', { workspaceId, itemId: 'next' });
      const claim = await dead.ok('claim', { workspaceId, token: 'dead-claim' });
      await dead.kill();
      const fresh = await startWorker(endpoint);
      const loaded = await fresh.ok('load', { workspaceId });
      assert.equal(loaded.items.find((i) => i.id === 'crashed').status, 'running', 'Reading a queue falsely classified a crashed/unreachable worker as completed.');
      assert.equal(await fresh.ok('claim', { workspaceId }), null, 'New worker admitted work before recovery.');
      assert.equal(await fresh.ok('recover', { workspaceId, itemId: 'crashed' }), false, 'A fresh claim was recovered before its grace period.');
      // Advance the recovery decision clock, rather than sleeping ninety seconds. DB and workers remain real.
      assert.equal(await fresh.ok('recover', { workspaceId, itemId: 'crashed', now: Date.now() + 90_001 }), true);
      const recovered = await fresh.ok('load', { workspaceId });
      assert.equal(recovered.paused, true);
      assert.equal(await fresh.ok('claim', { workspaceId }), null);
      assert.equal((await fresh.ok('claim', { workspaceId, resume: true })).id, 'next');
      await fresh.kill();
      return { killedPid: dead.pid, recoveredItem: claim.id, recoveryClock: 'explicit +90001ms', pausedUntilResume: true };
    });

    await check('stale completion cannot settle a newer generation', async () => {
      const workspaceId = ws('stale-settle');
      await control.ok('enqueue', { workspaceId, itemId: 'old' });
      await control.ok('enqueue', { workspaceId, itemId: 'new' });
      const first = await a.ok('claim', { workspaceId, token: 'old-claim' });
      await a.ok('lease-claim', { workspaceId, token: 'old-attempt', owner: 'old-owner' });
      const oldBinding = await a.ok('bind', { workspaceId, prompt: 'old', attemptId: 'old-attempt', expected: { itemId: first.id, claimToken: first.claimToken } });
      await a.ok('settle', { workspaceId, binding: oldBinding, ok: true });
      await a.ok('lease-release', { workspaceId, token: 'old-attempt' });
      const second = await b.ok('claim', { workspaceId, token: 'new-claim' });
      await b.ok('lease-claim', { workspaceId, token: 'new-attempt', owner: 'new-owner' });
      await b.ok('bind', { workspaceId, prompt: 'new', attemptId: 'new-attempt', expected: { itemId: second.id, claimToken: second.claimToken } });
      assert.equal(await a.ok('settle', { workspaceId, binding: oldBinding, ok: true }), false, 'Old completion was accepted for a newer step.');
      const current = await control.ok('load', { workspaceId });
      assert.equal(current.items.find((i) => i.id === 'new').status, 'running');
      return { oldAttempt: oldBinding.attemptId, newStatus: 'running' };
    });

    await check('commit acknowledgement loss stays unconfirmed and replay is durable', async () => {
      const uncertain = await startWorker(endpoint);
      const workspaceId = ws('ack-loss');
      const response = await uncertain.ask('enqueue', { workspaceId, itemId: 'idempotent', fault: 'ack-loss' });
      const actual = JSON.parse((await control.ok('durable', { workspaceId })).queue);
      assert.equal(actual.items.length, 1, 'The injected acknowledgement loss did not follow a real commit.');
      assert.equal(response.ok, false, 'The store falsely acknowledged a write after an unconfirmed SDK outcome.');
      assert.equal(response.error.code, 'QUEUE_STORE_UNAVAILABLE');
      await uncertain.kill();
      const retry = await startWorker(endpoint);
      await retry.ok('enqueue', { workspaceId, itemId: 'idempotent' });
      assert.equal((await retry.ok('load', { workspaceId })).items.length, 1);
      await retry.kill();
      return { actualCommittedItems: actual.items.length, response: response.error.code, replayItems: 1, injection: 'Throw once after actual emulator transaction committed' };
    });

    await check('two real wallet settlers charge the same build reference once', async () => {
      const workspaceId = ws('wallet-race');
      const seeded = await control.ok('wallet-seed', { workspaceId });
      const buildRef = `${workspaceId}-attempt`;
      const result = await Promise.all([a.ok('wallet-debit', { workspaceId, buildRef }), b.ok('wallet-debit', { workspaceId, buildRef })]);
      assert(result.every((value) => value.ok));
      assert.equal(result.reduce((sum, value) => sum + value.tokensDebited, 0), 5 * seeded.tokensPerRupee);
      const audit = await control.ok('wallet-audit', { workspaceId });
      assert.equal(audit.wallet.tokenBalance, 95 * seeded.tokensPerRupee);
      assert.equal(audit.wallet.walletLedger.length, 1);
      assert.equal(audit.operations.length, 1);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.chain.ok, true);
      return { tokensDebited: result.map((value) => value.tokensDebited), balanceInr: 95, durableOperations: 1, immutableLedgerRows: 1, chain: audit.chain };
    });

    await check('wallet commit acknowledgement loss replays without another debit after worker restart', async () => {
      const workspaceId = ws('wallet-ack-loss');
      const seeded = await control.ok('wallet-seed', { workspaceId });
      const buildRef = `${workspaceId}-attempt`;
      const uncertain = await startWorker(endpoint);
      const lost = await uncertain.ok('wallet-debit', { workspaceId, buildRef, fault: 'ack-loss' });
      assert.equal(lost.ok, false);
      const committed = await control.ok('wallet-audit', { workspaceId });
      assert.equal(committed.wallet.tokenBalance, 95 * seeded.tokensPerRupee);
      await uncertain.kill();
      const retry = await startWorker(endpoint);
      const replay = await retry.ok('wallet-debit', { workspaceId, buildRef });
      assert.equal(replay.ok, true);
      assert.equal(replay.tokensDebited, 0);
      const audit = await retry.ok('wallet-audit', { workspaceId });
      assert.equal(audit.operations.length, 1);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.chain.ok, true);
      await retry.kill();
      return { originalOutcome: 'unconfirmed', replayTokensDebited: 0, balanceInr: 95, immutableLedgerRows: 1, injection: 'Throw once after actual atomic wallet+operation+ledger commit' };
    });

    if (version.result.receipts) {
      await check('two workers reserve one request identity and terminal replay cannot execute', async () => {
        const data = { workspaceId: `agentv3-${prefix}-owner-receipt`, ownerId: `${prefix}-owner`, requestId: randomUUID(), input: { message: 'local fixture' } };
        const results = await Promise.all([a.ok('receipt-reserve', { ...data, attemptId: randomUUID() }), b.ok('receipt-reserve', { ...data, attemptId: randomUUID() })]);
        assert.equal(results.filter((result) => result.ok).length, 1);
        assert.equal(results.find((result) => !result.ok).code, 'in-progress');
        const accepted = results.find((result) => result.ok).receipt;
        assert.equal((await a.ok('receipt-complete', { receipt: accepted })).ok, true);
        const retry = await startWorker(endpoint);
        const terminal = await retry.ok('receipt-reserve', { ...data, attemptId: randomUUID() });
        assert.equal(terminal.ok, false);
        assert.equal(terminal.code, 'terminal');
        assert.equal(terminal.receipt.buildRef, accepted.buildRef);
        assert.equal((await retry.ok('receipt-reserve', { ...data, input: { message: 'different workload' }, attemptId: randomUUID() })).code, 'input-mismatch');
        await retry.kill();
        return { executorsAdmitted: 1, terminalReplay: terminal.code, changedInput: 'input-mismatch', stableBuildRef: true };
      });

      await check('uncertain request reservation commit cannot execute on restart', async () => {
        const data = { workspaceId: `agentv3-${prefix}-owner-receipt-ack`, ownerId: `${prefix}-owner`, requestId: randomUUID(), input: { message: 'local fixture' } };
        const uncertain = await startWorker(endpoint);
        const lost = await uncertain.ok('receipt-reserve', { ...data, attemptId: randomUUID(), fault: 'ack-loss' });
        assert.equal(lost.ok, false);
        assert.equal(lost.code, 'unavailable');
        await uncertain.kill();
        const retry = await startWorker(endpoint);
        const replay = await retry.ok('receipt-reserve', { ...data, attemptId: randomUUID() });
        assert.equal(replay.ok, false);
        assert.equal(replay.code, 'in-progress');
        await retry.kill();
        return { originalOutcome: 'unavailable', restartReplay: replay.code, executorsAdmitted: 0, injection: 'Throw once after actual receipt reservation commit' };
      });
    } else {
      console.log(JSON.stringify({ additiveReceiptDrills: 'skipped: request receipt API is absent from the Phase1 negative-control revision' }));
    }

    proxy = await startProxy(port);
    await check('real transport outage never grants an unverified build lease', async () => {
      const disconnected = await startWorker(`127.0.0.1:${proxy.port}`);
      await disconnected.ok('ping');
      proxy.cut();
      const workspaceId = ws('lease-outage');
      const result = await disconnected.ok('lease-claim', { workspaceId, token: 'partitioned', owner: 'outage-owner' });
      await disconnected.kill();
      assert.equal(result.ok, false, 'A database partition granted unverified build authority.');
      assert.equal(result.reason, 'unavailable');
      assert.equal(await control.ok('durable', { workspaceId, collection: 'agentv3_build_leases' }), null);
      proxy.restore();
      return { result, durableLease: null, injection: 'Live loopback TCP proxy cuts existing and future gRPC connections; production4s claim deadline' };
    });
    proxy.restore();

    await check('real transport outage never acknowledges a local-only queue write', async () => {
      const disconnected = await startWorker(`127.0.0.1:${proxy.port}`);
      await disconnected.ok('ping');
      proxy.cut();
      const workspaceId = ws('queue-outage');
      const result = await disconnected.ask('enqueue', { workspaceId, itemId: 'must-not-ack', fault: 'deadline' });
      await disconnected.kill();
      assert.equal(await control.ok('durable', { workspaceId }), null, 'The fixture unexpectedly committed before the outage.');
      assert.equal(result.ok, false, 'Database outage was falsely acknowledged from process memory.');
      assert.equal(result.error.code, 'QUEUE_STORE_UNAVAILABLE');
      proxy.restore();
      return { response: result.error.code, durableQueue: null, injection: 'Actual TCP outage plus250ms injected SDK deadline; killed before transport restoration' };
    });
    proxy.restore();

    if (version.result.modern) {
      await check('production queue deadline rejects a raw TCP outage and a fresh worker retries after recovery', async () => {
        const disconnected = await startWorker(`127.0.0.1:${proxy.port}`);
        await disconnected.ok('ping');
        proxy.cut();
        const workspaceId = ws('queue-production-deadline');
        const started = Date.now();
        const response = await disconnected.ask('enqueue', { workspaceId, itemId: 'retry-after-recovery' });
        const elapsedMs = Date.now() - started;
        await disconnected.kill();
        assert.equal(response.ok, false);
        assert.equal(response.error.code, 'QUEUE_STORE_UNAVAILABLE');
        assert(elapsedMs < 10_000, `Production queue deadline did not bound the outage (${elapsedMs}ms).`);
        assert.equal(await control.ok('durable', { workspaceId }), null);
        proxy.restore();
        const retry = await startWorker(`127.0.0.1:${proxy.port}`);
        await retry.ok('enqueue', { workspaceId, itemId: 'retry-after-recovery' });
        const confirmed = JSON.parse((await control.ok('durable', { workspaceId })).queue);
        assert.equal(confirmed.items.length, 1);
        await retry.kill();
        return { response: response.error.code, elapsedMs, durableItemsAfterRecovery: 1, injection: 'TCP proxy cut only; no injected SDK error/deadline in this drill' };
      });
      proxy.restore();
    }
  } finally {
    proxy?.restore();
    // Only delete documents carrying this unique run prefix; never reset an emulator/project.
    if (control) await control.ask('cleanup').catch((error) => console.error('Fixture cleanup failed:', error.message));
    for (const child of workers) child.kill();
    await proxy?.close();
  }
  const failed = records.filter((record) => !record.pass);
  console.log(JSON.stringify({ summary: { passed: records.length - failed.length, failed: failed.length, total: records.length }, negativeControl: args.includes('--expect-regressions'), limits: ['No paid model/E2B/Cloud Run calls', 'Recovery decision clock explicitly advanced', 'SDK deadline and acknowledgement loss are explicitly injected around a real emulator', 'HTTP authentication and route admission are covered separately'] }));
  if (args.includes('--expect-regressions')) assert(failed.length >= 4, 'Negative control did not reproduce the expected production defects.');
  else if (failed.length) process.exitCode = 1;

  async function startWorker(host) {
    const childEnv = {
      PATH: process.env.PATH,
      TZ: 'UTC',
      GCLOUD_PROJECT: PROJECT,
      GOOGLE_CLOUD_PROJECT: PROJECT,
      FIRESTORE_EMULATOR_HOST: host,
      FIRESTORE_DATABASE_ID: '(default)',
      WALLET_MERGE_RESOLVE: 'off',
      WALLET_LEDGER_V2_DUALWRITE: 'on',
      // Prevent ADC metadata probing in this credential-free fixture.
      GCE_METADATA_HOST: '127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    };
    const child = fork(fileURLToPath(import.meta.url), ['--worker', '--repo', repo, '--emulator', host, '--prefix', prefix], {
      execPath: process.execPath,
      execArgv: ['--import', path.join(repo, 'node_modules/tsx/dist/loader.mjs')],
      env: childEnv,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    workers.add(child);
    child.stderr.on('data', (chunk) => process.stderr.write(`[worker ${child.pid}] ${chunk}`));
    let serial = 0;
    const pending = new Map();
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 15_000);
      child.on('message', (message) => {
        if (message.ready) { clearTimeout(timer); resolve(); }
        else if (pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer); entry.resolve(message); }
      });
      child.on('exit', (code, signal) => {
        workers.delete(child);
        clearTimeout(timer);
        const error = new Error(`Worker exited (${code ?? signal})`);
        reject(error);
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
        pending.clear();
      });
    });
    await ready;
    const ask = (action, data = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${action} timed out`)); }, 15_000);
      pending.set(id, { resolve, reject, timer });
      child.send({ id, action, data });
    });
    return {
      pid: child.pid,
      ask,
      ok: async (action, data) => { const response = await ask(action, data); assert.equal(response.ok, true, `${action}: ${response.error?.message}`); return response.result; },
      kill: () => new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once('exit', resolve);
        child.kill('SIGKILL');
      }),
    };
  }
}

async function startProxy(targetPort) {
  let online = true;
  const sockets = new Set();
  const server = net.createServer((client) => {
    if (!online) return client.destroy();
    const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
    sockets.add(client); sockets.add(upstream);
    client.on('error', () => {}); upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.pipe(upstream); upstream.pipe(client);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    cut: () => { online = false; for (const socket of sockets) socket.destroy(); },
    restore: () => { online = true; },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); },
  };
}
