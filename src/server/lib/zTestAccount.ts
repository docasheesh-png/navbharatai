/**
 * 🧪 TEMPORARY OWNER TEST ACCOUNT (owner 2026-10-29 / 2026-10-31).
 *
 * ONE place for the owner's debug profile `z@gmail.com`. Used by:
 *   • Surplus no-fallback + raw errors   (AI/SurplusRegistry/surplusNoFallback.ts)
 *   • FREE publish + hosting + domains   (hostingPlan.ts, hostingAddonLedger.ts,
 *                                         hostingBillingSweep.ts, mobileShip.ts)
 *
 * TO REMOVE LATER: make `isZTestAccount` return false (or empty both sets) — every special case
 * above turns off at once — then grep `isZTestAccount` and delete the call sites.
 * Nobody else is affected: matching is exact email / exact verified uid.
 */
export const Z_TEST_EMAILS: ReadonlySet<string> = new Set(['z@gmail.com']);
/** Same profile by verified uid — billing paths only know the uid, not the email. */
export const Z_TEST_UIDS: ReadonlySet<string> = new Set(['GiYNmFcDMVYSWW48Nrurm7j41gv1']);

export function isZTestAccount(email?: string | null, uid?: string | null): boolean {
  if (typeof uid === 'string' && Z_TEST_UIDS.has(uid)) return true;
  return typeof email === 'string' && Z_TEST_EMAILS.has(email.trim().toLowerCase());
}
