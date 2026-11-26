// ONE charge for a built mobile file, shared by both Android build providers (2026-11-25).
//
// Moved out of GET /api/mobile-ship/artifacts so the Native Cloud Build cannot charge differently from
// the GitHub build — a user must never be able to change what a build costs by picking the other
// provider. The policy is unchanged (admin 2026-08-06 / 2026-08-17, see apkCharge.ts):
//   • ₹ APK_CHARGE_INR per built file (default ₹1), charged when the build SUCCEEDED — a failed or
//     cancelled build costs nothing ("working result or free").
//   • Idempotent per build: `buildRef` is the wallet operation id, so a retried poll never charges twice.
//   • The welcome gift cannot pay it (`spends: 'paid-only'`).
//   • Free-list accounts and the z-test account are exempt, as everywhere else.

import { apkChargeInr, chargeDescription, isChargeableApk } from './apkCharge';
import { debitWalletForBuild, type WalletDebitResult } from './walletDebit';
import { getServerDb } from './serverDb';
import { isAgentV3FreeUser, identityGrantEmail } from '../AgentV3/featureFlag';
import { zTestFreeBilling } from './zTestAccount';

export interface ChargeIdentity { uid: string; email?: string | null; emailVerified?: boolean }

/** Is this account exempt from the build charge? Decided from the VERIFIED identity only. */
export function mobileBuildBillingExempt(identity: ChargeIdentity): boolean {
  const email = identityGrantEmail(identity);
  if (isAgentV3FreeUser(identity.uid, email)) return true;
  // 🧪 z@gmail.com test account (lib/zTestAccount.ts): app publish/APK free. Remove later.
  return zTestFreeBilling(email, identity.uid);
}

/**
 * Debit the build charge for one delivered file. Returns null when nothing is chargeable (not a
 * mobile binary, or the price is ₹0). Never throws — the caller decides what a refused charge means.
 */
export async function chargeMobileBuild(uid: string, buildRef: string, fileName: string): Promise<WalletDebitResult | null> {
  if (!isChargeableApk(fileName)) return null;
  try {
    return await debitWalletForBuild(getServerDb() as any, uid, {
      feature: 'mobile-build',
      billedInr: apkChargeInr(),
      buildRef,
      description: chargeDescription(fileName),
      spends: 'paid-only',
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'charge failed' } as WalletDebitResult;
  }
}
