/**
 * ₹1-per-APK charge (admin 2026-08-06: "apk builder me koi apk banwaye to 1₹ per apk — jitni baar
 * apk bana utne ₹"). The rules, all inherited from the one-wallet law:
 *   • Charged at DELIVERY of the built binary (the download that streams a real .apk) — a failed or
 *     never-finished build costs nothing ("working result or free").
 *   • IDEMPOTENT per artifact: the wallet debit's buildRef is the artifact's identity, so
 *     re-downloading the same APK never charges twice — "jitni baar BANA", not "jitni baar download".
 *   • Only a VERIFIED signed-in user is charged (an anonymous caller has no wallet to debit);
 *     free-list (admin/tester) accounts are exempt, like everywhere else.
 *   • The charge NEVER blocks or delays the bytes — it debits beside the stream (overdraft is the
 *     wallet's normal design; the affordability gates elsewhere stop new spending when negative).
 *   • Scope: .apk ONLY (the admin priced exactly that). .aab/.ipa remain unmetered until priced.
 * Env: APK_CHARGE_INR (default 1; 0/off = free, no deploy needed to change the price).
 */

export function apkChargeInr(): number {
  const raw = (process.env.APK_CHARGE_INR ?? '').trim();
  if (/^(off|false)$/i.test(raw)) return 0;
  const v = Number(raw);
  if (raw === '') return 1;
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** Is this delivered binary a chargeable APK? Pure. */
export function isChargeableApk(fileName: string | null | undefined): boolean {
  return apkChargeInr() > 0 && /\.apk$/i.test(fileName ?? '');
}

/** The idempotency key for one built artifact — one ₹ charge per BUILD, however often downloaded. */
export function apkChargeRef(owner: string, repo: string, artifactId: string): string {
  return `apk_${owner}/${repo}#${artifactId}`;
}
