#!/usr/bin/env node
/** The Firestore half of the edit-promotion system, against the loopback emulator: no provider calls, no credentials.
 *  - FirestoreRevisionStore.promote is an atomic compare-and-swap across instances (one winner), idempotent per edit id;
 *  - FirestoreRequirementsStore.record is a transaction (concurrent messages are all kept, a replay changes nothing).
 * Run: FIRESTORE_EMULATOR_HOST=127.0.0.1:18781 node --import ./node_modules/tsx/dist/loader.mjs \
 *        scripts/projectRevisions.check.mjs --emulator 127.0.0.1:18781
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const position = process.argv.indexOf('--emulator');
assert.ok(position >= 0, 'Explicit --emulator is required');
const endpoint = process.argv[position + 1];
assert.match(endpoint ?? '', /^127\.0\.0\.1:\d+$/, 'Only a loopback emulator is allowed');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint, 'No production fallback');
process.env.NODE_ENV = 'test';
globalThis.fetch = async () => { throw new Error('Network forbidden in the revision drill'); };

const require = createRequire(import.meta.url);
const { Firestore } = require('firebase-admin/firestore');
const settings = { projectId: 'demo-navbharatai-phase2', databaseId: `rev-drill-${randomUUID()}`, host: endpoint, ssl: false };
const dbA = new Firestore(settings);
const dbB = new Firestore(settings);
const { FirestoreRevisionStore, buildRevision } = await import('../src/server/AgentV3/projectRevisions.ts');
const { FirestoreRequirementsStore } = await import('../src/server/AgentV3/projectRequirementsStore.ts');
const { activeRequirements } = await import('../src/server/AgentV3/projectRequirements.ts');

const validation = { previewGreen: true, checks: ['drill'] };
const rev = (projectId, parentId, editId, files, kind = 'edit') => buildRevision({ projectId, parentId, editId, kind, files, validation, now: Date.now() });

// 1. one winner among concurrent promotions from the same parent, across two instances
{
  const a = new FirestoreRevisionStore(dbA), b = new FirestoreRevisionStore(dbB);
  const P = `proj-${randomUUID()}`;
  const base = rev(P, null, 'base', { 'a.ts': '1' }, 'baseline');
  assert.equal((await a.promote(P, null, base)).ok, true);
  const racers = Array.from({ length: 8 }, (_, i) => (i % 2 ? b : a).promote(P, base.id, rev(P, base.id, `racer-${i}`, { 'a.ts': '1', [`r${i}.ts`]: String(i) })));
  const results = await Promise.all(racers);
  assert.equal(results.filter((r) => r.ok).length, 1, 'exactly one concurrent promotion wins');
  assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === 'conflict'));
  const head = await a.head(P);
  assert.equal(head.parentId, base.id);
  assert.equal((await b.head(P)).id, head.id, 'both instances read the same head');
  // 2. the same edit id promotes once, whichever instance sends it (retry / reconnect)
  const next = rev(P, head.id, 'same-edit', { 'a.ts': '1', 'z.ts': 'z' });
  const first = await a.promote(P, head.id, next);
  const second = await b.promote(P, head.id, rev(P, head.id, 'same-edit', { 'a.ts': '1', 'z.ts': 'z' }));
  assert.ok(first.ok && second.ok && second.duplicate && second.rev.id === first.rev.id);
  assert.equal((await a.list(P, 50)).length, 3);
  // 3. a stale expected parent is refused and the head does not move
  const stale = await b.promote(P, base.id, rev(P, base.id, 'stale', { 'x.ts': 'x' }));
  assert.equal(stale.ok, false);
  assert.equal((await a.head(P)).id, first.rev.id);
  // 4. isolation
  assert.equal(await a.head(`other-${randomUUID()}`), null);
}

// 5. requirements: concurrent messages from two instances are all kept; a replay changes nothing
{
  const a = new FirestoreRequirementsStore(dbA), b = new FirestoreRequirementsStore(dbB);
  const P = `proj-${randomUUID()}`;
  await Promise.all(Array.from({ length: 16 }, (_, i) => (i % 2 ? b : a).record(P, { id: `m${i}`, text: `You must always keep rule${i} number${i}x visible.`, ts: i + 1, isBuildRequest: i === 0 })));
  const loaded = await a.load(P);
  assert.equal(loaded.status, 'ok');
  assert.equal(activeRequirements(loaded.ledger).length, 16, 'no concurrent message was lost');
  assert.equal(loaded.ledger.brief.sourceId, 'm0');
  await Promise.all(Array.from({ length: 16 }, (_, i) => b.record(P, { id: `m${i}`, text: `You must always keep rule${i} number${i}x visible.`, ts: 99, isBuildRequest: false })));
  assert.equal(activeRequirements((await b.load(P)).ledger).length, 16, 'a replay changes nothing');
  assert.equal((await a.load(`none-${randomUUID()}`)).status, 'missing');
}
console.log('project revisions + requirements: Firestore drills passed');
process.exit(0);
