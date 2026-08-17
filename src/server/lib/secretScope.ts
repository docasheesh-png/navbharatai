// WHICH OF A USER'S KEYS DOES *THIS* APP ACTUALLY GET? (admin 2026-08-17)
//
// THE PROBLEM THIS FIXES, found while answering the admin's question about an app-picker in Settings.
// The vault has never had an app dimension: `loadUserVaultSecrets` queries by `user_id` alone, and the
// build injects the whole result into the app's `.env` (routes/agentv3.ts). So a user who has ever
// saved a Razorpay secret has that secret written into the `.env` of EVERY app they build afterwards —
// a to-do list, a landing page, anything. If one of those apps is published or exported, the key goes
// with it. Nothing was broken and nothing errored; the app simply received far more than it needed.
//
// The fix is least privilege: an app gets the keys it was given, plus the ones the user deliberately
// marked as shared. That is also exactly the app-picker the admin asked for, seen from the server side.
//
// ── THE THREE RULES ─────────────────────────────────────────────────────────────────────────────────
//
//   * a key with NO workspace is a SHARED key and goes to every app;
//   * a key WITH a workspace goes only to that app;
//   * a caller that does not name an app gets EVERYTHING.
//
// The first rule is a real product choice, not a migration artefact: a user with one Stripe account
// behind three apps wants that key shared, and "All apps" is offered explicitly on the Settings screen.
//
// The third is a SAFETY DEFAULT, and it is deliberately the conservative direction. Narrowing has to be
// asked for, so a reader that has not been taught scoping keeps working instead of silently losing
// credentials. Every reader that legitimately knows its app now passes one — the build, the
// database-readiness check, the backend deploy, and the import advisory — because for those, answering
// from the user's whole vault is not merely over-broad, it is WRONG: a database connected for a
// different app would be reported as ready here and then be absent at build time.
//
// ── PRECEDENCE ──────────────────────────────────────────────────────────────────────────────────────
// An app-specific key OVERRIDES a shared key of the same name. Somebody who keeps a shared
// `STRIPE_SECRET_KEY` for most of their apps and a different one for a particular app is expressing an
// exception, and an exception that loses to the general case is not an exception. It also makes the
// shared key a safe default rather than a trap, because the specific one always wins.
//
// PURE — no I/O, so the decision is tested directly rather than through Firestore.

/** One row as the vault stores it. `workspaceId` absent/null/empty ⇒ shared with every app. */
export interface VaultSecretRow {
  name: string;
  value: string;
  workspaceId?: string | null;
}

/** True when this row is shared across all of the user's apps rather than tied to one. PURE. */
export function isSharedSecret(row: Pick<VaultSecretRow, 'workspaceId'>): boolean {
  return !String(row?.workspaceId ?? '').trim();
}

/**
 * The keys one app should receive.
 *
 * Shared keys first, then app-specific ones overwrite by name (see PRECEDENCE above).
 *
 * `workspaceId` null/empty ⇒ the caller did not name an app, so it gets everything. That is the
 * conservative direction on purpose: a reader that has not been taught scoping keeps working rather
 * than silently losing credentials. PURE.
 */
export function resolveScopedSecrets(
  rows: readonly VaultSecretRow[] | null | undefined,
  workspaceId?: string | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  const wanted = String(workspaceId ?? '').trim();
  const list = Array.isArray(rows) ? rows : [];

  if (!wanted) {
    // Unscoped caller: every key, last-write-wins, exactly as loadUserVaultSecrets always behaved.
    for (const r of list) if (r?.name) out[r.name] = r.value;
    return out;
  }

  // Shared first, so the app-specific pass can overwrite by name.
  for (const r of list) if (r?.name && isSharedSecret(r)) out[r.name] = r.value;
  for (const r of list) if (r?.name && String(r.workspaceId ?? '').trim() === wanted) out[r.name] = r.value;
  return out;
}

/**
 * The keys this app will NOT receive — for an honest, admin-facing explanation of a narrowed build.
 *
 * Worth computing because the failure mode of least privilege is a user wondering why the key they
 * definitely saved is not there. Naming what was withheld, and why, turns that into a sentence instead
 * of a mystery. Names only — never values. PURE.
 */
export function withheldSecretNames(
  rows: readonly VaultSecretRow[] | null | undefined,
  workspaceId?: string | null,
): string[] {
  const wanted = String(workspaceId ?? '').trim();
  if (!wanted) return [];
  const granted = new Set(Object.keys(resolveScopedSecrets(rows, wanted)));
  const out = new Set<string>();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.name && !granted.has(r.name)) out.add(r.name);
  }
  return Array.from(out).sort();
}
