// "Live server is a paid service" — the honest cost note for v5's Live-server preview (admin 2026-08-16:
// "jab user live server use kare, to ek warning note aaye — yeh paid service hai").
//
// WHY IT IS TRUE. The v5 build's two previews cost very different things:
//   • In-browser  — rendered in the user's OWN browser. No server, no cost. Instant, always available.
//   • Live server — the app runs on a REAL cloud machine (paid compute, billed by the second it is up).
//     That machine's time is part of what a paid build costs, so keeping the live server running spends
//     the user's credits. A user should know that before they lean on it.
//
// WHITE-LABEL (§2): names NO vendor — "a real cloud machine", never the provider. Honest about cost
// without leaking which cloud runs it.
//
// NEVER NAG (same discipline as the update banner): the note is dismissible and the dismissal is
// remembered, so it is shown until the user acknowledges it — not on every single switch forever. The
// always-visible "Paid" marker on the Live-server toggle keeps the fact discoverable after dismissal.

/** The one-line, vendor-free note shown while the Live server preview is in use. */
export const LIVE_SERVER_PAID_NOTE =
  'Live server is a paid service — it runs your app on a real cloud machine and uses your credits while ' +
  'it is on. The In-browser preview is free and instant.';

/** The short marker shown on the Live-server toggle so the cost is clear even after the note is dismissed. */
export const LIVE_SERVER_PAID_TAG = 'Paid';

const DISMISS_KEY = 'nb_live_paid_note_dismissed_v1';

type Getter = Pick<Storage, 'getItem'> | null;
type Setter = Pick<Storage, 'setItem'> | null;

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Has the user already acknowledged the paid-service note? Never throws (private mode ⇒ false). */
export function isLiveServerNoticeDismissed(store: Getter = safeLocalStorage()): boolean {
  try {
    return store?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that the user acknowledged the note, so it is not shown again. Never throws. */
export function dismissLiveServerNotice(store: Setter = safeLocalStorage()): void {
  try {
    store?.setItem(DISMISS_KEY, '1');
  } catch {
    /* private mode — the note simply shows again next time, which is acceptable */
  }
}
