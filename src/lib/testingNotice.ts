// THE TESTING NOTICE — a pinned card in Notifications, never a popup (admin 2026-09-27).
//
// History, because the reason for the shape is the admin's own words twice over:
//
// • 2026-09-14 — *"home page par hi jab bhi user app open kare, 3 seconds ke liye ek popup aa jaye —
//   'abhi ham testing phase me hai, is liye failure ko please report kare…'"*. It shipped as a card
//   floating over the home screen, once per app open, with a "Report a problem" button.
// • 2026-09-27 — *"isko popup se hat kar notifications me kar do! isi ux me. same bas alag popup ki
//   jagah notification me aye! jisse user disturb na ho!"*. The message and the button are unchanged;
//   only WHERE it lives changed. A popup interrupts every app open; a notification waits to be read.
//
// 🔒 IT STILL ASKS FOR SOMETHING, SO IT STILL HANDS OVER THE WAY TO DO IT. The card carries the same
// button that opens the app-wide `ReportSheet` — the sheet the sidebar's "Report a problem" and a phone
// shake open. A notice that says "please report" with no way to do it is the half-built state the
// second absolute rule forbids.
//
// 🔔 HOW ANYONE FINDS IT WITHOUT BEING INTERRUPTED. It counts as ONE unread notification until the user
// has opened Notifications once on this device, so the ☰ button carries its usual red dot and the
// Notifications row its usual number. Opening the panel is what clears it — the same moment every other
// notification is marked read. After that the card stays pinned (so it can always be found) but raises
// no dot again. That is `localStorage` on purpose: "seen once on this device" is the promise, and a
// dot on every app open would be the popup's nagging in a quieter form.
//
// ⚠️ SIGNED-IN ONLY, AND THAT LOSES NOTHING. The Notifications row exists only for a signed-in user, and
// the report sheet it opens requires sign-in too (a report nobody can be asked about cannot be followed
// up). The old popup did show to a signed-out visitor — and handed them a button whose sheet then asked
// them to sign in first.
//
// PURE — no clock, no DOM, no React. Storage access is injected and guarded.

/** The copy, in one place so a test can pin it and a translation never has to hunt for it. */
export const TESTING_NOTICE_COPY = {
  /** Short enough to land in a glance; the detail is in the body. */
  title: 'NavBharatAI is in active testing',
  body: "If something doesn't work, please report it — that's how we make it stronger. Thank you.",
  /** The exact label of the sheet this opens, so the card and the menu entry name one thing. */
  action: 'Report a problem',
} as const;

/** Set once the user has opened Notifications and so has had the chance to read the card. */
export const TESTING_NOTICE_SEEN_KEY = 'nbai_testing_notice_seen';

/**
 * Has the user already seen the card on this device?
 *
 * Storage can throw (private mode, blocked site data) or come back empty. Both read as "seen": the
 * worst outcome of guessing wrong that way is one missing dot on a card that is still pinned in the
 * panel, whereas guessing "unseen" would pin a red dot on the menu that no amount of opening the panel
 * could ever clear — the storage that would record it is the thing that failed.
 */
export function testingNoticeSeen(store?: Pick<Storage, 'getItem'> | null): boolean {
  try {
    const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!s) return true;
    return s.getItem(TESTING_NOTICE_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** Remember that the card has been seen. Never throws — forgetting only costs one more dot. */
export function markTestingNoticeSeen(store?: Pick<Storage, 'setItem'> | null): void {
  try {
    const s = store ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    s?.setItem(TESTING_NOTICE_SEEN_KEY, '1');
  } catch { /* nothing to remember with — the dot simply shows again next time */ }
}

/**
 * The unread number the ☰ dot and the Notifications row show: the inbox's own count, plus one while the
 * testing card is unseen. Only a signed-in user has a Notifications row, so only they are counted —
 * a dot pointing at a row that is not there would be a dot nothing can clear. PURE.
 */
export function unreadWithTestingNotice(opts: {
  inboxUnread: number;
  signedIn: boolean;
  seen: boolean;
}): number {
  const base = Number.isFinite(opts?.inboxUnread) && opts.inboxUnread > 0 ? Math.floor(opts.inboxUnread) : 0;
  if (!opts?.signedIn) return base;
  return base + (opts.seen ? 0 : 1);
}
