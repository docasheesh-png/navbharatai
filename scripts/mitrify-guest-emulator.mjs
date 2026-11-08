#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { mitrifyChainBinding, runApprovedMitrifyChain } from '../src/server/lib/mitrify.ts';
// Retained filename for CI compatibility. Only main-chain approval admission is tested.
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  console.error('A loopback Firestore emulator is required.'); process.exit(1);
}
let upstreamCalls = 0;
const server = createServer((_req, res) => { upstreamCalls++;
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '4' }, finish_reason: 'stop' }] })); });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const dbs = [0, 1].map(() => new Firestore({ projectId: 'demo-navbharatai-phase2' }));
const chainEnv = { MITRIFY_CHAIN_ENABLED: '1', MITRIFY_BASE_URL: `http://127.0.0.1:${server.address().port}/v1`, MITRIFY_API_KEY: randomUUID(), MITRIFY_MODEL: 'mock-policy' };
const chainBody = { messages: [{ role: 'user', content: 'What is 2 + 2?' }], max_tokens: 16 };
const binding = mitrifyChainBinding('emulator-public-user', chainBody, chainEnv);
const approvalRef = dbs[0].doc(`mitrify_chain_approvals/${binding.id}`);
try {
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
  assert.equal(reservations, 1); assert.equal(upstreamCalls, 1);
  assert.equal((await approvalRef.get()).data().attemptsStarted, 1);
  console.log('PASS: two real Firestore clients claim one main-chain approval and one monetary reservation.');
} catch {
  console.error('FAIL: main-chain emulator admission check.'); process.exitCode = 1;
} finally {
  await approvalRef.delete();
  await Promise.all(dbs.map(db => db.terminate()));
  server.closeAllConnections(); server.close();
}
