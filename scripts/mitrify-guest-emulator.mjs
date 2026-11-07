#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { runMitrifyPublicBot, runMitrifyContinuation, runMitrifyGuestTest, mitrifyChainBinding, runApprovedMitrifyChain } from '../src/server/lib/mitrify.ts';

// Never contact real Firestore or a gateway. Must be an explicitly selected loopback emulator.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  console.error('A loopback Firestore emulator is required.'); process.exit(1);
}
let upstreamCalls = 0; let continuationPhase = false;
const continuationRefs = [];
const server = createServer((_req, res) => { upstreamCalls++;
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '4' }, ...(continuationPhase ? { finish_reason: 'length' } : {}) }] })); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const dbs = [0, 1].map(() => new Firestore({ projectId: 'demo-navbharatai-phase2' }));
const campaignId = randomUUID();
const env = { AI_BACKEND: 'mitrify', MITRIFY_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`,
  MITRIFY_API_KEY: randomUUID(), MITRIFY_GUEST_TEST_ENABLED: '1', MITRIFY_GUEST_TEST_CAMPAIGN: campaignId,
  MITRIFY_GUEST_TEST_TOKEN: randomUUID(), MITRIFY_MODEL: 'mock-policy' };
const digest = value => createHash('sha256').update(value).digest('hex');
const record = { enabled: true, createdAtMs: Date.now(), expiresAtMs: Date.now() + 60_000,
  baseURL: env.MITRIFY_BASE_URL, model: env.MITRIFY_MODEL, credentialFingerprint: digest(env.MITRIFY_API_KEY),
  tokenFingerprint: digest(env.MITRIFY_GUEST_TEST_TOKEN), maxTotalUsd: 10, includesAllCharges: true, hardCapConfirmed: true };
const chainBody = { messages: [{ role: 'user', content: 'What is 2 + 2?' }], max_tokens: 16 };
const chainEnv = { ...env, MITRIFY_CHAIN_ENABLED: '1' };
const binding = mitrifyChainBinding('emulator-public-user', chainBody, chainEnv);
const approvalRef = dbs[0].doc(`mitrify_chain_approvals/${binding.id}`);
const ref = dbs[0].doc(`mitrify_test_campaigns/${campaignId}`);
const call = (db, slot) => runMitrifyGuestTest({ db, token: env.MITRIFY_GUEST_TEST_TOKEN,
  body: { batch: 10, slot }, signal: AbortSignal.timeout(30_000) }, env, () => {});
try {
  await ref.create(record);
  const calls = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => call(dbs[i % 2], 0)));
  assert.equal(calls.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(upstreamCalls, 1);
  assert.ok(calls.filter(r => r.status === 'rejected').every(r => ['MITRIFY_GUEST_TEST_REPLAY', 'MITRIFY_GUEST_TEST_UNAVAILABLE'].includes(r.reason.code)));
  assert.equal((await ref.collection('claims').get()).size, 1);
  await assert.rejects(call(dbs[1], 0), { code: 'MITRIFY_GUEST_TEST_REPLAY' });
  assert.equal((await call(dbs[1], 1)).status, 200);
  await ref.update({ enabled: false });
  await assert.rejects(call(dbs[0], 2), { code: 'MITRIFY_GUEST_TEST_UNAVAILABLE' });
  assert.equal(upstreamCalls, 2);
  await approvalRef.create({ kind: 'mitrify-exact-public-approval-v1', uid: 'emulator-public-user',
    payloadDigest: binding.payloadDigest, gateway: binding.gateway, state: 'approved',
    reviewedAtMs: Date.now(), expiresAtMs: Date.now() + 60000,
    publicReview: { entirePayloadReviewed: true, containsSensitiveData: false, reviewRef: 'synthetic-emulator-review' },
    supplierContract: { currency: 'USD', hardCeilingEnforced: true, includesInternalRetriesFailoversAndFees: true,
      evidenceRef: 'synthetic-emulator-contract', perHttpRequestCeilingNanoUsd: 100 } });
  let reservations = 0;
  const approved = await Promise.all(Array.from({ length: 10 }, (_, i) => runApprovedMitrifyChain({
    db: dbs[i % 2], uid: 'emulator-public-user', requestId: randomUUID(), body: chainBody,
    privateTurn: false, healthTurn: false, signal: AbortSignal.timeout(30000),
    reserve: async maximum => { assert.equal(maximum, 400); reservations++; return { releaseUndispatched: async () => {} }; },
  }, chainEnv, () => {})));
  assert.equal(approved.filter(r => r.kind === 'response').length, 1);
  assert.equal(reservations, 1); assert.equal(upstreamCalls, 3);
  assert.equal((await approvalRef.get()).data().attemptsStarted, 1);
  continuationPhase = true;
  let continuationFunding = 0;
  const botEnv = { ...env, MITRIFY_BOT_ACCESS: 'verified' };
  const identify = async () => ({ uid: 'emulator-public-user', email: 'public@example.invalid', emailVerified: true });
  const admission = { runOnce: async (_claim, execute) => { continuationFunding++; return execute(); } }; // Mock funding only.
  const first = await runMitrifyPublicBot({ identify, signal: AbortSignal.timeout(30000), continuation: { db: dbs[0], admission },
    body: { message: 'Explain rainbows.', publicContentConfirmed: true } }, botEnv, () => {});
  continuationRefs.push(dbs[0].doc(`mitrify_bot_continuations/${first.continuation.ticket}`));
  const continued = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => runMitrifyContinuation({ identify, signal: AbortSignal.timeout(30000),
    continuation: { db: dbs[i % 2], admission }, body: { ticket: first.continuation.ticket, prompt: 'Explain rainbows.', answer: first.reply,
      reviewedInstruction: first.continuation.instruction, publicContentConfirmed: true } }, botEnv, () => {})));
  assert.equal(continued.filter(r => r.status === 'fulfilled').length, 1);
  const next = continued.find(r => r.status === 'fulfilled').value;
  continuationRefs.push(dbs[0].doc(`mitrify_bot_continuations/${next.continuation.ticket}`));
  assert.equal(continuationFunding, 1); assert.equal(upstreamCalls, 5);
  console.log('PASS: two real Firestore clients claim one continuation; one funding callback and one HTTP attempt.');
  console.log('PASS: two real Firestore clients allow one exact public approval claim and one monetary reservation.');
  console.log('PASS: two Firestore clients share immutable admission; replay/revocation deny dispatch.');
} catch {
  console.error('FAIL: controlled guest emulator admission check.'); process.exitCode = 1;
} finally {
  await dbs[0].recursiveDelete(ref);
  await approvalRef.delete();
  await Promise.all(continuationRefs.map(ref => ref.delete()));
  await Promise.all(dbs.map(db => db.terminate()));
  server.closeAllConnections(); server.close();
}
