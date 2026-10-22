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
  const continuations = ['proposeContinuation', 'retireContinuation', 'cancelContinuation', 'stop'].every((name) => typeof localStore?.[name] === 'function');
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
        result = { modern, continuations, receipts: Boolean(receipt), pid: process.pid };
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
        fault = data.fault ?? null;
        result = modern ? (await localStore.bind(ws, data.prompt, data.attemptId, data.expected)).result
          : { itemId: data.expected.itemId, claimToken: data.expected.claimToken, attemptId: data.attemptId };
      } else if (action === 'continuation-propose') {
        if (!continuations) throw new Error('Continuation API is unavailable in this revision.');
        fault = data.fault ?? null;
        result = (await localStore.proposeContinuation(ws, data.binding, data.planRemaining, data.nonce)).result;
      } else if (action === 'continuation-retire') {
        if (!continuations) throw new Error('Continuation API is unavailable in this revision.');
        fault = data.fault ?? null;
        result = (await localStore.retireContinuation(ws, data.binding, data.nonce)).result;
      } else if (action === 'continuation-cancel') {
        if (!continuations) throw new Error('Continuation API is unavailable in this revision.');
        fault = data.fault ?? null;
        result = (await localStore.cancelContinuation(ws, data.binding, data.note)).result;
      } else if (action === 'continuation-stop') {
        if (!continuations) throw new Error('Continuation API is unavailable in this revision.');
        fault = data.fault ?? null;
        result = (await localStore.stop(ws)).result;
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
          for (const ownedPrefix of [prefix, `agentv3-${prefix}-`]) {
            const snaps = await db.collection(name).where(admin.firestore.FieldPath.documentId(), '>=', ownedPrefix).where(admin.firestore.FieldPath.documentId(), '<', `${ownedPrefix}\uf8ff`).get();
            if (!snaps.empty) { const batch = db.batch(); snaps.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
          }
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

// This is observation only: an unconfirmed SDK response is not a rejected transaction.
// Preserve raw fixture responses and never derive a pass/fail verdict from this classifier.
function describeDrillAcknowledgment(response) {
  const acknowledgment = response?.ok === true ? 'acknowledged'
    : response?.ok !== false ? 'unknown'
      : response.error?.code === 'QUEUE_STORE_UNAVAILABLE' ? 'unconfirmed'
        : response.error?.code === 'QUEUE_CLAIM_CONFLICT' ? 'rejected'
          : 'error';
  return { acknowledgment, raw: response };
}

async function captureDrillAcknowledgments(control, { name, order, workspaceId, operations }) {
  const startedAt = new Date().toISOString();
  const read = async (action, data) => {
    try { return await control.ask(action, data); }
    catch (error) { return { ok: false, error: { code: error?.code ?? error?.name ?? 'Error', message: String(error?.message ?? error) } }; }
  };
  const queue = await read('load', { workspaceId });
  const lease = await read('durable', { workspaceId, collection: 'agentv3_build_leases' });
  const observation = { type: 'queue-acknowledgment-observation', name, order,
    operations: Object.fromEntries(Object.entries(operations).map(([key, response]) => [key, describeDrillAcknowledgment(response)])),
    snapshot: { startedAt, finishedAt: new Date().toISOString(), queue, lease },
    limit: 'Read-only non-atomic snapshots, not a final transaction verdict. An unconfirmed operation may still commit later. No recovery performed.' };
  console.log(JSON.stringify(observation));
  return observation;
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
      assert.equal(version.result.continuations, true, 'The current normal-module continuation API is required.');
    }
    console.log(JSON.stringify({ project: PROJECT, emulator: endpoint, repo, prefix, modernQueue: version.result.modern, normalModuleContinuations: version.result.continuations, node: process.version, injection: 'Actual gRPC transport outage plus explicitly labelled SDK deadline/ack-loss injection; not a Cloud Run or E2B drill.' }));

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

    if (version.result.continuations) {
      const moduleFixture = async (name, withReceipt = false) => {
        const workspaceId = withReceipt ? `agentv3-${prefix}-owner-${name}` : ws(name);
        const prompt = 'Build the approved module plan';
        await control.ok('enqueue', { workspaceId, itemId: 'A', prompt });
        await control.ok('enqueue', { workspaceId, itemId: 'B', prompt: 'Build the next approved step' });
        const claim = await a.ok('claim', { workspaceId, token: randomUUID() });
        assert.equal(claim.id, 'A');
        const attemptId = randomUUID();
        assert.equal((await a.ok('lease-claim', { workspaceId, token: attemptId, owner: 'normal-module-predecessor' })).ok, true);
        const initial = { ownerId: `${prefix}-owner`, workspaceId, requestId: randomUUID(), attemptId,
          input: { prompt, queueItemId: 'A', queueClaimToken: claim.claimToken, queueContinuationProtocol: 1 } };
        const reserved = withReceipt ? await a.ok('receipt-reserve', initial) : null;
        if (withReceipt) assert.equal(reserved.ok, true);
        const binding = await a.ok('bind', { workspaceId, prompt, attemptId, expected: { itemId: 'A', claimToken: claim.claimToken } });
        return { workspaceId, binding, initial, receipt: reserved?.receipt };
      };
      const propose = (fixture, worker = a, planRemaining = 3) => worker.ok('continuation-propose', {
        workspaceId: fixture.workspaceId, binding: fixture.binding, planRemaining, nonce: randomUUID(),
      });
      const retire = (fixture, handoff, worker = a, extra = {}) => worker.ok('continuation-retire', {
        workspaceId: fixture.workspaceId, binding: fixture.binding, nonce: handoff.nonce, ...extra,
      });
      const readyFixture = async (name) => {
        const fixture = await moduleFixture(name);
        const handoff = await propose(fixture);
        assert.equal(await retire(fixture, handoff), true);
        return { ...fixture, handoff };
      };
      const transfer = (fixture, attemptId, extra = {}) => ({ workspaceId: fixture.workspaceId, prompt: 'continue', attemptId,
        expected: { itemId: 'A', claimToken: fixture.binding.claimToken, continuationNonce: fixture.handoff.nonce,
          predecessorAttemptId: fixture.binding.attemptId, requestId: randomUUID() }, ...extra });

      await check('normal module windows retain logical A until final success, with separate replay-safe receipts', async () => {
        const f = await moduleFixture('normal-module-windows', true);
        const handoff = await propose(f, a, 1);
        const pending = await b.ok('load', { workspaceId: f.workspaceId });
        assert.equal(pending.items[0].status, 'running');
        assert.equal(pending.items[0].continuation.phase, 'pending');
        assert.equal(await b.ok('claim', { workspaceId: f.workspaceId }), null);
        assert.equal((await a.ok('receipt-complete', { receipt: f.receipt })).ok, true);
        assert.equal(await retire(f, handoff), true);
        assert.equal(await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' }), null);
        assert.equal((await b.ok('load', { workspaceId: f.workspaceId })).items[0].continuation.phase, 'ready');
        assert.equal(await b.ok('claim', { workspaceId: f.workspaceId }), null, 'B advanced in the READY gap before A finished.');
        const attemptId = randomUUID();
        assert.equal((await b.ok('lease-claim', { workspaceId: f.workspaceId, token: attemptId, owner: 'normal-module-successor' })).ok, true);
        const next = transfer({ ...f, handoff }, attemptId);
        const nextInput = { prompt: 'continue', queueItemId: 'A', queueClaimToken: f.binding.claimToken,
          queueContinuationProtocol: 1, queueContinuationNonce: handoff.nonce, queuePredecessorAttemptId: f.binding.attemptId };
        const changedOld = await b.ok('receipt-reserve', { ...f.initial, attemptId, input: nextInput });
        assert.equal(changedOld.ok, false); assert.equal(changedOld.code, 'input-mismatch');
        const second = await b.ok('receipt-reserve', { ownerId: f.initial.ownerId, workspaceId: f.workspaceId,
          requestId: next.expected.requestId, attemptId, input: nextInput });
        assert.equal(second.ok, true); assert.notEqual(second.receipt.buildRef, f.receipt.buildRef);
        const successor = await b.ok('bind', next);
        assert.equal(successor.attemptId, attemptId);
        assert.equal((await a.ok('load', { workspaceId: f.workspaceId })).items[0].status, 'running');
        assert.equal(await a.ok('settle', { workspaceId: f.workspaceId, binding: f.binding, ok: true }), false);
        assert.equal(await a.ok('continuation-cancel', { workspaceId: f.workspaceId, binding: f.binding }), false);
        assert.equal(await retire(f, handoff), false);
        assert.equal((await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' })).token, attemptId);
        assert.equal(await b.ok('settle', { workspaceId: f.workspaceId, binding: successor, ok: true }), true);
        assert.equal((await b.ok('receipt-complete', { receipt: second.receipt })).ok, true);
        const replay = await a.ok('receipt-reserve', { ...f.initial, attemptId: randomUUID() });
        assert.equal(replay.ok, false); assert.equal(replay.code, 'terminal'); assert.equal(replay.receipt.buildRef, f.receipt.buildRef);
        await b.ok('lease-release', { workspaceId: f.workspaceId, token: attemptId });
        assert.equal((await a.ok('claim', { workspaceId: f.workspaceId })).id, 'B');
        return { logicalA: ['running/pending', 'running/ready', 'running/successor', 'done'], nextStepAfterFinal: 'B',
          distinctWindowBillingRefs: true, originalReceiptReplay: replay.code, oldCallbacksRefused: true,
          limit: 'Explicit normal-retirement API invoked after fixture work; no builder body or physical SDK drain exercised.' };
      });

      await check('two real workers consume a one-use module handoff once', async () => {
        const f = await readyFixture('handoff-consume-race');
        const candidates = [randomUUID(), randomUUID()];
        const claims = await Promise.all([a.ok('lease-claim', { workspaceId: f.workspaceId, token: candidates[0], owner: 'handoff-worker-a' }),
          b.ok('lease-claim', { workspaceId: f.workspaceId, token: candidates[1], owner: 'handoff-worker-b' })]);
        assert.equal(claims.filter((value) => value.ok).length, 1);
        const attemptId = candidates[claims.findIndex((value) => value.ok)];
        const request = transfer(f, attemptId);
        // Both processes deliberately replay the same already-authorized attempt; the ticket CAS is
        // still one-use independently of the separate lease-race result above.
        const consumers = await Promise.all([a.ask('bind', request), b.ask('bind', request)]);
        // Capture durable evidence before the original exactly-one-ACK assertion can throw.
        // Keep that assertion: an observation must not silently convert UNKNOWN into success.
        if (consumers.filter((value) => value.ok).length !== 1 || consumers.some((value) => !value.ok && value.error?.code !== 'QUEUE_CLAIM_CONFLICT')) {
          await captureDrillAcknowledgments(control, { name: 'handoff-consume-race', order: 'concurrent', workspaceId: f.workspaceId,
            operations: { consumerA: consumers[0], consumerB: consumers[1] } });
        }
        assert.equal(consumers.filter((value) => value.ok).length, 1);
        assert.equal(consumers.find((value) => !value.ok).error.code, 'QUEUE_CLAIM_CONFLICT');
        const current = await control.ok('load', { workspaceId: f.workspaceId });
        assert.equal(current.items[0].boundAttemptId, attemptId);
        assert.equal(current.items[0].continuation, undefined);
        assert.equal(current.items[0].continuationWindow.requestId, request.expected.requestId);
        assert.equal(await control.ok('claim', { workspaceId: f.workspaceId }), null);
        return { leaseWinners: 1, ticketConsumers: 1, replayCode: 'QUEUE_CLAIM_CONFLICT', logicalA: 'running', nextStepBlocked: true };
      });

      await check('Stop and normal retirement serialize both queue readiness and predecessor lease deletion', async () => {
        const observed = [];
        for (const order of ['stop-first', 'retire-first', 'concurrent', 'concurrent-retire-ack-loss', 'concurrent-stop-ack-loss']) {
          const f = await moduleFixture(`handoff-stop-retire-${order}`); const handoff = await propose(f);
          let retired;
          let retirementAck = 'confirmed'; let stopAck = 'confirmed';
          if (order === 'stop-first') { await b.ok('continuation-stop', { workspaceId: f.workspaceId }); retired = await retire(f, handoff); }
          else if (order === 'retire-first') { retired = await retire(f, handoff); await b.ok('continuation-stop', { workspaceId: f.workspaceId }); }
          else {
            const [retirement, stopped] = await Promise.all([
              a.ask('continuation-retire', { workspaceId: f.workspaceId, binding: f.binding, nonce: handoff.nonce,
                ...(order === 'concurrent-retire-ack-loss' ? { fault: 'ack-loss' } : {}) }),
              b.ask('continuation-stop', { workspaceId: f.workspaceId,
                ...(order === 'concurrent-stop-ack-loss' ? { fault: 'ack-loss' } : {}) }),
            ]);
            if (order === 'concurrent-retire-ack-loss') assert.equal(retirement.ok, false);
            if (order === 'concurrent-stop-ack-loss') assert.equal(stopped.ok, false);
            if (retirement.ok) { assert.equal(typeof retirement.result, 'boolean'); retired = retirement.result; }
            else { assert.equal(retirement.error.code, 'QUEUE_STORE_UNAVAILABLE'); retirementAck = 'unknown'; }
            if (!stopped.ok) {
              assert.equal(stopped.error.code, 'QUEUE_STORE_UNAVAILABLE'); stopAck = 'unknown/reconciled';
              // Contention can exceed the real production deadline; UNKNOWN is not an operation
              // result. Confirm the same idempotent Stop before checking the durable invariant.
              const confirmed = await control.ok('continuation-stop', { workspaceId: f.workspaceId });
              assert.equal(confirmed.queuePaused, true);
            }
          }
          const current = await control.ok('load', { workspaceId: f.workspaceId });
          const lease = await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' });
          assert.equal(current.paused, true); assert.equal(current.items[0].continuation, undefined);
          if (retired === true) assert.equal(lease, null, 'READY committed without atomically deleting its predecessor lease.');
          else if (retired === false || lease !== null) { assert.equal(lease.token, f.binding.attemptId); assert.equal(lease.stopRequested, true); }
          assert.equal(await retire(f, handoff), false, 'Old cleanup recreated a cancelled handoff.');
          assert.equal(await control.ok('claim', { workspaceId: f.workspaceId }), null);
          observed.push({ order, retired: retired ?? 'unknown', retirementAck, stopAck, queuePaused: true,
            predecessorLease: lease ? 'stop-requested' : 'deleted-in-retirement' });
        }
        return { interleavings: observed, nextStepBlocked: true,
          injection: 'Two additional concurrent interleavings throw only AFTER an actual retirement or Stop commit; natural deadline outcomes remain explicitly unknown.' };
      });

      await check('Stop racing handoff consumption cancels the ticket and flags the current successor lease', async () => {
        const observed = [];
        for (const order of ['stop-first', 'consume-first', 'concurrent']) {
          const f = await readyFixture(`handoff-stop-consume-${order}`); const attemptId = randomUUID();
          assert.equal((await control.ok('lease-claim', { workspaceId: f.workspaceId, token: attemptId, owner: 'successor-before-stop' })).ok, true);
          const request = transfer(f, attemptId); let consumed; let stopped;
          const requireStoppedAcknowledgment = async () => {
            if (!stopped.ok) {
              await captureDrillAcknowledgments(control, { name: 'handoff-stop-consume', order, workspaceId: f.workspaceId,
                operations: { stop: stopped, consumer: consumed } });
            }
            // Same assertion as worker.ok: stop-first still cannot proceed to bind after an unconfirmed Stop.
            assert.equal(stopped.ok, true, `continuation-stop: ${stopped.error?.message}`);
          };
          if (order === 'stop-first') { stopped = await b.ask('continuation-stop', { workspaceId: f.workspaceId }); await requireStoppedAcknowledgment(); consumed = await a.ask('bind', request); }
          else if (order === 'consume-first') { consumed = await a.ask('bind', request); stopped = await b.ask('continuation-stop', { workspaceId: f.workspaceId }); await requireStoppedAcknowledgment(); }
          else { [consumed, stopped] = await Promise.all([a.ask('bind', request), b.ask('continuation-stop', { workspaceId: f.workspaceId })]); await requireStoppedAcknowledgment(); }
          if (!consumed.ok && consumed.error?.code !== 'QUEUE_CLAIM_CONFLICT') {
            await captureDrillAcknowledgments(control, { name: 'handoff-stop-consume', order, workspaceId: f.workspaceId,
              operations: { stop: stopped, consumer: consumed } });
          }
          const current = await control.ok('load', { workspaceId: f.workspaceId });
          const lease = await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' });
          assert.equal(current.paused, true); assert.equal(current.items[0].continuation, undefined);
          assert.equal(current.items[0].continuationWindow, undefined);
          assert.equal(lease.token, attemptId); assert.equal(lease.stopRequested, true);
          if (consumed.ok) { assert.equal(current.items[0].status, 'running'); assert.equal(current.items[0].boundAttemptId, attemptId); }
          else assert.equal(consumed.error.code, 'QUEUE_CLAIM_CONFLICT');
          await control.ok('lease-release', { workspaceId: f.workspaceId, token: attemptId });
          const replacement = randomUUID();
          assert.equal((await control.ok('lease-claim', { workspaceId: f.workspaceId, token: replacement, owner: 'post-stop-replay' })).ok, true);
          const replay = await a.ask('bind', { ...request, attemptId: replacement });
          assert.equal(replay.ok, false); assert.equal(replay.error.code, 'QUEUE_CLAIM_CONFLICT');
          observed.push({ order, consumedBeforeStop: consumed.ok, currentLeaseStopRequested: true, oldTicketReplay: replay.error.code });
        }
        return { interleavings: observed, physicalLimit: 'An already-issued provider operation is not revoked by this queue/lease transaction.' };
      });

      await check('normal retirement committed ACK loss reconciles READY from a fresh worker without replaying an old attempt', async () => {
        const f = await moduleFixture('handoff-retire-ack'); const handoff = await propose(f);
        const uncertain = await startWorker(endpoint);
        const lost = await uncertain.ask('continuation-retire', { workspaceId: f.workspaceId, binding: f.binding, nonce: handoff.nonce, fault: 'ack-loss' });
        const lostObservation = await captureDrillAcknowledgments(control, { name: 'retirement-committed-ack-loss', order: 'injected-after-commit', workspaceId: f.workspaceId,
          operations: { original: lost } });
        assert.equal(lostObservation.operations.original.acknowledgment, 'unconfirmed');
        assert.equal(lost.ok, false); assert.equal(lost.error.code, 'QUEUE_STORE_UNAVAILABLE');
        await uncertain.kill();
        const fresh = await startWorker(endpoint);
        assert.equal((await fresh.ok('load', { workspaceId: f.workspaceId })).items[0].continuation.phase, 'ready');
        assert.equal(await fresh.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' }), null);
        const attemptId = randomUUID();
        assert.equal((await fresh.ok('lease-claim', { workspaceId: f.workspaceId, token: attemptId, owner: 'retirement-ack-reconciler' })).ok, true);
        const request = transfer({ ...f, handoff }, attemptId);
        await fresh.ok('bind', request);
        const replay = await a.ask('bind', request);
        assert.equal(replay.ok, false); assert.equal(replay.error.code, 'QUEUE_CLAIM_CONFLICT');
        assert.equal(await retire(f, handoff), false);
        assert.equal((await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' })).token, attemptId);
        await fresh.kill();
        return { originalOutcome: lost.error.code, durableReconciliation: 'READY with predecessor lease absent', ticketConsumers: 1,
          injection: 'Throw once AFTER actual emulator queue-READY + predecessor-lease-delete transaction committed.' };
      });

      await check('handoff consumption committed ACK loss preserves the consumed window and refuses old nonce after restart', async () => {
        const f = await readyFixture('handoff-consume-ack'); const attemptId = randomUUID();
        assert.equal((await control.ok('lease-claim', { workspaceId: f.workspaceId, token: attemptId, owner: 'consume-ack-owner' })).ok, true);
        const request = transfer(f, attemptId); const uncertain = await startWorker(endpoint);
        const lost = await uncertain.ask('bind', { ...request, fault: 'ack-loss' });
        const lostObservation = await captureDrillAcknowledgments(control, { name: 'consumption-committed-ack-loss', order: 'injected-after-commit', workspaceId: f.workspaceId,
          operations: { original: lost } });
        assert.equal(lostObservation.operations.original.acknowledgment, 'unconfirmed');
        assert.equal(lost.ok, false); assert.equal(lost.error.code, 'QUEUE_STORE_UNAVAILABLE');
        await uncertain.kill();
        const fresh = await startWorker(endpoint);
        const current = await fresh.ok('load', { workspaceId: f.workspaceId });
        assert.equal(current.items[0].boundAttemptId, attemptId); assert.equal(current.items[0].continuation, undefined);
        assert.equal(current.items[0].continuationWindow.requestId, request.expected.requestId);
        const replay = await fresh.ask('bind', request);
        assert.equal(replay.ok, false); assert.equal(replay.error.code, 'QUEUE_CLAIM_CONFLICT');
        await fresh.ok('lease-release', { workspaceId: f.workspaceId, token: attemptId });
        const replacement = randomUUID();
        assert.equal((await fresh.ok('lease-claim', { workspaceId: f.workspaceId, token: replacement, owner: 'consume-ack-retry' })).ok, true);
        const laterReplay = await fresh.ask('bind', { ...request, attemptId: replacement });
        assert.equal(laterReplay.ok, false); assert.equal(laterReplay.error.code, 'QUEUE_CLAIM_CONFLICT');
        assert.equal(await fresh.ok('claim', { workspaceId: f.workspaceId }), null);
        await fresh.kill();
        return { originalOutcome: lost.error.code, durableWindowAttempt: attemptId, requestIdentityPreserved: true,
          replayAfterLeaseReplacement: laterReplay.error.code, injection: 'Throw once AFTER actual emulator handoff-consume + successor-bind commit.' };
      });

      await check('late module error cancels pending handoff and cannot be turned into readiness', async () => {
        const f = await moduleFixture('handoff-late-error'); const handoff = await propose(f);
        assert.equal(await b.ok('continuation-cancel', { workspaceId: f.workspaceId, binding: f.binding, note: 'Injected late cleanup failure; review required.' }), true);
        assert.equal(await retire(f, handoff), false);
        const current = await control.ok('load', { workspaceId: f.workspaceId });
        assert.equal(current.paused, true); assert.equal(current.items[0].status, 'failed'); assert.equal(current.items[0].continuation, undefined);
        assert.equal((await control.ok('durable', { workspaceId: f.workspaceId, collection: 'agentv3_build_leases' })).token, f.binding.attemptId);
        await a.ok('lease-release', { workspaceId: f.workspaceId, token: f.binding.attemptId });
        assert.equal(await b.ok('claim', { workspaceId: f.workspaceId }), null);
        return { logicalA: 'failed/paused-for-review', nextStepBlocked: true, lateReadiness: false,
          injection: 'Explicit cancellation API simulates the post-result error branch; actual HTTP/body wiring is tested separately.' };
      });
    } else {
      console.log(JSON.stringify({ additiveContinuationDrills: 'skipped: normal-module continuation API is absent from this negative-control revision' }));
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
  console.log(JSON.stringify({ summary: { passed: records.length - failed.length, failed: failed.length, total: records.length }, negativeControl: args.includes('--expect-regressions'), limits: ['No paid model/E2B/Cloud Run calls', 'Recovery decision clock explicitly advanced', 'SDK deadline and acknowledgement loss are explicitly injected around a real emulator', 'Normal-module retirement API called after fixture work; physical runtime/process drain is not exercised', 'HTTP authentication and route admission are covered separately'] }));
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
