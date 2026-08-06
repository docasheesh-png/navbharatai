/**
 * ₹1-per-built-file charge (admin 2026-08-06: "1₹ per apk — jitni baar apk bana utne ₹", extended
 * the same day: "sabhi kuch 1₹ par file — yahi to paise kamane ka rasta hai"). Every mobile binary
 * the builder delivers — .apk (direct install), .aab (Play Store), .ipa (App Store) — costs ₹1.
 * The rules, all inherited from the one-wallet law:
 *   • Charged at DELIVERY of the built binary (the download that streams the real file) — a failed
 *     or never-finished build costs nothing ("working result or free").
 *   • IDEMPOTENT per artifact: the wallet debit's buildRef is the artifact's identity, so
 *     re-downloading the same file never charges twice — "jitni baar BANA", not "jitni baar download".
 *   • Only a VERIFIED signed-in user is charged (an anonymous caller has no wallet to debit);
 *     free-list (admin/tester) accounts are exempt, like everywhere else.
 *   • The charge NEVER blocks or delays the bytes — it debits beside the stream (overdraft is the
 *     wallet's normal design; the affordability gates elsewhere stop new spending when negative).
 * Env: APK_CHARGE_INR (default 1; 0/off = free, no deploy needed to change the price) — the name
 * predates the .aab/.ipa extension; it prices EVERY built mobile file.
 */

export function apkChargeInr(): number {
  const raw = (process.env.APK_CHARGE_INR ?? '').trim();
  if (/^(off|false)$/i.test(raw)) return 0;
  const v = Number(raw);
  if (raw === '') return 1;
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** Is this delivered binary a chargeable built mobile file (.apk / .aab / .ipa)? Pure. */
export function isChargeableApk(fileName: string | null | undefined): boolean {
  return apkChargeInr() > 0 && /\.(apk|aab|ipa)$/i.test(fileName ?? '');
}

/** The user-facing ledger label — names the file kind, never a vendor. Pure. */
export function chargeDescription(fileName: string | null | undefined): string {
  const ext = /\.(apk|aab|ipa)$/i.exec(fileName ?? '')?.[1]?.toLowerCase();
  return ext ? `App build (.${ext})` : 'App build';
}

/** The idempotency key for one built artifact — one ₹ charge per BUILD, however often downloaded. */
export function apkChargeRef(owner: string, repo: string, artifactId: string): string {
  return `apk_${owner}/${repo}#${artifactId}`;
}
