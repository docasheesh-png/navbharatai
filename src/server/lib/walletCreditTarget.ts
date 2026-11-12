// WHICH WALLET A CREDIT LANDS ON (DB-2, go-live audit 2026-10-13).
//
// Every debit, hold, hosting charge and reversal already follows `mergedInto` to the CANONICAL wallet
// (walletDebit.walletOwnerId, hostingPlan.canonicalId, paymentReversalStore). Credits did not: a
// Cashfree top-up, a store purchase, a coupon, a gift code, an admin promo or a referral reward wrote
// to the RAW uid's wallet. With WALLET_MERGE_RESOLVE=on, money paid by a merged user landed on the
// retired wallet that nothing reads or spends. Every credit path now resolves through this one helper.
//
// No-op unless WALLET_MERGE_RESOLVE=on (the same switch the debit side reads). If canonical ownership
// cannot be verified, fail the credit so the payment/webhook can retry instead of crediting a retired wallet.

import { doc, getDoc } from './serverDb';
import { resolveCanonicalWalletIdStrict, walletMergeResolveEnabled } from './walletResolve';

export async function creditWalletId(
  db: any,
  uid: string,
  env: NodeJS.ProcessEnv = process.env,
  read: (db: any, uid: string) => Promise<string | null | undefined> = readMergedInto,
): Promise<string> {
  if (!uid || !walletMergeResolveEnabled(env)) return uid;
  return resolveCanonicalWalletIdStrict((u) => read(db, u), uid);
}

async function readMergedInto(db: any, u: string): Promise<string | null> {
  const s = await getDoc(doc(db, 'user_token_wallets', u));
  return s.exists() ? ((s.data() as any)?.mergedInto ?? null) : null;
}
