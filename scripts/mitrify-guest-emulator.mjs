#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { runMitrifyGuestTest } from '../src/server/lib/mitrify.ts';

// Never contact real Firestore or a gateway. Must be an explicitly selected loopback emulator.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  console.error('A loopback Firestore emulator is required.'); process.exit(1);
}
let upstreamCalls = 0;
const server = createServer((_req, res) => { upstreamCalls++;
  res.setHeader('Content-Type', 'application/json'); res.end('{"choices":[{"message":{"content":"4"}}]}'); });
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
  console.log('PASS: two Firestore clients share immutable admission; replay/revocation deny dispatch.');
} catch {
  console.error('FAIL: controlled guest emulator admission check.'); process.exitCode = 1;
} finally {
  await dbs[0].recursiveDelete(ref);
  await Promise.all(dbs.map(db => db.terminate()));
  server.closeAllConnections(); server.close();
}
