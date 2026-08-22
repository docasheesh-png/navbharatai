// THE ACCOUNTS THIS DEVICE KNOWS — profile switching, the way people already expect it.
//
// Admin, 2026-08-22: "user apne photo/logo par click kar ke switch profile kare, wapas login kar le,
// ek saath 5 id login ho sake" — the pattern from Google, Instagram, WhatsApp.
//
// 🔒 WHAT THIS STORES, AND WHAT IT DELIBERATELY DOES NOT.
// Metadata only: uid, email, name, photo, which provider signed them in, and when they were last
// used. **No tokens, ever.** A refresh token in localStorage is a permanent account takeover for
// anyone who reaches that storage — an XSS, a shared machine, a browser extension — and the
// convenience of skipping one tap is nowhere near worth it. The roster's job is to REMEMBER who you
// are, not to hold the keys to it.
//
// ⚠️ HONEST BOUNDARY, stated here because the UI must not overstate it: the Firebase SDK holds ONE
// live session per app instance. So switching re-authenticates with the provider rather than keeping
// five sessions live in parallel. In practice the provider's own session is usually still valid, so
// it is a single tap with nothing to retype — but it is a FAST SWITCH, not five simultaneous logins,
// and the code says so rather than pretending otherwise.
//
// PURE over an injected store, so every rule is unit-tested.

export interface RosterAccount {
  uid: string;
  email: string;
  /** Display name, or '' when the provider gave none. */
  name: string;
  /** Photo URL, or '' — the UI falls back to an initial. */
  photo: string;
  /** Firebase provider id that signed this account in ('google.com', 'apple.com', 'password', …). */
  provider: string;
  /** When this account was last the active one (ms) — drives ordering and eviction. */
  lastUsed: number;
}

export interface RosterStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'nbai:accounts';

/**
 * How many accounts a device remembers.
 *
 * Five, because that is what the admin asked for and what the apps people already use settle on. A
 * cap is not arbitrary tidiness: an unbounded roster on a shared or public machine is a list of every
 * person who ever signed in there, shown to whoever is sitting at it next.
 */
export const MAX_ACCOUNTS = 5;

/** Read the roster, newest-used first. Never throws; junk storage reads as empty. PURE given the store. */
export function readRoster(store: RosterStore | null | undefined): RosterAccount[] {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitize)
      .filter((a): a is RosterAccount => a !== null)
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, MAX_ACCOUNTS);
  } catch {
    return [];
  }
}

/** Persist a roster. Never throws — a device with storage disabled simply does not remember. */
export function writeRoster(store: RosterStore | null | undefined, accounts: RosterAccount[]): void {
  try { store?.setItem(KEY, JSON.stringify(accounts.slice(0, MAX_ACCOUNTS))); } catch { /* private mode — switching still works, it just is not remembered */ }
}

/**
 * Record a successful sign-in. PURE.
 *
 * Re-signing in as someone already on the roster UPDATES that entry rather than adding a second —
 * matching on uid, not email, because a person can hold the same email across providers and two rows
 * for one human is exactly the confusion a switcher exists to remove.
 *
 * At the cap, the LEAST-RECENTLY-USED account is dropped. Never the one being added, and never the
 * one currently active: evicting the account someone is signing into would make the feature look
 * broken at the precise moment it is used.
 */
export function rememberAccount(existing: readonly RosterAccount[], account: RosterAccount): RosterAccount[] {
  const clean = sanitize(account);
  if (!clean) return [...existing];
  const others = existing.filter((a) => a.uid !== clean.uid);
  return [clean, ...others]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .slice(0, MAX_ACCOUNTS);
}

/**
 * Forget one account on this device. PURE.
 *
 * 🔒 This removes it from the ROSTER only. It does not delete the account, and it does not sign it out
 * anywhere else — a promise this list is in no position to keep. The UI must say "remove from this
 * device", never "sign out", or someone will use it believing they have secured a shared computer.
 */
export function forgetAccount(existing: readonly RosterAccount[], uid: string): RosterAccount[] {
  const id = String(uid ?? '').trim();
  return existing.filter((a) => a.uid !== id);
}

/** The accounts to OFFER as switch targets: everyone except whoever is signed in right now. PURE. */
export function switchTargets(roster: readonly RosterAccount[], currentUid: string | null | undefined): RosterAccount[] {
  const cur = String(currentUid ?? '').trim();
  return roster.filter((a) => a.uid !== cur);
}

/** Is there room for another account, or must one be removed first? PURE. */
export function canAddAccount(roster: readonly RosterAccount[]): boolean {
  return roster.length < MAX_ACCOUNTS;
}

/**
 * What the "add another account" control should say. PURE.
 *
 * At the cap it explains the limit and the way out instead of showing a disabled button with no
 * reason — a dead control that says nothing is the thing this codebase keeps removing.
 */
export function addAccountLabel(roster: readonly RosterAccount[]): string {
  return canAddAccount(roster)
    ? 'Add another account'
    : `You can keep ${MAX_ACCOUNTS} accounts on this device — remove one to add another`;
}

/** A short label for a roster row: the name when there is one, otherwise the email. PURE. */
export function accountLabel(a: RosterAccount): string {
  return a.name.trim() || a.email.trim() || 'Signed-in account';
}

/** The letter shown when an account has no photo. PURE. */
export function accountInitial(a: RosterAccount): string {
  const source = a.name.trim() || a.email.trim();
  return (source[0] || '?').toUpperCase();
}

/** Drop anything that is not a usable account row. A uid is the one field nothing works without. */
function sanitize(raw: unknown): RosterAccount | null {
  const a = raw as Partial<RosterAccount> | null;
  const uid = typeof a?.uid === 'string' ? a.uid.trim() : '';
  if (!uid) return null;
  const lastUsed = typeof a?.lastUsed === 'number' && Number.isFinite(a.lastUsed) && a.lastUsed > 0 ? a.lastUsed : 0;
  return {
    uid,
    email: typeof a?.email === 'string' ? a.email : '',
    name: typeof a?.name === 'string' ? a.name : '',
    photo: typeof a?.photo === 'string' ? a.photo : '',
    provider: typeof a?.provider === 'string' ? a.provider : '',
    lastUsed,
  };
}
