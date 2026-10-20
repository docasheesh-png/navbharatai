#!/usr/bin/env node
/**
 * Real database autopsy drills, credential-free and emulator-only.
 * Run with Node 22: node --import ./node_modules/tsx/dist/loader.mjs
 *   scripts/failedReportAutopsy.check.mjs --emulator 127.0.0.1:18781
 * The CI queue-drill job already owns this loopback emulator. No production fallback is allowed.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const endpoint = process.argv[process.argv.indexOf('--emulator') + 1];
assert.match(endpoint ?? '', /^127\.0\.0\.1:\d+$/, 'An explicit loopback emulator is required.');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint);
const project = 'demo-navbharatai-phase2';
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp({ projectId: project }, `autopsy-${randomUUID()}`);
const db = getFirestore(admin.apps.at(-1), '(default)');
db.settings({ ignoreUndefinedProperties: true });
const { setServerDb } = await import('../src/server/lib/serverDb.ts');
let loseAcknowledgement = false;
setServerDb({
  collection: name => db.collection(name),
  getAll: (...refs) => db.getAll(...refs),
  runTransaction: async fn => {
    const result = await db.runTransaction(fn);
    if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Injected lost acknowledgement after commit'); }
    return result;
  },
});
const { failedReportDigest } = await import('../src/server/lib/failedBuildReports.ts');
const { readFailedReportAutopsy, updateFailedReportAutopsy } = await import('../src/server/lib/failedReportAutopsy.ts');
const { reportOAuthService, REPORT_SCOPE, REPORT_AUTOPSY_SCOPE } = await import('../src/server/lib/failedReportOAuth.ts');
const workspace = `autopsy-drill-${randomUUID()}`, history = '100';
const report = { ok: false, startedAt: 100, endedAt: 101, summary: 'Synthetic emulator evidence, never a customer report.' };
const reportRef = db.collection('workspace_diagnostics_v3').doc(workspace).collection('history').doc(history);
await reportRef.set({ report });
const base = { expectedRevision: 0, reportDigest: failedReportDigest(report), mutationId: randomUUID(), status: 'in_progress',
  summary: 'Synthetic review for real transaction, conflict and retry verification.', ledgerUrl: '',
  counts: { total: 1, resolved: 0, blocked: 0 }, blockers: '', verification: null, reason: 'Emulator regression drill' };
let passed = 0;
const check = (name) => { passed++; console.log(`PASS ${passed}: ${name}`); };
try {
  assert.equal((await readFailedReportAutopsy(workspace, history)).state, 'not_started');
  check('absence is unreviewed, not done');
  loseAcknowledgement = true;
  await assert.rejects(updateFailedReportAutopsy(workspace, history, base, 'admin:owner'), /lost acknowledgement/);
  const retry = await updateFailedReportAutopsy(workspace, history, base, 'admin:owner');
  assert.equal(retry.revision, 1);
  const key = createHash('sha256').update(JSON.stringify([workspace, history])).digest('hex');
  const meta = db.collection('admin_failed_report_autopsies').doc(key);
  assert.equal((await meta.collection('revisions').get()).size, 1);
  assert.equal((await meta.collection('mutations').get()).size, 1);
  check('lost real commit acknowledgement retries without duplicate audit');
  const contenders = await Promise.allSettled(Array.from({ length: 8 }, () =>
    updateFailedReportAutopsy(workspace, history, { ...base, expectedRevision: 1, mutationId: randomUUID() }, 'admin:owner')));
  assert.equal(contenders.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await readFailedReportAutopsy(workspace, history)).revision, 2);
  assert.equal((await meta.collection('revisions').get()).size, 2);
  assert.equal((await meta.collection('mutations').get()).size, 2);
  assert.deepEqual((await reportRef.get()).data(), { report });
  check('eight concurrent real transactions have one winner; diagnostic report unchanged');
  await assert.rejects(updateFailedReportAutopsy(workspace, history,
    { ...base, expectedRevision: 2, mutationId: randomUUID(), status: 'done',
      ledgerUrl: `https://github.com/docasheesh-png/navbharatai/blob/${'a'.repeat(40)}/docs/synthetic.md` },
    'admin:owner'), /every item resolved/);
  assert.equal((await meta.collection('revisions').get()).size, 2);
  check('incomplete evidence cannot become done or leave a partial audit');
  await reportRef.set({ report: { ...report, newEvidence: 'A later retained warning.' } });
  assert.equal((await readFailedReportAutopsy(workspace, history)).state, 'stale');
  assert.equal((await updateFailedReportAutopsy(workspace, history, base, 'admin:owner')).state, 'stale');
  await assert.rejects(updateFailedReportAutopsy(workspace, history,
    { ...base, expectedRevision: 2, mutationId: randomUUID() }, 'admin:owner'), /report changed/);
  check('changed retained evidence invalidates status and rejects stale saves');
  const service = reportOAuthService(() => db, () => 'autopsy-emulator-owner');
  const client = await service.register({ redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none' });
  const verifier = 'v'.repeat(64), challenge = createHash('sha256').update(verifier).digest('base64url');
  async function grant(scope) {
    const url = await service.authorize({ client_id: client.client_id, redirect_uri: client.redirect_uris[0],
      response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, ...(scope ? { scope } : {}) });
    const id = new URL(url).searchParams.get('oauth_request');
    const redirect = await service.decide(id, true, scope);
    return service.token({ client_id: client.client_id, grant_type: 'authorization_code',
      code: new URL(redirect).searchParams.get('code'), redirect_uri: client.redirect_uris[0], code_verifier: verifier });
  }
  const read = await grant();
  assert.equal(await service.tokenOk(`Bearer ${read.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  const dual = await grant(`${REPORT_SCOPE} ${REPORT_AUTOPSY_SCOPE}`);
  assert.equal(await service.tokenOk(`Bearer ${dual.access_token}`, REPORT_AUTOPSY_SCOPE), true);
  assert.equal(await service.tokenOk(`Bearer ${read.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  check('fresh consent creates a write grant without widening the old real read grant');
  await service.revoke({ client_id: client.client_id, token: dual.access_token });
  assert.equal(await service.tokenOk(`Bearer ${dual.access_token}`, REPORT_AUTOPSY_SCOPE), false);
  await assert.rejects(service.token({ client_id: client.client_id, grant_type: 'refresh_token', refresh_token: dual.refresh_token }), /Invalid OAuth/);
  check('revocation stops both real access and refresh tokens');
  // Real Firestore retention transactions, not only an in-memory ordering model.
  const { purgeExpired, RETENTION_POLICIES } = await import('../src/server/lib/DataRetentionManager.ts');
  const { RETENTION_PURGE_TOKEN } = await import('../src/server/lib/retentionFence.ts');
  const autopsyPolicy = RETENTION_POLICIES.find(p => p.collection === 'admin_failed_report_autopsies');
  assert.equal(autopsyPolicy.fenced, true);
  const now = Date.now(), cutoff = now - autopsyPolicy.ttlDays * 86_400_000;
  async function fixture(updatedAt = cutoff - 1) {
    const ws = `autopsy-retention-${randomUUID()}`;
    const source = db.collection('workspace_diagnostics_v3').doc(ws).collection('history').doc(history);
    await source.set({ report });
    const input = { ...base, mutationId: randomUUID() };
    await updateFailedReportAutopsy(ws, history, input, 'admin:owner', updatedAt);
    const id = createHash('sha256').update(JSON.stringify([ws, history])).digest('hex');
    return { ws, source, input, meta: db.collection('admin_failed_report_autopsies').doc(id) };
  }
  const purge = (handle = db, maxPerRun = 500) => purgeExpired(handle, now, [{ ...autopsyPolicy, maxPerRun }]);
  const old = await fixture();
  let result = await purge();
  assert.equal(result.collections[0].error, undefined);
  assert.equal(result.totalDeleted, 3);
  assert.equal((await old.meta.get()).exists, false);
  for (const sub of ['revisions', 'mutations']) assert.equal((await old.meta.collection(sub).get()).size, 0);
  assert.deepEqual((await old.source.get()).data(), { report });
  check('real expiry removes both metadata children before parent and preserves source report');

  const boundary = await fixture(cutoff), fresh = await fixture(now);
  assert.equal((await purge()).totalDeleted, 0);
  assert.equal((await boundary.meta.get()).exists, true);
  assert.equal((await fresh.meta.get()).exists, true);
  check('fresh and exact-cutoff reviews survive real Firestore expiry query');

  const refreshed = await fixture();
  let refreshBeforeClaim = true;
  result = await purge({ collection: name => db.collection(name), runTransaction: async fn => {
    if (refreshBeforeClaim) {
      refreshBeforeClaim = false;
      await updateFailedReportAutopsy(refreshed.ws, history,
        { ...refreshed.input, expectedRevision: 1, mutationId: randomUUID() }, 'admin:owner', now);
    }
    return db.runTransaction(fn);
  } });
  assert.equal(result.totalDeleted, 0);
  assert.equal((await refreshed.meta.get()).data().revision, 2);
  assert.equal((await refreshed.meta.get()).data()[RETENTION_PURGE_TOKEN], undefined);
  check('refresh after expiry nomination wins before transaction fence claim');

  const paused = await fixture();
  result = await purge(db, 1);
  assert.equal(result.totalDeleted, 1);
  assert.equal(result.collections[0].capped, true);
  assert.equal(typeof (await paused.meta.get()).data()[RETENTION_PURGE_TOKEN], 'string');
  await assert.rejects(updateFailedReportAutopsy(paused.ws, history,
    { ...paused.input, expectedRevision: 1, mutationId: randomUUID() }, 'admin:owner'), /cleanup is in progress/);
  await assert.rejects(updateFailedReportAutopsy(paused.ws, history, paused.input, 'admin:owner'), /cleanup is in progress/);
  await assert.rejects(readFailedReportAutopsy(paused.ws, history), /cleanup is in progress/);
  result = await purge();
  assert.equal(result.totalDeleted, 2);
  assert.equal((await paused.meta.get()).exists, false);
  assert.deepEqual((await paused.source.get()).data(), { report });
  check('child-inclusive cap preserves resumable fence; writer, replay and read refuse partial cleanup');

  const stale = await fixture();
  let claimed;
  const claimReached = new Promise(resolve => { claimed = resolve; });
  let release;
  const resume = new Promise(resolve => { release = resolve; });
  let first = true;
  const stalled = purge({ collection: name => db.collection(name), runTransaction: async fn => {
    const value = await db.runTransaction(fn);
    if (first) { first = false; claimed(); await resume; }
    return value;
  } });
  await claimReached;
  // A second real worker drains the old generation while the first holds its old token.
  result = await purge();
  assert.equal(result.totalDeleted, 3);
  await updateFailedReportAutopsy(stale.ws, history,
    { ...stale.input, mutationId: randomUUID() }, 'admin:owner', now);
  release();
  result = await stalled;
  assert.equal(result.collections[0].error, undefined);
  assert.equal(result.totalDeleted, 0);
  assert.equal((await stale.meta.get()).data().revision, 1);
  assert.equal((await stale.meta.get()).data().updatedAt, now);
  for (const sub of ['revisions', 'mutations']) assert.equal((await stale.meta.collection(sub).get()).size, 1);
  assert.deepEqual((await stale.source.get()).data(), { report });
  check('stale real cleaner cannot delete recreated metadata or its new audit children');
  const large = await fixture();
  const unicode = '漢'.repeat(4000);
  const largeInput = { ...large.input, status: 'blocked', summary: unicode, blockers: unicode,
    counts: { total: 1, resolved: 0, blocked: 1 },
    verification: { scope: 'source_and_tests', commitSha: 'a'.repeat(40),
      pullRequestUrl: 'https://github.com/docasheesh-png/navbharatai/pull/1',
      ciRunUrl: 'https://github.com/docasheesh-png/navbharatai/actions/runs/1', testSummary: unicode } };
  assert.ok(Buffer.byteLength(JSON.stringify(largeInput)) < 64 * 1024);
  for (let revision = 1; revision < 33; revision++) {
    await updateFailedReportAutopsy(large.ws, history,
      { ...largeInput, expectedRevision: revision, mutationId: randomUUID() }, 'admin:owner', cutoff - 1);
  }
  let maxChildrenRead = 0;
  result = await purge({ collection: name => db.collection(name), runTransaction: fn => db.runTransaction(async tx => {
    let reads = 0;
    const value = await fn({ get: ref => { reads++; return tx.get(ref); },
      update: (...args) => tx.update(...args), delete: ref => tx.delete(ref) });
    maxChildrenRead = Math.max(maxChildrenRead, reads - 1);
    return value;
  }) });
  assert.equal(result.collections[0].error, undefined);
  assert.equal(result.totalDeleted, 67);
  assert.ok(maxChildrenRead > 0 && maxChildrenRead <= 16, 'Fenced transactions need a small schema-bounded child batch.');
  assert.equal((await large.meta.get()).exists, false);
  for (const sub of ['revisions', 'mutations']) assert.equal((await large.meta.collection(sub).get()).size, 0);
  assert.deepEqual((await large.source.get()).data(), { report });
  check('near-max Unicode review revisions drain in conservative bounded real transaction batches');
  console.log(`Autopsy Firestore drills: ${passed} passed; 0 failed. No production data or paid providers were used.`);
} finally {
  await db.terminate();
  await Promise.all(admin.apps.map(app => app.delete()));
}
