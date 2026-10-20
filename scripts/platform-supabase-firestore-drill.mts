// Local emulator only; never runs against a live Firestore database.
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { acquirePlatformAdmission } from '../src/server/lib/platformSupabaseAdmission.ts';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('A loopback emulator is required.');
const app = initializeApp({ projectId: 'demo-navbharatai-phase2' }, 'supabase-default-drill');
const db = getFirestore(app);
const input = { orgId: `fixture-${Date.now()}`, workspaceId: 'fixture-owner-app' };
const results = await Promise.all(Array.from({ length: 8 }, () => acquirePlatformAdmission(db, input)));
assert.equal(results.filter(Boolean).length, 1);
const winner = results.find(Boolean)!;
await winner.noteProject('fixture-provider-ref');
const ref = db.collection('platform_settings').doc(`supabase_creation_${input.orgId}`);
assert.equal((await ref.get()).data()?.projectRef, 'fixture-provider-ref');
await winner.release();
assert.equal((await ref.get()).exists, false);
let lost = true;
const wrapped = {
  collection: (name: string) => db.collection(name),
  runTransaction: async (fn: any) => { const out = await db.runTransaction(fn); if (lost) { lost = false; throw Error('Lost ack after real commit.'); } return out; },
};
assert.equal(await acquirePlatformAdmission(wrapped as any, input), null);
assert.equal(await acquirePlatformAdmission(db, input), null);
await ref.delete(); // Emulator fixture only, after proving the retained hold.
await db.terminate(); await deleteApp(app);
console.log('PASS: real Firestore concurrent admission, project reference, release, lost commit acknowledgement and blocked replay.');
