import type { ProviderModelEntry } from './ProviderUsageLedger';
import { isSurplusReceiptDecision } from '../AI/SurplusRegistry/receiptPolicy';
import { SurplusAccountingUnavailableError } from './providerRates';
/** Exact decimal accumulation; the existing wallet accepts numbers at its final currency boundary. */
export function sumSurplusDecimalUsd(values: readonly string[]): string {
  let total = 0n, scale = 0;
  for (const value of values) {
    if (!/^\d+(?:\.\d{1,24})?$/.test(value)) throw new SurplusAccountingUnavailableError();
    const [whole, fraction = ''] = value.split('.'), nextScale = Math.max(scale, fraction.length);
    total = total * 10n ** BigInt(nextScale - scale) + BigInt(whole + fraction) * 10n ** BigInt(nextScale - fraction.length);
    scale = nextScale;
  }
  const raw = total.toString().padStart(scale + 1, '0');
  return scale ? `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/\.?0+$/, '') || '0' : raw;
}
/** Separate from ALL legacy margins and VM charges. Invalid/missing cap halts billing. */
/**
 * 💰 ONE UNSETTLED RECEIPT NO LONGER ZEROES THE WHOLE BUILD (failedbr #2487, admin 2026-11-22: "yahi to hamara revenue hai,
 * yaha ₹0 charge galat hai"). A single Surplus call without a valid receipt used to THROW here, and the caller then absorbed
 * EVERY Surplus call of the build at ₹0 — 36 calls and 2.76 M tokens billed nothing. Now each call stands on its own: a call
 * with a valid receipt is charged by it; a call without one is set aside in `unsettled` (with its tokens), for the caller to
 * estimate under the owner's rule (surplusStopTokenFloor.ts) or absorb. Same identity seen twice with different evidence is
 * a conflict: the repeat is unsettled, the first stays. PURE.
 */
const DECIMAL_USD = /^\d+(?:\.\d{1,24})?$/;
export function surplusBuildCharges(entries: readonly ProviderModelEntry[], barrenPhases: ReadonlySet<string>) {
  const seen = new Map<string, string>();
  const charges: string[] = [], expenses: string[] = [], absorbed: string[] = [];
  const unsettled: ProviderModelEntry[] = [];
  for (const entry of entries) {
    if (entry.provider.toUpperCase() !== 'SURPLUS') continue;
    const r = entry.surplusReceipt;
    if (!isSurplusReceiptDecision(r) || entry.surplusAccountingConflict || !r.accountingIdentity || !r.evidenceFingerprint
        || r.modelId !== entry.model || r.actualCostUsd === null || !['chargeable', 'absorbed'].includes(r.status)
        || !DECIMAL_USD.test(String(r.actualCostUsd)) || !DECIMAL_USD.test(String(r.userChargeUsd))) { unsettled.push(entry); continue; }
    const excluded = entry.surplusAbsorbed || !!entry.unbilled || !!(entry.phase && barrenPhases.has(entry.phase));
    const signature = JSON.stringify([r.evidenceFingerprint, r.status, r.userChargeUsd, !!excluded]);
    const previous = seen.get(r.accountingIdentity);
    if (previous) { if (previous !== signature) unsettled.push(entry); continue; }
    seen.set(r.accountingIdentity, signature);
    charges.push(excluded ? '0' : r.userChargeUsd);
    expenses.push(r.actualCostUsd);
    absorbed.push(excluded || r.status === 'absorbed' ? r.actualCostUsd : '0');
  }
  const chargeUsd = sumSurplusDecimalUsd(charges), actualUsd = sumSurplusDecimalUsd(expenses), absorbedUsd = sumSurplusDecimalUsd(absorbed);
  return { chargeUsd, actualUsd, absorbedUsd, unsettled };
}
