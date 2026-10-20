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
  console.log(`Autopsy Firestore drills: ${passed} passed; 0 failed. No production data or paid providers were used.`);
} finally {
  await db.terminate();
  await Promise.all(admin.apps.map(app => app.delete()));
}
