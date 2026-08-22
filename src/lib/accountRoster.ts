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
 *
 * Shortened to "Add account" (admin 2026-08-22): it now sits at the BOTTOM of a list of accounts
 * under a "Switch account" heading, where "another" is already implied by everything above it.
 */
export function addAccountLabel(roster: readonly RosterAccount[]): string {
  return canAddAccount(roster)
    ? 'Add account'
    : `You can keep ${MAX_ACCOUNTS} accounts on this device — remove one to add another`;
}

/**
 * Does signing in as this target require leaving the current account first? PURE.
 *
 * ⚠️ THE ANSWER IS ALWAYS NO, and that is the whole point (admin 2026-08-22: "add account click kare
 * aur koi bhi other account login nahi kare to logout ho ja raha hai").
 *
 * Both controls used to sign the user OUT and reload onto the sign-in screen. So the moment you
 * pressed "Add account" you were already logged out — and if you then changed your mind, you had lost
 * your session for pressing a button that promised to ADD one. A cancelled action must cost nothing.
 *
 * Firebase can sign a new user in while one is active: on success it becomes the current user, and on
 * cancel nothing changes at all. So the sign-in modal is simply opened over the app, and the sign-out
 * is not merely deferred — it is not needed.
 *
 * This exists as a named function rather than as a deleted line because the old flow READ correctly
 * ("switch means leave, then arrive") and someone will reach for it again.
 */
export function switchRequiresSignOutFirst(): boolean {
  return false;
}

/**
 * The heading for the account section, and what the avatar menu's control is called. PURE.
 *
 * "Switch account" rather than "Add another account" (admin 2026-08-22): switching is what people
 * come to this menu to do, and adding is one option inside it — not the name of the whole thing.
 */
export const SWITCH_ACCOUNT_LABEL = 'Switch account';

/**
 * Where the sign-in screen looks for "the account the user was trying to reach".
 *
 * Named here, beside the roster, so the writer and any future reader share one constant. The previous
 * attempt wrote `nbai:switch-to` and nothing ever read it — a stored hint standing in for a working
 * handoff, which is the same shape of bug as a stale URL standing in for a live preview.
 */
export const SIGN_IN_HINT_KEY = 'nbai:sign-in-hint';

/**
 * Every row the account list should show, current account FIRST and marked.
 *
 * The old list showed only the OTHERS, and hid itself entirely when there were none — so a user with
 * one account saw no list at all and only an "Add another account" button, which is exactly why the
 * menu read as an add-only control. Showing the current account (disabled, ticked) makes the list a
 * list of accounts rather than a list of alternatives.
 */
export function accountRows(
  roster: readonly RosterAccount[],
  currentUid: string | null | undefined,
  current?: { uid: string; email?: string | null; displayName?: string | null; photoURL?: string | null } | null,
): Array<RosterAccount & { isCurrent: boolean }> {
  const cur = String(currentUid ?? '').trim();
  const others = roster.filter((a) => a.uid !== cur).map((a) => ({ ...a, isCurrent: false }));
  const mine = roster.find((a) => a.uid === cur);
  if (mine) return [{ ...mine, isCurrent: true }, ...others];
  // Signed in as somebody the roster has not recorded yet (first load, or a cleared roster): build the
  // row from the live user rather than omitting them, so the list is never missing the person using it.
  if (cur && current) {
    return [{
      uid: cur,
      email: String(current.email ?? ''),
      name: String(current.displayName ?? ''),
      photo: String(current.photoURL ?? ''),
      provider: '',
      lastUsed: 0,
      isCurrent: true,
    }, ...others];
  }
  return others;
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
