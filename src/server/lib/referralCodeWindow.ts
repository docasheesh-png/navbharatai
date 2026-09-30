// HOW LONG A NEW ACCOUNT MAY APPLY A FRIEND'S REFERRAL CODE (admin 2026-09-30).
//
// Admin, verbatim: *"Refral code dalne ka option 3 bar app open hone ke bad band ho jana chahiye …
// 4th time user app open kare to yeh refral code dalne wala input box gayab ho jaye! Aur notification me
// bhi refral 100₹ wale ke age missed (❌) likh kar aa jaye!"* — and, asked to settle the three open
// details: *"30 min wala theek hai · han 7 din baad apne aap band ho jaye · b"*.
//
// So a code may be applied while BOTH hold:
//   • the account has opened the app at most THREE times — opens inside 30 minutes of the last counted
//     one are the same open, so coming back from WhatsApp does not spend a chance; and
//   • the account is less than SEVEN days old — the backstop, whichever comes first.
// Choice "b": an account already older than seven days on the day this shipped is closed at once. That
// is not a special migration — it is the age rule applied to everyone, which is why there is none.
//
// 🔴 WHY: the only limit before this was `canStillRedeem` — a code is refused once the account has
// verified its mobile or linked GitHub. An account that never did either could apply a friend's code
// months later, which is the misuse the admin named. This module adds the WHEN; the existing rules
// (device once, new account, one code per account) are unchanged.
//
// 🔒 COUNTED ON THE SERVER, NEVER ON THE PHONE. A count kept on the device resets when the app's data is
// cleared or the app is reinstalled — the two things somebody trying to reuse the box would do first.
// The count lives on the account's referral record.
//
// 🔒 WHY THE AGE BACKSTOP IS NOT OPTIONAL. Opens are reported by the app. An app that never reports
// (an old build, a patched one) would otherwise keep the box open for ever; seven days bounds it no
// matter what the phone says.
//
// PURE — no clock, no store, no env. The caller passes `nowMs` and persists what this returns.

/** How many app opens keep the box: it is gone from the fourth. */
export const CODE_WINDOW_OPENS = 3;
/** Opens this close together are one open. */
export const OPEN_GAP_MS = 30 * 60 * 1000;
/** The backstop: an account this old may no longer apply a code, however few times it opened the app. */
export const CODE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AppOpenState {
  /** App opens counted so far (see OPEN_GAP_MS). */
  appOpens: number;
  /** When the last COUNTED open began. The 30-minute window runs from here, not from every ping. */
  lastAppOpenAt: string | null;
}

/** Read the stored fields defensively: anything unreadable counts as never having opened. */
export function readAppOpenState(rec: { appOpens?: unknown; lastAppOpenAt?: unknown } | null | undefined): AppOpenState {
  const n = Number(rec?.appOpens);
  const last = typeof rec?.lastAppOpenAt === 'string' && Number.isFinite(Date.parse(rec.lastAppOpenAt))
    ? rec.lastAppOpenAt
    : null;
  return { appOpens: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0, lastAppOpenAt: last };
}

/**
 * Record that the app was opened now.
 *
 * A new open is counted when there is no earlier one, or when the last counted open began 30 minutes or
 * more ago. The window is measured from the last COUNTED open, so an app kept in use all afternoon is
 * one open per half-hour at most, never zero and never one per screen.
 *
 * Once the count has passed the limit nothing more is recorded (`counted: false`), so a closed window
 * costs no further writes.
 */
export function countAppOpen(state: AppOpenState, nowMs: number): { next: AppOpenState; counted: boolean } {
  if (state.appOpens > CODE_WINDOW_OPENS) return { next: state, counted: false };
  const last = state.lastAppOpenAt ? Date.parse(state.lastAppOpenAt) : NaN;
  // A clock that runs backwards is treated as the same open: counting it would spend a chance on a glitch.
  if (Number.isFinite(last) && nowMs - last < OPEN_GAP_MS) return { next: state, counted: false };
  return {
    next: { appOpens: state.appOpens + 1, lastAppOpenAt: new Date(nowMs).toISOString() },
    counted: true,
  };
}

export type CodeWindowClosedBy = 'opens' | 'age';

export type CodeWindow =
  | { open: true; opensLeft: number }
  | { open: false; closedBy: CodeWindowClosedBy };

/**
 * Is the window still open?
 *
 * `accountCreatedAt` is the account's own creation time. When it cannot be read the age rule cannot
 * speak, and the opens rule alone decides — refusing a genuinely new person because a lookup failed
 * would be the wrong way round.
 */
export function codeWindow(input: {
  appOpens: number;
  accountCreatedAt: string | null | undefined;
  nowMs: number;
}): CodeWindow {
  if (input.appOpens > CODE_WINDOW_OPENS) return { open: false, closedBy: 'opens' };
  const created = input.accountCreatedAt ? Date.parse(input.accountCreatedAt) : NaN;
  if (Number.isFinite(created) && input.nowMs - created >= CODE_WINDOW_DAYS * DAY_MS) {
    return { open: false, closedBy: 'age' };
  }
  return { open: true, opensLeft: Math.max(0, CODE_WINDOW_OPENS - input.appOpens) };
}

/** The sentence a user reads when the box has closed. It says why, and never implies a fault. */
export function codeWindowClosedMessage(): string {
  return `A referral code can be applied only in your first ${CODE_WINDOW_OPENS} app opens or first `
    + `${CODE_WINDOW_DAYS} days. Your account still earns every other bonus.`;
}

/**
 * Pick the earliest readable time, for the account's age. Firebase's own creation time is preferred;
 * the referral record's creation time is the fallback when that lookup fails — it is never EARLIER than
 * the account, so falling back can only keep a window open longer, never close one too soon.
 */
export function accountCreatedAt(...candidates: Array<string | null | undefined>): string | null {
  const times = candidates
    .map((c) => (typeof c === 'string' ? Date.parse(c) : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
