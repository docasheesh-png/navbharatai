import { createHash } from 'node:crypto';
import { getServerDb, doc, getDoc, runTransaction } from './serverDb';
import { computeRolledUpDebit, computeRolledUpRelease, MAX_OPEN_HOLDS } from './walletDebit';
import { resolveCanonicalWalletId, walletMergeResolveEnabled } from './walletResolve';
import { withLedgerV2 } from './ledgerV2';
import { featureRollupRef, TOKENS_PER_RUPEE } from './walletFeature';
import { VoiceAiError } from './voiceAi';
import { audit } from './audit';

export const VOICE_OPERATIONS = 'voice_ai_operations';
export const VOICE_HOLD_MS = 4 * 60_000;
export interface VoiceHold { id: string; uid: string; ownerId: string; rollupRef: string; feeInr: number; reservedInr: number; expiresAt: number }
export function voiceOperationId(uid: string, requestId: string): string {
  return createHash('sha256').update(JSON.stringify([uid, requestId])).digest('hex');
}
/** Request identity, wallet hold and account-wide rate slot are one durable transaction.
 * No prompt, audio, key, email or provider response is persisted in the ledger.
 */
export async function reserveVoice(uid: string, requestId: string, feeInr: number, now = Date.now(), db = getServerDb()): Promise<VoiceHold> {
  if (!db) throw new VoiceAiError('storage');
  const ownerId = walletMergeResolveEnabled() ? await resolveCanonicalWalletId(async id => {
    const s = await getDoc(doc(db, 'user_token_wallets', id)); return s.exists() ? s.data()?.mergedInto : null;
  }, uid) : uid;
  const id = voiceOperationId(uid, requestId);
  const hold: VoiceHold = { id, uid, ownerId, rollupRef: featureRollupRef('voice-generation', now), feeInr, reservedInr: Math.ceil((feeInr - Number.EPSILON) * 100) / 100, expiresAt: now + VOICE_HOLD_MS };
  await runTransaction(db, async tx => {
    const opRef = doc(db, VOICE_OPERATIONS, id), walletRef = doc(db, 'user_token_wallets', ownerId), rateRef = doc(db, 'voice_ai_control', 'minute');
    const [op, wallet, rate] = await Promise.all([tx.get(opRef), tx.get(walletRef), tx.get(rateRef)]);
    if (op.exists()) throw new VoiceAiError('duplicate', 409);
    const bucket = Math.floor(now / 60_000), r = rate.data();
    const count = r?.bucket === bucket ? r.count : 0;
    if (!Number.isSafeInteger(count) || count < 0 || count >= 50) throw new VoiceAiError('busy', 429);
    const before = wallet.exists() ? wallet.data()! : { userId: ownerId, tokenBalance: 0 };
    // Resolution may have raced an account merge. Never debit a retired wallet.
    if (before.mergedInto) throw new VoiceAiError('storage');
    const row = Array.isArray(before.walletLedger) ? before.walletLedger.find((r: { rollupRef?: string }) => r?.rollupRef === hold.rollupRef) : undefined;
    if (Array.isArray(row?.openHolds) && row.openHolds.length >= MAX_OPEN_HOLDS) throw new VoiceAiError('busy', 429);
    const result = computeRolledUpDebit(before, { billedInr: hold.reservedInr, feature: 'voice-generation', rollupRef: hold.rollupRef,
      holdId: id, description: 'Voice AI', floorInr: 0, allOrNothing: true }, new Date(now).toISOString());
    if (result.refused || !result.applied) throw new VoiceAiError('insufficient', 402);
    tx.set(walletRef, withLedgerV2(tx, (c, i) => doc(db, c, i), ownerId, before, result.wallet, 'wallet-debit'));
    tx.set(opRef, { ...hold, state: 'pending', createdAt: now });
    tx.set(rateRef, { bucket, count: count + 1 });
  });
  return hold;
}
/** A completed/expired operation can never be replayed or charged twice. */
export async function finishVoice(hold: VoiceHold, success: boolean, now = Date.now(), db = getServerDb()): Promise<boolean> {
  if (!db) throw new VoiceAiError('storage');
  const outcome = await runTransaction(db, async tx => {
    const opRef = doc(db, VOICE_OPERATIONS, hold.id), walletRef = doc(db, 'user_token_wallets', hold.ownerId);
    const [op, wallet] = await Promise.all([tx.get(opRef), tx.get(walletRef)]);
    const state = op.data();
    if (!op.exists() || state?.state !== 'pending') return { delivered: false, tokensDebited: 0 };
    if (state.uid !== hold.uid || state.ownerId !== hold.ownerId || state.feeInr !== hold.feeInr || state.reservedInr !== hold.reservedInr || state.rollupRef !== hold.rollupRef || state.expiresAt !== hold.expiresAt) throw new VoiceAiError('storage');
    if (!wallet.exists()) throw new VoiceAiError('storage');
    const delivered = success && now < hold.expiresAt;
    const before = wallet.data()!;
    if (before.mergedInto) throw new VoiceAiError('storage');
    // The temporary authorization is whole-token and reversible. Release it atomically,
    // then debit ONLY the exact quoted fee with the shared sub-token carry. A reservation
    // ceiling must never become a minimum charge or erase source-aware gift provenance.
    const released = computeRolledUpRelease(before, { rollupRef: hold.rollupRef, holdId: hold.id, description: 'Voice AI refund', feature: 'voice-generation' }, new Date(now).toISOString());
    if (!released.applied) throw new VoiceAiError('storage');
    const result = delivered ? computeRolledUpDebit(released.wallet, { billedInr: hold.feeInr, feature: 'voice-generation',
      rollupRef: hold.rollupRef, description: 'Voice AI', floorInr: 0, allOrNothing: true }, new Date(now).toISOString()) : released;
    if (!result.applied || ('refused' in result && result.refused)) throw new VoiceAiError('storage');
    tx.set(walletRef, withLedgerV2(tx, (c, i) => doc(db, c, i), hold.ownerId, before, result.wallet, 'wallet-debit'));
    tx.set(opRef, { ...hold, state: delivered ? 'completed' : 'refunded', createdAt: state.createdAt, finishedAt: now, expiresAt: null });
    return { delivered, tokensDebited: delivered && 'tokensDebited' in result ? result.tokensDebited : 0 };
  });
  // Feature reporting follows actual materialized wallet debits, not a rounded estimate
  // of each fractional request. The carried fraction is reported when it becomes a token.
  if (outcome.delivered && outcome.tokensDebited > 0) {
    void import('./FeatureSpendStore').then(m => m.featureSpendStore.record('voice-generation', outcome.tokensDebited / TOKENS_PER_RUPEE, hold.uid)).catch(() => {});
  }
  return outcome.delivered;
}
const recoveryCursors = new WeakMap<object, FirebaseFirestore.QueryDocumentSnapshot>();

/** Crash recovery refunds undelivered holds; never retries inference. Bounded, transaction-race safe. */
export async function reconcileVoiceHolds(now = Date.now(), db = getServerDb()): Promise<number> {
  if (!db) return 0;
  let query = db.collection(VOICE_OPERATIONS).where('expiresAt', '<=', now).where('expiresAt', '>', 0).orderBy('expiresAt');
  const cursor = recoveryCursors.get(db);
  if (cursor) query = query.startAfter(cursor);
  const pending = await query.limit(20).get();
  // Advance on raw documents, even corrupt ones, so a poison page cannot starve later refunds.
  if (pending.docs.length === 20) recoveryCursors.set(db, pending.docs[pending.docs.length - 1]);
  else recoveryCursors.delete(db);
  let recovered = 0;
  for (const item of pending.docs) {
    const h = item.data() as VoiceHold & { state: string };
    if (h.state !== 'pending' || h.id !== item.id || !h.uid || !h.ownerId || !(h.feeInr > 0) || !Number.isSafeInteger(h.expiresAt)) continue;
    try { await finishVoice(h, false, now, db); recovered++; }
    catch { audit('VOICE_AI_REFUND_RECOVERY_FAILED', { operationId: item.id }, 'error'); }
  }
  if (recovered) audit('VOICE_AI_HOLDS_RECOVERED', { count: recovered });
  return recovered;
}
