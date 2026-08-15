/**
 * WHO IS THIS BUILD'S USER? — turning a Firebase UID into a name an admin can act on.
 *
 * ADMIN REPORT 2026-08-13: the admin panel's "All builds" list showed rows like
 * `user RyN1xjbfr6gmySF5E28apuC9ZJR2`, which the admin reasonably read as "kuch encrypted sa". It is
 * not encrypted — it is the Firebase UID, the user's permanent id — but that distinction is useless
 * to somebody trying to work out WHICH user keeps hitting a build failure. An id you cannot act on is
 * the same as no information.
 *
 * WHERE THE NAMES COME FROM. The `user_token_wallets` collection, which is exactly what the panel's
 * USERS tab already reads (`userEmail` / `userName`). Deliberately NOT the Firebase Auth admin API:
 * a second source would drift from the Users tab, so the same admin would see two different names for
 * one person depending on which screen they opened.
 *
 * 🔒 A MISSING NAME IS NEVER INVENTED. Three cases are genuinely different and stay different:
 *   • a signed-out build      → "Signed-out user", because there is no person to look up;
 *   • a user with no wallet   → the short UID, honestly labelled, not a guessed name;
 *   • a real user             → their name and email.
 * Filling the gaps with "NavBharat User" would make an admin believe they knew who it was.
 *
 * ⚠️ ADMIN-ONLY DATA. Emails are personal data; every caller here sits behind `verifyAdminToken`.
 * This must not be reused on a user-facing surface, and nothing here should be handed to a model.
 */

/** What the panel needs to show one person. */
export interface UserIdentity {
  uid: string;
  /** '' when unknown — never a placeholder address. */
  email: string;
  /** '' when unknown — never a guessed name. */
  name: string;
  /** What to print when there is no name/email: a short, recognisable id. */
  shortUid: string;
  /** True when the build was made without signing in. */
  anonymous: boolean;
}

/** Builds made without signing in carry this in place of a uid. */
export function isAnonUid(uid: string | null | undefined): boolean {
  const u = String(uid ?? '').trim().toLowerCase();
  return u === '' || u === 'anon' || u === 'anonymous';
}

/**
 * A UID short enough to read but long enough to stay unique in practice.
 *
 * Kept as a PREFIX rather than a hash: an admin comparing this against a full id elsewhere in the
 * panel (or in a log line) needs the two to match by eye.
 */
export function shortUid(uid: string | null | undefined): string {
  const u = String(uid ?? '').trim();
  return u.length <= 10 ? u : `${u.slice(0, 8)}…`;
}

/** The wallet fields this module reads. Everything else in that document is irrelevant here. */
export interface WalletIdentityRecord {
  userEmail?: unknown;
  userName?: unknown;
}

/** Build the identity for one uid from its (possibly absent) wallet record. Pure. */
export function identityFrom(uid: string | null | undefined, record: WalletIdentityRecord | null | undefined): UserIdentity {
  const id = String(uid ?? '').trim();
  if (isAnonUid(id)) {
    return { uid: id, email: '', name: '', shortUid: '', anonymous: true };
  }
  const email = typeof record?.userEmail === 'string' ? record.userEmail.trim() : '';
  const name = typeof record?.userName === 'string' ? record.userName.trim() : '';
  return { uid: id, email, name, shortUid: shortUid(id), anonymous: false };
}

/**
 * The single line the admin panel prints for a user.
 *
 * Ordered by what an admin can actually DO with it: an email is the thing they can search, mail, or
 * match against a payment, so it wins over a display name. The short id is the last resort and is
 * labelled as an id, so it never reads like a corrupted name.
 */
export function identityLabel(identity: UserIdentity): string {
  if (identity.anonymous) return 'Signed-out user';
  if (identity.email && identity.name) return `${identity.name} · ${identity.email}`;
  if (identity.email) return identity.email;
  if (identity.name) return `${identity.name} · id ${identity.shortUid}`;
  return `id ${identity.shortUid}`;
}

/** Does this identity match a free-text admin search? Matches the parts an admin would type. */
export function identityMatches(identity: UserIdentity, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    identity.email.toLowerCase().includes(q) ||
    identity.name.toLowerCase().includes(q) ||
    identity.uid.toLowerCase().includes(q) ||
    (identity.anonymous && 'signed-out anonymous anon'.includes(q))
  );
}

/** The Firestore surface this module needs — injected, so the logic is testable without a database. */
export interface IdentityDb {
  getAll: (...refs: unknown[]) => Promise<Array<{ id: string; exists: boolean; data: () => WalletIdentityRecord | undefined }>>;
  collection: (name: string) => { doc: (id: string) => unknown };
}

const WALLETS = 'user_token_wallets';

/**
 * Resolve many UIDs in ONE round trip.
 *
 * `getAll` rather than a query loop: a page of 100 builds would otherwise be 100 sequential reads,
 * which is both slow and a real Firestore cost on a screen the admin refreshes often. Anonymous and
 * duplicate uids are dropped before the call, so the read is only ever for distinct real people.
 *
 * Never throws — a lookup failure degrades to ids, which is exactly what the panel showed before this
 * existed. A broken name lookup must not take down the build list itself.
 */
export async function resolveUserIdentities(
  uids: Array<string | null | undefined>,
  db: IdentityDb | null,
): Promise<Map<string, UserIdentity>> {
  const out = new Map<string, UserIdentity>();
  const wanted = [...new Set(uids.map((u) => String(u ?? '').trim()).filter((u) => !isAnonUid(u)))];
  for (const uid of wanted) out.set(uid, identityFrom(uid, null));
  if (!db || wanted.length === 0) return out;

  try {
    const refs = wanted.map((uid) => db.collection(WALLETS).doc(uid));
    const docs = await db.getAll(...refs);
    for (const doc of docs) {
      if (!doc?.exists) continue;
      out.set(doc.id, identityFrom(doc.id, doc.data()));
    }
  } catch {
    /* ids only — see the note above */
  }
  return out;
}
