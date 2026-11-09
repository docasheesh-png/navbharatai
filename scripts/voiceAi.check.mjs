#!/usr/bin/env node
/** Real Firestore transactions, no provider calls, no credentials, no production fallback.
 * Run with Node 22 + tsx against the CI loopback Firestore emulator:
 * FIRESTORE_EMULATOR_HOST=127.0.0.1:18781 node --import ./node_modules/tsx/dist/loader.mjs \
 *   scripts/voiceAi.check.mjs --emulator 127.0.0.1:18781
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const position = process.argv.indexOf('--emulator');
assert.ok(position >= 0, 'Explicit --emulator is required');
const endpoint = process.argv[position + 1];
assert.match(endpoint ?? '', /^127\.0\.0\.1:\d+$/, 'Only a loopback emulator is allowed');
const port = Number(endpoint.split(':')[1]);
assert.ok(port > 1024 && port <= 65535, 'Valid nonprivileged loopback port required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, endpoint, 'No production fallback');
process.env.NODE_ENV = 'test';
process.env.WALLET_LEDGER_V2_DUALWRITE = 'on';
process.env.WALLET_MERGE_RESOLVE = 'on';
process.env.VOICE_AI_ENABLED = '0';
// The store must never make a provider request, even during recovery.
globalThis.fetch = async () => { throw new Error('Network inference forbidden in the voice wallet drill'); };

const require = createRequire(import.meta.url);
const { Firestore } = require('firebase-admin/firestore');
const databaseId = `voice-drill-${randomUUID()}`;
const settings = { projectId: 'demo-navbharatai-phase2', databaseId, host: endpoint, ssl: false };
const db = new Firestore(settings);
const otherInstance = new Firestore(settings);
const { setServerDb } = await import('../src/server/lib/serverDb.ts');
setServerDb(db);
const { reserveVoice, finishVoice, reconcileVoiceHolds, VOICE_HOLD_MS, VOICE_OPERATIONS } = await import('../src/server/lib/voiceAiStore.ts');
const { checkLedgerV2Chain } = await import('../src/server/lib/ledgerV2.ts');
const { TOKENS_PER_RUPEE } = await import('../src/lib/walletPricing.ts');
const { deleteUserData } = await import('../src/server/lib/DataRetentionManager.ts');
const { FreeProgramStore } = await import('../src/server/lib/freeProgram.ts');
const { freeProgramPausedHint, setFreeProgramPausedHint } = await import('../src/server/lib/freeProgramHint.ts');

const now = Date.parse('2026-11-09T12:00:00Z');
const walletRef = uid => db.doc(`user_token_wallets/${uid}`);
const fund = async (uid, rupees) => walletRef(uid).set({ userId: uid, tokenBalance: rupees * TOKENS_PER_RUPEE,
  remaining_balance: rupees, totalTokensUsed: 0, giftTokensRemaining: 0, walletLedger: [] });
const wallet = async uid => (await walletRef(uid).get()).data();
const operation = async hold => (await db.doc(`${VOICE_OPERATIONS}/${hold.id}`).get()).data();
let passed = 0;
const check = label => { passed++; console.log(`PASS ${passed}: ${label}`); };

try {
  await fund('duplicate', 10);
  const requests = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
    reserveVoice('duplicate', 'same-request', 1, now, i % 2 ? db : otherInstance)));
  assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1);
  requests.filter(result => result.status === 'rejected').forEach(result => assert.equal(result.reason.code, 'duplicate'));
  const duplicateHold = requests.find(result => result.status === 'fulfilled').value;
  assert.equal((await wallet('duplicate')).remaining_balance, 9);
  assert.equal((await db.doc('voice_ai_control/minute').get()).data().count, 1);
  check('two independent Firestore clients admit one concurrent duplicate, one charge and one rate slot');

  await fund('last-credit', 1);
  const competitors = await Promise.allSettled(Array.from({ length: 4 }, (_, i) =>
    reserveVoice('last-credit', `distinct-${i}`, 0.6, now, i % 2 ? db : otherInstance)));
  assert.equal(competitors.filter(result => result.status === 'fulfilled').length, 1);
  competitors.filter(result => result.status === 'rejected').forEach(result => assert.equal(result.reason.code, 'insufficient'));
  assert.equal((await wallet('last-credit')).tokenBalance, 0.4 * TOKENS_PER_RUPEE);
  assert.equal((await wallet('last-credit')).remaining_balance, 0.4);
  check('competing unique requests cannot overspend the last wallet credit');

  await Promise.all(Array.from({ length: 4 }, (_, i) => finishVoice(duplicateHold, false, now + 1, i % 2 ? db : otherInstance)));
  assert.equal((await wallet('duplicate')).remaining_balance, 10);
  assert.equal((await operation(duplicateHold)).state, 'refunded');
  await assert.rejects(reserveVoice('duplicate', 'same-request', 1, now + 2), error => error.code === 'duplicate');
  assert.equal(await finishVoice(duplicateHold, true, now + 2), false);
  check('concurrent refund restores exactly once; replay cannot infer, charge, or settle the refunded request');

  await fund('canonical', 5);
  await walletRef('retired').set({ userId: 'retired', tokenBalance: 0, remaining_balance: 0, mergedInto: 'canonical' });
  const canonicalHold = await reserveVoice('retired', 'canonical-request', 2, now);
  assert.equal(canonicalHold.uid, 'retired'); assert.equal(canonicalHold.ownerId, 'canonical');
  assert.equal((await wallet('canonical')).remaining_balance, 3);
  assert.equal((await wallet('retired')).remaining_balance, 0);
  await assert.rejects(finishVoice({ ...canonicalHold, ownerId: 'duplicate' }, false, now + 1), error => error.code === 'storage');
  await assert.rejects(finishVoice({ ...canonicalHold, uid: 'other-user' }, false, now + 1), error => error.code === 'storage');
  await assert.rejects(finishVoice({ ...canonicalHold, feeInr: 3 }, false, now + 1), error => error.code === 'storage');
  await assert.rejects(finishVoice({ ...canonicalHold, reservedInr: 3 }, false, now + 1), error => error.code === 'storage');
  assert.equal((await wallet('canonical')).remaining_balance, 3);
  check('canonical ownership is resolved and forged owner, uid and fee cannot redirect or increase a refund');

  assert.equal(await finishVoice(canonicalHold, true, now + 1), true);
  assert.equal((await operation(canonicalHold)).state, 'completed');
  assert.equal(await finishVoice(canonicalHold, false, now + 2), false);
  assert.equal((await wallet('canonical')).remaining_balance, 3);
  assert.equal((await wallet('canonical')).walletLedger.flatMap(row => row.openHolds ?? []).length, 0);
  check('successful completion closes the hold and cannot be charged or refunded again');

  await fund('expires', 10);
  const expired = await reserveVoice('expires', 'expires-request', 2, now);
  assert.equal(await finishVoice(expired, true, expired.expiresAt), false);
  assert.equal((await operation(expired)).state, 'refunded');
  assert.equal((await wallet('expires')).remaining_balance, 10);
  check('a success arriving at hold expiry refunds instead of charging');

  const crashed = await reserveVoice('expires', 'crashed-request', 2, now);
  const live = await reserveVoice('expires', 'live-request', 1, now + 1000);
  const recovered = await reconcileVoiceHolds(now + VOICE_HOLD_MS);
  assert.equal(recovered, 2); // crashed + the last-credit winner were not delivered.
  assert.equal((await operation(crashed)).state, 'refunded');
  assert.equal((await operation(live)).state, 'pending');
  assert.equal((await wallet('expires')).remaining_balance, 9);
  assert.equal((await wallet('last-credit')).remaining_balance, 1);
  assert.equal(await reconcileVoiceHolds(now + VOICE_HOLD_MS), 0);
  check('real expiry query recovers crash holds once, keeps live holds and never retries inference');

  await fund('missing-wallet', 1);
  const broken = await reserveVoice('missing-wallet', 'broken-request', 1, now);
  await walletRef('missing-wallet').delete();
  const healthy = await reserveVoice('expires', 'healthy-request', 1, now);
  assert.equal(await reconcileVoiceHolds(now + VOICE_HOLD_MS), 1);
  assert.equal((await operation(broken)).state, 'pending');
  assert.equal((await operation(healthy)).state, 'refunded');
  check('a failed recovery does not stop another expired wallet refund');

  for (const tracked of [false, true]) {
    const uid = tracked ? 'tiny-tracked' : 'tiny-legacy';
    await fund(uid, 1);
    await walletRef(uid).update({ giftTokensRemaining: 60, ...(tracked ? { adminBuildTokensRemaining: 30 } : {}) });
    const feeInr = 0.00236;
    const first = await reserveVoice(uid, 'tiny-first', feeInr, now);
    assert.equal(first.reservedInr, 0.01); assert.equal(first.feeInr, feeInr);
    assert.equal((await wallet(uid)).tokenBalance, TOKENS_PER_RUPEE - 1);
    assert.equal(await finishVoice(first, true, now + 1), true);
    assert.equal((await wallet(uid)).tokenBalance, TOKENS_PER_RUPEE);
    assert.equal((await wallet(uid)).tokenCarry, 0.236);
    const others = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      reserveVoice(uid, `tiny-${index}`, feeInr, now, index % 2 ? db : otherInstance)));
    await Promise.all(others.map((hold, index) => finishVoice(hold, true, now + 2, index % 2 ? db : otherInstance)));
    assert.equal((await wallet(uid)).tokenBalance, TOKENS_PER_RUPEE - 1);
    assert.equal((await wallet(uid)).tokenCarry, 0.18);
    const failed = await reserveVoice(uid, 'tiny-failed', feeInr, now);
    const delivered = await reserveVoice(uid, 'other-delivered', 0.12, now);
    await Promise.all([finishVoice(failed, false, now + 3, db), finishVoice(delivered, true, now + 3, otherInstance)]);
    const result = await wallet(uid);
    assert.equal(result.tokenBalance, TOKENS_PER_RUPEE - 13);
    assert.equal(result.remaining_balance, 0.87);
    assert.equal(result.tokenCarry, 0.18);
    assert.equal(result.giftTokensRemaining, 60);
    if (tracked) { assert.equal(result.adminBuildTokensRemaining, 30); assert.equal(result.cashRequiredTokenCarry, 0.18); }
    assert.ok(Math.abs((TOKENS_PER_RUPEE - result.tokenBalance + result.tokenCarry) / TOKENS_PER_RUPEE - (feeInr * 5 + 0.12)) < 1e-9);
    check(`${tracked ? 'tracked' : 'legacy'} wallet settles exact sub-paise fees with carries, concurrent delivery and refund preserve provenance`);
  }

  const poisonBatch = db.batch();
  for (let i = 0; i < 20; i++) {
    poisonBatch.set(db.doc(`${VOICE_OPERATIONS}/poison-${i}`), { id: 'mismatched-id', uid: 'expires', ownerId: 'expires',
      feeInr: 1, rollupRef: 'missing', state: 'pending', expiresAt: now - 1 });
  }
  await poisonBatch.commit();
  const behindPoison = await reserveVoice('expires', 'after-poison-page', 1, now);
  assert.equal(await reconcileVoiceHolds(now + VOICE_HOLD_MS), 0);
  assert.equal((await operation(behindPoison)).state, 'pending');
  assert.equal(await reconcileVoiceHolds(now + VOICE_HOLD_MS), 1);
  assert.equal((await operation(behindPoison)).state, 'refunded');
  check('real startAfter cursor advances past a full poison page so valid refunds cannot starve');

  await db.doc('voice_ai_control/minute').set({ bucket: Math.floor(now / 60_000), count: 49 });
  const slots = await Promise.allSettled([
    reserveVoice('duplicate', 'last-slot-one', 0.1, now, db),
    reserveVoice('duplicate', 'last-slot-two', 0.1, now, otherInstance),
  ]);
  assert.equal(slots.filter(result => result.status === 'fulfilled').length, 1);
  slots.filter(result => result.status === 'rejected').forEach(result => assert.equal(result.reason.code, 'busy'));
  assert.equal((await db.doc('voice_ai_control/minute').get()).data().count, 50);
  await reserveVoice('duplicate', 'next-minute', 0.1, now + 60_000);
  assert.equal((await db.doc('voice_ai_control/minute').get()).data().count, 1);
  check('real contention admits one final global rate slot and next-minute reset works');

  const ledger = (await db.collection('wallet_ledger').get()).docs.map(document => document.data());
  for (const uid of ['duplicate', 'last-credit', 'canonical', 'expires', 'tiny-legacy', 'tiny-tracked']) {
    assert.deepEqual(checkLedgerV2Chain(ledger.filter(row => row.ownerId === uid), (await wallet(uid)).tokenBalance), { ok: true, problems: [] });
  }
  for (const document of (await db.collection(VOICE_OPERATIONS).get()).docs) {
    assert.deepEqual(Object.keys(document.data()).filter(key => /text|audio|prompt|secret|key/i.test(key)), []);
  }
  check('all wallet ledger chains reconcile and no operation persists prompt, audio or secrets');

  await fund('erase-pending', 1);
  const erasedHold = await reserveVoice('erase-pending', 'erase-pending-request', 0.1, now + 60_000);
  const pendingErase = await deleteUserData(db, 'erase-pending');
  assert.equal((await wallet('erase-pending')).remaining_balance, 0.9);
  assert.match(pendingErase.collections.find(row => row.collection === 'user_token_wallets').error, /pending payment reservations or refunds/);
  assert.equal((await operation(erasedHold)).state, 'pending');
  await finishVoice(erasedHold, false, now + 60_001);
  assert.equal((await wallet('erase-pending')).remaining_balance, 1);
  const settledErase = await deleteUserData(db, 'erase-pending');
  assert.equal(settledErase.collections.find(row => row.collection === 'user_token_wallets').deleted, 1);
  assert.equal((await walletRef('erase-pending').get()).exists, false);
  assert.equal((await operation(erasedHold)).state, 'refunded');
  await assert.rejects(reserveVoice('erase-pending', 'erase-pending-request', 0.1, now + 60_002), error => error.code === 'duplicate');
  check('account erasure preserves pending refund wallet, permits later settled erasure and retains the replay tombstone');

  const policyRef = db.doc('platform_settings/free_program');
  await policyRef.set({ paused: false });
  setFreeProgramPausedHint(true);
  // The real shared reader, with this invocation's emulator document and no subscription to leave open.
  const policy = new FreeProgramStore(() => ({
    read: async () => (await policyRef.get()).data(), write: async next => { await policyRef.set(next); },
  }));
  assert.equal((await policy.read()).paused, false);
  assert.equal(freeProgramPausedHint(), false);
  check('cold shared-policy reader loads real emulator LIVE state before gift admission');

  const giftNow = now + 120_000;
  for (const tracked of [false, true]) {
    const uid = tracked ? 'gift-tracked' : 'gift-legacy';
    const rupees = tracked ? 25 : 20;
    const initial = rupees * TOKENS_PER_RUPEE;
    await fund(uid, rupees);
    await walletRef(uid).update({ giftTokensRemaining: initial, totalMoneySpent: 0,
      ...(tracked ? { adminBuildTokensRemaining: 0 } : {}) });
    const tiny = 0.00236;
    const holds = await Promise.all(Array.from({ length: 5 }, (_, index) =>
      reserveVoice(uid, `gift-tiny-${index}`, tiny, giftNow, index % 2 ? db : otherInstance)));
    assert.equal((await wallet(uid)).tokenBalance, initial - 5);
    assert.equal((await wallet(uid)).giftTokensRemaining, initial - 5);
    await Promise.all(holds.map((hold, index) => finishVoice(hold, true, giftNow + 1, index % 2 ? db : otherInstance)));
    let result = await wallet(uid);
    assert.equal(result.tokenBalance, initial - 1); assert.equal(result.giftTokensRemaining, initial - 1);
    assert.equal(result.tokenCarry, 0.18);
    if (tracked) {
      assert.equal(result.ordinaryGiftTokenCarry, 0.18); assert.equal(result.cashRequiredTokenCarry, 0);
      assert.equal(result.adminBuildTokensRemaining, 0);
    }
    const refund = await reserveVoice(uid, 'gift-refund', 0.13, giftNow);
    const delivered = await reserveVoice(uid, 'gift-delivered', 0.12, giftNow);
    await Promise.all([finishVoice(refund, false, giftNow + 2, db), finishVoice(delivered, true, giftNow + 2, otherInstance)]);
    const expires = await reserveVoice(uid, 'gift-expiry', 0.01, giftNow);
    await finishVoice(expires, true, expires.expiresAt);
    result = await wallet(uid);
    assert.equal(result.tokenBalance, initial - 13); assert.equal(result.giftTokensRemaining, initial - 13);
    assert.equal(result.remaining_balance, rupees - 0.13); assert.equal(result.tokenCarry, 0.18);
    assert.ok(Math.abs((initial - result.tokenBalance + result.tokenCarry) / TOKENS_PER_RUPEE - (tiny * 5 + 0.12)) < 1e-9);
    for (const hold of [holds[0], refund, expires]) {
      assert.equal(await finishVoice(hold, false, giftNow + 3), false);
    }
    await assert.rejects(reserveVoice(uid, 'gift-tiny-0', tiny, giftNow), error => error.code === 'duplicate');
    await assert.rejects(reserveVoice(uid, 'gift-refund', 0.13, giftNow), error => error.code === 'duplicate');
    await policy.setPaused(true);
    const rateBefore = (await db.doc('voice_ai_control/minute').get()).data();
    await assert.rejects(reserveVoice(uid, 'gift-paused', tiny, giftNow), error => error.code === 'insufficient');
    assert.deepEqual(await wallet(uid), result);
    assert.deepEqual((await db.doc('voice_ai_control/minute').get()).data(), rateBefore);
    const giftLedger = (await db.collection('wallet_ledger').get()).docs.map(document => document.data()).filter(row => row.ownerId === uid);
    assert.deepEqual(checkLedgerV2Chain(giftLedger, result.tokenBalance), { ok: true, problems: [] });
    await policy.setPaused(false);
    check(`${tracked ? 'tracked' : 'legacy'} ordinary gift-only INR${rupees} wallet: exact concurrent charges, refunds, expiry, replay and PAUSED restriction`);
  }

  await fund('admin-only', 25);
  await walletRef('admin-only').update({ giftTokensRemaining: 25 * TOKENS_PER_RUPEE, adminBuildTokensRemaining: 25 * TOKENS_PER_RUPEE });
  const adminBefore = await wallet('admin-only');
  const adminRateBefore = (await db.doc('voice_ai_control/minute').get()).data();
  const opsBefore = (await db.collection(VOICE_OPERATIONS).get()).size;
  for (const paused of [false, true]) {
    await policy.setPaused(paused);
    await assert.rejects(reserveVoice('admin-only', `admin-${paused}`, 0.01, giftNow), error => error.code === 'insufficient');
    assert.deepEqual(await wallet('admin-only'), adminBefore);
    assert.deepEqual((await db.doc('voice_ai_control/minute').get()).data(), adminRateBefore);
    assert.equal((await db.collection(VOICE_OPERATIONS).get()).size, opsBefore);
  }
  await policy.setPaused(false);
  await walletRef('admin-only').update({ adminBuildTokensRemaining: 24 * TOKENS_PER_RUPEE });
  await assert.rejects(reserveVoice('admin-only', 'beyond-ordinary', 1.01, giftNow), error => error.code === 'insufficient');
  const ordinary = await reserveVoice('admin-only', 'ordinary-only', 1, giftNow);
  await finishVoice(ordinary, true, giftNow + 1);
  const protectedWallet = await wallet('admin-only');
  assert.equal(protectedWallet.tokenBalance, 24 * TOKENS_PER_RUPEE);
  assert.equal(protectedWallet.giftTokensRemaining, protectedWallet.tokenBalance);
  assert.equal(protectedWallet.adminBuildTokensRemaining, protectedWallet.tokenBalance);
  check('protected admin-only credits rejected LIVE and PAUSED; mixed wallet consumes only ordinary gift');

  await walletRef('gift-inferred').set({ userId: 'gift-inferred', tokenBalance: 20 * TOKENS_PER_RUPEE,
    remaining_balance: 20, totalMoneySpent: 0, totalTokensUsed: 0, walletLedger: [] });
  const inferred = await reserveVoice('gift-inferred', 'inferred', 0.12, giftNow);
  await finishVoice(inferred, false, giftNow + 1);
  assert.equal((await wallet('gift-inferred')).giftTokensRemaining, 20 * TOKENS_PER_RUPEE);
  await policy.setPaused(true);
  await assert.rejects(reserveVoice('gift-inferred', 'paused', 0.01, giftNow), error => error.code === 'insufficient');
  check('never-paid legacy balance without gift metadata remains gift after refund and is unavailable PAUSED');

  console.log(`PASS: ${passed} real Firestore voice accounting drills. Synthetic isolated database only; zero provider calls.`);
} finally {
  // Only this invocation's dedicated, random emulator database is touched.
  for (const collection of ['wallet_ledger', 'user_token_wallets', VOICE_OPERATIONS, 'voice_ai_control', 'platform_settings']) {
    const documents = await db.collection(collection).get();
    const batch = db.batch();
    documents.docs.forEach(document => batch.delete(document.ref));
    if (documents.size) await batch.commit();
  }
  setServerDb(null);
  setFreeProgramPausedHint(null);
  await Promise.all([db.terminate(), otherInstance.terminate()]);
}
