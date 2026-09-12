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
// ── DUPLICATES, AND WHY "LAST WRITE WINS" WAS A COIN FLIP (2026-09-12) ───────────────────────────────
// This file used to claim, and secrets.ts used to repeat, that "last write still wins among equally-
// scoped duplicates". That was FALSE, and the way it was false is the dangerous kind: saving a key
// under a name you already had did not replace the old row, it ADDED a second one — and the read path
// walks `getDocs` output, which comes back ordered by DOCUMENT ID. Firestore auto-ids are random, not
// chronological. So after rotating a leaked key the user's build had a coin flip's chance of injecting
// the OLD one, with nothing failing and nothing to see.
//
// The fix is in two halves, because the bug has two halves:
//   * UPSTREAM — `planSecretWrite` makes a save REPLACE the row it is replacing, so the duplicate is
//     never created (and any it finds already there are retired in the same write).
//   * DOWNSTREAM — for the duplicates already sitting in the database, `resolveScopedSecrets` now picks
//     the NEWEST row by its recorded timestamp instead of whichever Firestore happened to hand over
//     first. Deterministic, and it makes the old claim true at last.
//
// PURE — no I/O, so the decision is tested directly rather than through Firestore.

/** One row as the vault stores it. `workspaceId` absent/null/empty ⇒ shared with every app. */
export interface VaultSecretRow {
  name: string;
  value: string;
  workspaceId?: string | null;
  /**
   * When the row was written, in ms. Absent on rows stored before this was read back — and that
   * absence is MEANINGFUL, not missing data: an undated row can only be an older write, so a dated
   * row always beats it. See `isNewerRow`.
   */
  createdAt?: number | null;
}

/**
 * A stored document, reduced to what deciding about duplicates needs. Deliberately not the whole
 * Firestore document — this is a decision about identity and age, and a value has no place in it.
 */
export interface StoredSecretDoc {
  id: string;
  workspaceId?: string | null;
  createdAt?: number | null;
  deleted?: boolean;
}

/**
 * Is `candidate` the newer of two rows with the same name and scope?
 *
 * The rule, and each clause exists because the alternative is a silent wrong answer:
 *   * both dated  → the later timestamp wins;
 *   * only one dated → the DATED one wins, because an undated row predates the day we started
 *     recording the date, so it cannot be the newer write;
 *   * neither dated → `false`, i.e. keep the incumbent. Two undated rows carry no information at all,
 *     so the honest thing is to be stable rather than to invent a winner that changes between reads.
 * PURE.
 */
export function isNewerRow(candidate: { createdAt?: number | null }, incumbent: { createdAt?: number | null }): boolean {
  const a = typeof candidate?.createdAt === 'number' && Number.isFinite(candidate.createdAt) ? candidate.createdAt : null;
  const b = typeof incumbent?.createdAt === 'number' && Number.isFinite(incumbent.createdAt) ? incumbent.createdAt : null;
  if (a === null) return false;
  if (b === null) return true;
  return a > b;
}

/**
 * What a save of `name` at `scope` should do to the rows already stored under that name.
 *
 * `replace` is the document to write the new value into — the newest live row of the SAME scope, so a
 * save updates in place instead of growing the pile. `retire` is every other live row of that scope,
 * which the caller soft-deletes in the same operation: a save is the one moment we know for certain
 * which value the user means, so it is the right moment to collapse a duplicate that already exists.
 *
 * 🔒 ROWS OF A DIFFERENT SCOPE ARE NEVER TOUCHED. Saving a shared `DATABASE_URL` must not delete the
 * one a user deliberately tied to a single app — that is their exception, and an exception a general
 * save can destroy is not an exception. This is exactly the bug the earlier scope-blind dedupe in
 * `saveUserSecrets` had.
 *
 * `replace: null` means there is nothing to update and the caller adds a new document. PURE.
 */
export function planSecretWrite(
  existing: readonly StoredSecretDoc[] | null | undefined,
  scope: string | null,
): { replace: string | null; retire: string[] } {
  const wanted = String(scope ?? '').trim();
  const live = (Array.isArray(existing) ? existing : []).filter(
    (d) => d?.id && !d.deleted && String(d.workspaceId ?? '').trim() === wanted,
  );
  if (live.length === 0) return { replace: null, retire: [] };
  let winner = live[0];
  for (const d of live.slice(1)) if (isNewerRow(d, winner)) winner = d;
  return { replace: winner.id, retire: live.filter((d) => d.id !== winner.id).map((d) => d.id) };
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

  // Within ONE pass, the newest row of a name wins (see the duplicates note at the top of this file).
  // Between passes, scope still beats age: an app-specific key overrides a shared one however old it is.
  const apply = (rows: readonly VaultSecretRow[]) => {
    const best = new Map<string, VaultSecretRow>();
    for (const r of rows) {
      if (!r?.name) continue;
      const held = best.get(r.name);
      if (!held || isNewerRow(r, held)) best.set(r.name, r);
    }
    for (const [name, r] of best) out[name] = r.value;
  };

  if (!wanted) {
    // Unscoped caller: every key the user has, newest of each name.
    apply(list);
    return out;
  }

  // Shared first, so the app-specific pass can overwrite by name.
  apply(list.filter((r) => isSharedSecret(r)));
  apply(list.filter((r) => String(r?.workspaceId ?? '').trim() === wanted));
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
