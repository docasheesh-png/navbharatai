// SHARING A REFERRAL CODE — the device's own share sheet, with an honest fallback.
//
// ADMIN 2026-09-17: *"aur niche ek button ho, share — jis par click karte hi navbharatai ka link aur
// code use jahan share karna chahe kar de, fb/whatsapp/insta chahe jahan!"*
//
// 🔴 WHAT WAS ACTUALLY MISSING, because almost everything else was already built. The referral surface
// had a `Share2` ICON next to a paragraph of text and no share action behind it — `navigator.share`
// appears exactly once in this entire repo, in the image generator. So the code could be COPIED and
// never SHARED, and "copy this, now go and find WhatsApp yourself" is the step where most people stop.
//
// WHY THE DEVICE SHEET RATHER THAN BUTTONS PER APP: a row of WhatsApp/Facebook/Instagram buttons is
// three integrations that each break on their own schedule, cannot reach the app the user actually
// wants, and on Android duplicate a sheet the OS already draws better. One `navigator.share` call
// offers every app installed on that phone — which is the literal ask, "jahan share karna chahe".
//
// 🔒 THREE OUTCOMES, AND THE MIDDLE ONE IS THE EASIEST TO GET WRONG:
//   • shared    — the sheet opened and the user picked something.
//   • dismissed — the sheet opened and the user backed out. This is NOT an error and must show NO
//     message at all. `navigator.share` rejects with an AbortError when the user cancels, so a naive
//     `catch` reports "sharing failed" to somebody who simply changed their mind.
//   • copied    — no share sheet on this device (most desktop browsers), so the text goes to the
//     clipboard and the caller says so. Never a dead button.
//
// PURE decision + one thin effect, so the branch that matters can be tested without a browser.

export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

/** The minimum of `navigator` this needs — kept tiny so a test can supply it exactly. */
export interface ShareCapableNavigator {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  canShare?: (data: { title?: string; text?: string; url?: string }) => boolean;
  clipboard?: { writeText?: (s: string) => Promise<void> };
}

/**
 * Can this device open a real share sheet? PURE.
 *
 * `canShare` is consulted when present because a browser may expose `share` and still refuse THIS
 * payload; treating "share exists" as "share works" is how a button becomes a silent no-op.
 */
export function canOpenShareSheet(nav: ShareCapableNavigator | null | undefined, payload: { text: string; url?: string }): boolean {
  if (typeof nav?.share !== 'function') return false;
  if (typeof nav.canShare === 'function') {
    try { return nav.canShare(payload) === true; } catch { return false; }
  }
  return true;
}

/**
 * Was this rejection the user closing the sheet rather than something breaking? PURE.
 *
 * ⚠️ The name is checked, not the message: browsers word it differently and some localise it. A
 * `NotAllowedError` counts too — Safari raises it when the gesture is judged stale, which from the
 * user's side is also "nothing happened", not "something failed".
 */
export function isUserDismissal(err: unknown): boolean {
  const name = String((err as { name?: unknown } | null)?.name ?? '');
  return name === 'AbortError' || name === 'NotAllowedError';
}

/**
 * Open the share sheet, or copy. Returns what actually happened so the caller can say something true.
 *
 * ⚠️ MUST be called straight from a click handler. Browsers require a user gesture for
 * `navigator.share`, and any `await` before it can spend that gesture — which is why the message is
 * passed in, already built, rather than fetched here.
 */
export async function shareReferral(
  message: string,
  url: string | undefined,
  nav: ShareCapableNavigator | null | undefined,
): Promise<ShareOutcome> {
  const text = String(message ?? '').trim();
  if (!text) return 'failed';
  // The message already ENDS with the link (see `referralShareMessage`), so `url` is passed only
  // where the platform shows it as a rich preview — never duplicated into the text.
  const payload = url ? { text, url } : { text };

  if (canOpenShareSheet(nav, payload)) {
    try {
      await nav!.share!(payload);
      return 'shared';
    } catch (err) {
      // Backing out of the sheet is a decision, not a failure. Say nothing.
      if (isUserDismissal(err)) return 'dismissed';
      // A genuine share failure still leaves the user something usable rather than a dead button.
      return (await copyText(text, nav)) ? 'copied' : 'failed';
    }
  }
  return (await copyText(text, nav)) ? 'copied' : 'failed';
}

async function copyText(text: string, nav: ShareCapableNavigator | null | undefined): Promise<boolean> {
  try {
    if (typeof nav?.clipboard?.writeText !== 'function') return false;
    await nav.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
