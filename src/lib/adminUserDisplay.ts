// How the admin panel PRINTS a join date and a last-active date.
//
// It is a separate, pure module for one reason: these two cells are read while deciding whether an
// account is dormant, suspicious, or worth refunding, and the difference between "we have not seen
// them in 7 months" and "we could not read it" changes that decision completely. Formatting that
// distinction away inside a JSX expression is how it would get lost.
//
// 🔒 UNREAD IS NOT NEVER. `atMs: null` prints an em dash and says so on hover — never an empty cell
// (which reads as "never signed in") and never a fabricated date. Same rule the account sheet's
// wallet card already follows.

import { timeAgo } from './publishFreshness';

/** Where the timestamp came from — mirrors `DateSource` on the server. */
export type StampSource = 'auth' | 'wallet' | 'activity' | 'unread' | string;

export interface StampLabel {
  /** What the cell shows. */
  text: string;
  /** The tooltip: the exact date, and where it came from when that matters. */
  title: string;
  /** True when there is genuinely no reading — so the cell can be styled as absent, not as old. */
  unread: boolean;
}

/**
 * Why a source is ever mentioned to the admin: a wallet-derived join date is the date the WALLET was
 * made, which for a re-created wallet is later than the person actually joined. Saying so is the
 * difference between a number an admin can act on and one that quietly misleads them.
 */
const SOURCE_NOTE: Record<string, string> = {
  wallet: 'from the wallet record — the account may be older',
  activity: 'from their last AI request',
};

/** Format one timestamp for the users table. PURE. */
export function stampLabel(atMs: number | null | undefined, source: StampSource, now: number = Date.now()): StampLabel {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs <= 0) {
    return { text: '—', title: 'We could not read this date. It does not mean never.', unread: true };
  }
  const exact = new Date(atMs).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const note = SOURCE_NOTE[String(source)];
  return {
    text: timeAgo(atMs, now),
    title: note ? `${exact} (${note})` : exact,
    unread: false,
  };
}

/** The absolute date, for the places that want the day rather than "3 months ago". PURE. */
export function dayLabel(atMs: number | null | undefined): string {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs) || atMs <= 0) return '—';
  return new Date(atMs).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

/**
 * The sign-in methods, in words an admin reads rather than Firebase's provider ids.
 *
 * `google.com` is perfectly clear to a developer and meaningless on a screen the non-technical owner
 * of this product uses. An id we do not have a word for is passed through unchanged rather than
 * dropped — an unknown method is still a fact about the account.
 */
const METHOD_WORDS: Record<string, string> = {
  'google.com': 'Google',
  'apple.com': 'Apple',
  'password': 'Email + password',
  'phone': 'Phone (OTP)',
  'github.com': 'GitHub',
  'facebook.com': 'Facebook',
};

export function signInMethodWords(providers: readonly string[] | null | undefined): string {
  const list = (providers ?? []).map((p) => METHOD_WORDS[p] ?? p).filter(Boolean);
  return list.length > 0 ? list.join(', ') : '—';
}
