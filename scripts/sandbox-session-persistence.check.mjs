// Credential-free, real Firestore regression drill. Never targets a production database/provider.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';

const host = process.argv[process.argv.indexOf('--emulator') + 1];
assert.ok(process.argv.includes('--emulator') && /^127\.0\.0\.1:\d+$/.test(host), 'Explicit loopback --emulator required');
process.env.FIRESTORE_EMULATOR_HOST = host;
const { SandboxStore } = await import('../src/server/AgentV3/SandboxStore.ts');
const { snapshotMatchesFiles } = await import('../src/server/AgentV3/snapshotIdentity.ts');
const db = new Firestore({ projectId: 'demo-navbharatai-phase2', host, ssl: false });
const store = new SandboxStore(() => db);
const workspaceId = `session-integrity-${randomUUID()}`;
const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
const identity = { workspaceId, sandboxId: 'synthetic-vm', updatedAt: 5, userId: 'synthetic-owner', snapshotUrl: 'synthetic-snapshot', recipe: { command: 'keep' }, allocation: { opaque: 'keep' }, declaredPort: 4000 };
const make = (startedAt = 100) => ({ observationId: randomUUID(), sandboxId: identity.sandboxId, startedAt, origin: 'resumed', reason: 'build', busyMs: 0, ops: 0 });
const end = (s) => ({ ...s, endedAt: s.startedAt + 10, endedBy: 'dropped', busyMs: 2, ops: 1 });
const read = async () => (await ref.get()).data();
const a = make(), b = make(200);
const pending = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
try {
  const daily = db.collection('agentv3_sandbox_starts').doc('1970-01-01');
  const countedBefore = (await daily.get()).data()?.counts?.build ?? 0;
  await ref.set({ ...identity, session: end(a) });
  await store.recordSessionStart(workspaceId, b);
  check(await read(), { ...identity, session: b }); // Whole-map replacement, unrelated fields survive.
  // Counter is deliberately detached from session completion; verify its actual SDK increment.
  const counterDeadline = Date.now() + 10_000;
  while ((await daily.get()).data()?.counts?.build !== countedBefore + 1 && Date.now() < counterDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  check((await daily.get()).data()?.counts?.build, countedBefore + 1);
  await store.recordSessionEnd(workspaceId, end(a));
  check((await read()).session, b);
  await store.recordSessionStart(workspaceId, a);
  await store.recordSessionStart(workspaceId, { ...a, startedAt: b.startedAt });
  check((await read()).session, b);
  await store.recordSessionEnd(workspaceId, end(b));
  await store.recordSessionStart(workspaceId, b);
  await store.recordSessionEnd(workspaceId, { ...end(b), endedAt: 999 });
  check((await read()).session, end(b));

  // Concurrent independent store instances contend on the actual database, not an in-memory mock.
  await ref.set(identity);
  const observations = Array.from({ length: 6 }, (_, i) => make(300 + i));
  await Promise.all(observations.map((s) => new SandboxStore(() => db).recordSessionStart(workspaceId, s)));
  check((await read()).session, observations.at(-1));
  await Promise.all(observations.map((s) => new SandboxStore(() => db).recordSessionEnd(workspaceId, end(s))));
  check((await read()).session, end(observations.at(-1)));

  for (const row of [undefined, { workspaceId }, { ...identity, sandboxId: 'different' }, { ...identity, workspaceId: 'wrong' }]) {
    if (row) await ref.set(row); else await ref.delete();
    await store.recordSessionStart(workspaceId, a); await store.recordSessionEnd(workspaceId, end(a));
    check(await read(), row);
  }
  for (const session of [null, [], 'broken', { ...a, startedAt: '100' }, { ...a, observationId: 'not-an-observation' }]) {
    await ref.set({ ...identity, session });
    await store.recordSessionStart(workspaceId, b); await store.recordSessionEnd(workspaceId, end(a));
    check((await read()).session, session);
  }
  const { observationId: _legacyId, ...legacy } = a;
  await ref.set({ ...identity, session: legacy });
  await store.recordSessionEnd(workspaceId, { ...end(legacy) }); check((await read()).session, legacy);
  await store.recordSessionStart(workspaceId, b); check((await read()).session, b);

  // A direct end with no admitted start is never invented. A later start stays open/unknown.
  await ref.set(identity); await store.recordSessionEnd(workspaceId, end(a)); check(await read(), identity);
  await store.recordSessionStart(workspaceId, a); check((await read()).session, a);

  // Exactly one EXISTING touch, then the telemetry chain. No telemetry may create identity itself.
  await ref.delete(); const touch = pending();
  const originalTouch = touch.promise.then(() => store.touch(workspaceId, identity.sandboxId));
  const originalStart = store.recordSessionStart(workspaceId, a, originalTouch);
  const queuedEnd = originalStart.then(() => store.recordSessionEnd(workspaceId, end(a)));
  check(await read(), undefined); touch.resolve(); await queuedEnd;
  check((await read()).session, end(a)); check((await read()).sandboxId, identity.sandboxId);
  await ref.delete();
  await store.recordSessionStart(workspaceId, a, Promise.reject(Error('initial touch failed')));
  await store.recordSessionEnd(workspaceId, end(a)); check(await read(), undefined);
  await store.touch(workspaceId, identity.sandboxId);
  await store.recordSessionStart(workspaceId, a, Promise.reject(Error('touch committed; ACK lost')));
  check((await read()).session, a);

  // Actual committed start with simulated lost acknowledgement, then exact-ID end.
  await ref.set(identity);
  const ackLostStore = new SandboxStore(() => ({
    collection: db.collection.bind(db),
    runTransaction: async (callback) => { await db.runTransaction(callback); throw Error('start ACK lost'); },
  }));
  await ackLostStore.recordSessionStart(workspaceId, a);
  await store.recordSessionEnd(workspaceId, end(a)); check((await read()).session, end(a));

  await ref.set(identity); const deletedTouch = pending();
  const afterDeletion = store.recordSessionStart(workspaceId, a, deletedTouch.promise);
  await ref.delete(); deletedTouch.resolve(); await afterDeletion; check(await read(), undefined);

  // Unchanged old touch race is deliberately exposed: telemetry cannot repair allocation authority.
  const newer = { ...b, sandboxId: 'new-vm' };
  await ref.set({ ...identity, sandboxId: newer.sandboxId, session: newer });
  await store.touch(workspaceId, a.sandboxId); // Existing unconditional identity writer can roll it back.
  await store.recordSessionStart(workspaceId, a);
  await store.recordSessionEnd(workspaceId, end(newer));
  check((await read()).sandboxId, a.sandboxId); check((await read()).session, newer);

  await ref.set({ ...identity, session: { ...a, startedAt: 999999 } });
  await store.recordSessionStart(workspaceId, b);
  check((await read()).session.startedAt, 999999); // Reported-clock high water, not physical chronology.
  // Snapshot identity is derived metadata: unknown replacement must not inherit a previous hash.
  for (const hash of [null, undefined, '']) {
    await ref.set({ ...identity, session: b, snapshotFilesHash: 'old-hash', snapshotAt: 1 });
    await store.saveSnapshot(workspaceId, 'new-synthetic-url', 2, hash);
    const saved = await read();
    check(saved.snapshotFilesHash, undefined);
    check(snapshotMatchesFiles(saved.snapshotFilesHash, 'old-hash'), undefined);
    check({ ...saved, updatedAt: 5 }, { ...identity, session: b, snapshotUrl: 'new-synthetic-url', snapshotAt: 2 });
  }
  await ref.set({ ...identity, session: b, snapshotFilesHash: 'old-hash' });
  await store.saveSnapshot(workspaceId, identity.snapshotUrl, 3, null);
  check((await read()).snapshotFilesHash, undefined); check((await read()).snapshotUrl, identity.snapshotUrl);
  await store.saveSnapshot(workspaceId, 'known-synthetic-url', 4, 'new-hash');
  check((await read()).snapshotFilesHash, 'new-hash');
  check(snapshotMatchesFiles((await read()).snapshotFilesHash, 'old-hash'), false);
  await ref.delete(); await store.saveSnapshot(workspaceId, 'first-synthetic-url', 5);
  check((await read()).snapshotFilesHash, undefined); check((await read()).snapshotAt, 5);
  console.log(`PASS: ${checks} real Firestore session integrity assertions, concurrent instances, fresh-touch sequencing, lost ACKs, deletion, explicit unchanged old-touch identity race, and snapshot hash invalidation. No E2B calls.`);
} finally {
  await ref.delete(); // Exact synthetic document only, explicit loopback emulator above.
  await db.terminate();
}
