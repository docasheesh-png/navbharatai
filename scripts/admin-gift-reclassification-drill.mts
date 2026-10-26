/** Opt-in synthetic transaction drill. Refuses every non-localhost emulator endpoint. */
import assert from 'node:assert/strict';
import { Firestore } from '@google-cloud/firestore';
import { previewAdminGiftReclassification, confirmAdminGiftReclassification } from '../src/server/lib/adminGiftReclassification.ts';
import { mergeWallets } from '../src/server/lib/accountMerge.ts';
import { computeDebitedWallet } from '../src/server/lib/walletDebit.ts';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint.ts';

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18783', 'Only the isolated localhost test emulator is allowed');
process.env.WALLET_MERGE_RESOLVE = 'on';
setFreeProgramPausedHint(true);
const db = new Firestore({ projectId: 'demo-admin-gift-reclassification', host: '127.0.0.1:18783', ssl: false });
const now = '2026-10-26T00:00:00.000Z';
const seed = () => ({ tokenBalance: 1200, remaining_balance: 12, giftTokensRemaining: 1000, totalMoneySpent: 2,
  totalTokensPurchased: 200, tokenCarry: 0.75, walletLedger: [], updatedAt: now });
const prefix = `synthetic-${Date.now()}`;
const ref = (id: string) => db.collection('user_token_wallets').doc(id);
const input = async (id: string, suffix: string) => ({ userId: id, amount: 500,
  fingerprint: (await previewAdminGiftReclassification(db, id, 500)).fingerprint,
  requestId: `${prefix}-${suffix}`, reason: 'Explicit synthetic existing gift decision' });
const owner = `${prefix}-owner`;
await ref(owner).set(seed());
const duplicate = await input(owner, 'duplicates');
const responses = await Promise.all(Array.from({ length: 8 }, () => confirmAdminGiftReclassification(db, duplicate, now)));
assert.equal(responses.filter(r => !r.replayed).length, 1);
const after = (await ref(owner).get()).data()!;
assert.equal(after.tokenBalance, 1200); assert.equal(after.giftTokensRemaining, 1000);
assert.equal(after.adminBuildTokensRemaining, 500); assert.equal(after.tokenCarry, 0.75);
assert.equal(after.walletLedger[0].amountCoinsOrTokens, 0);

for (let i = 0; i < 6; i++) {
  const id = `${prefix}-usage-${i}`; await ref(id).set(seed()); const request = await input(id, `usage-${i}`);
  const use = () => db.runTransaction(async tx => {
    const snap = await tx.get(ref(id));
    tx.set(ref(id), computeDebitedWallet(snap.data()!, { feature: 'hosting-plan', spends: 'paid-only', billedInr: 0.01,
      buildRef: `synthetic-usage-${i}`, description: 'Synthetic paid-only usage', floorInr: 0 }, now).wallet);
  });
  const results = await Promise.allSettled(i % 2 ? [use(), confirmAdminGiftReclassification(db, request, now)] : [confirmAdminGiftReclassification(db, request, now), use()]);
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /changed since the preview/);
  const w = (await ref(id).get()).data()!;
  assert.equal(w.tokenBalance, 1199); assert.equal(w.giftTokensRemaining, 1000);
  assert.ok([0, 500].includes(w.adminBuildTokensRemaining ?? 0));
  // Existing legacy scalar is never reassigned to admin eligibility by activation.
  assert.equal(w.tokenCarry, 0.75);
}
for (let i = 0; i < 6; i++) {
  const source = `${prefix}-source-${i}`; const target = `${prefix}-target-${i}`;
  await Promise.all([ref(source).set(seed()), ref(target).set({ tokenBalance: 0, remaining_balance: 0,
    giftTokensRemaining: 0, adminBuildTokensRemaining: 0, walletLedger: [] })]);
  const request = await input(source, `merge-${i}`);
  const merge = () => db.runTransaction(async tx => {
    const [a, b] = await Promise.all([tx.get(ref(target)), tx.get(ref(source))]);
    if (b.data()?.mergedInto) return;
    tx.set(ref(target), mergeWallets(a.data()!, b.data()!, now).wallet);
    tx.set(ref(source), { ...b.data(), tokenBalance: 0, remaining_balance: 0, giftTokensRemaining: 0,
      adminBuildTokensRemaining: 0, tokenCarry: 0, mergedInto: target });
  });
  const results = await Promise.allSettled(i % 2 ? [merge(), confirmAdminGiftReclassification(db, request, now)] : [confirmAdminGiftReclassification(db, request, now), merge()]);
  for (const r of results) if (r.status === 'rejected') assert.match(String(r.reason), /changed since the preview/);
  const w = (await ref(target).get()).data()!;
  assert.equal(w.tokenBalance, 1200); assert.equal(w.giftTokensRemaining, 1000); assert.equal(w.tokenCarry, 0.75);
  assert.equal((await ref(source).get()).data()!.tokenBalance, 0);
  assert.ok([0, 500].includes(w.adminBuildTokensRemaining ?? 0));
  if (w.adminBuildTokensRemaining === 500) {
    assert.equal((await confirmAdminGiftReclassification(db, request, now)).replayed, true);
    assert.equal((await ref(target).get()).data()!.tokenBalance, 1200);
  }
}
await db.terminate();
console.log(JSON.stringify({ localEmulatorOnly: true, duplicateConfirmations: 8, committedOnce: true,
  usageRaces: 6, canonicalMergeRaces: 6, balanceAndCarryConserved: true, result: 'PASS' }));
