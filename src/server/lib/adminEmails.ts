/**
 * WHO IS AN ADMIN — one list, one place.
 *
 * The set of admin addresses used to live inside `routes/agentv3.ts` (isReportAdmin), which is a
 * 15,000-line request route. Anything outside that route that needed to know "is this the admin?"
 * would have had to import the whole route or copy the list — and a copied allowlist is the kind of
 * duplicate that drifts silently until one surface trusts somebody the other does not.
 *
 * FAILS CLOSED. An empty, unknown or unreadable address is NOT an admin, so a lookup failure denies
 * rather than grants.
 */

/** Env override (comma-separated), else the known admins. */
export function adminEmailList(): string[] {
  const raw = process.env.AGENTV3_REPORT_ADMINS;
  return (raw && raw.trim() ? raw : 'aashishcpmt09@gmail.com,doc.asheesh@icloud.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Is this VERIFIED address an admin? Never call it with a spoofable value (a query param, a header). */
export function isAdminEmail(email: string | null | undefined): boolean {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return false;
  return adminEmailList().includes(e);
}
