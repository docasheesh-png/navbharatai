// COMING BACK FROM GITHUB INSIDE THE NATIVE APP (admin report 2026-08-17:
// "github login ho jata hai theek se par, yaha aa kar atak jata hai").
//
// WHAT WAS ACTUALLY WRONG. The overlay that says "Opening GitHub… Please wait." is driven by one piece
// of state, `githubRedirectingMessage`. It is SET when the flow starts, and across the whole codebase it
// was CLEARED in exactly one place: the Dismiss button.
//
// On the web that never showed, because the flow ends in a full-page redirect — the page is replaced and
// the state dies with it. On native there is no navigation at all: the in-app browser opens OVER the app
// and closes again, so the app comes back to the foreground with its state exactly as it was. The login
// had genuinely succeeded, the token was stored, and the screen still said "please wait" forever, with
// the only way out being a Dismiss button that reads like giving up.
//
// So the bug was never in the OAuth handshake. It was that the success path had nothing to say.
//
// THE SECOND STUCK STATE, from the other direction. If the user backs out of the in-app browser, no deep
// link ever fires and the overlay freezes in exactly the same way. Same root cause — a message with no
// path back to null — so both are handled here rather than patching only the one that was reported.
//
// PURE — the parsing and the decision are here so they can be tested without a device.

/** Where the app's OAuth deep link lands. Must match the server's NATIVE_OAUTH_REDIRECT. */
export const GITHUB_DEEP_LINK_PREFIX = 'com.navbharat.ai://github-callback';

/**
 * The token carried by a deep link, or null when this is not our GitHub return.
 *
 * The token rides in the FRAGMENT (`#gh_token=…`) because a fragment is not sent to servers and does not
 * land in logs the way a query string does; the query form is accepted too because it costs nothing and
 * a redirect chain can move it. Returns null for anything that is not our callback — this runs on every
 * deep link the OS hands the app, including ones we did not send. PURE.
 */
export function tokenFromDeepLink(url: string | null | undefined): string | null {
  const raw = String(url ?? '');
  if (!raw.includes('gh_token=')) return null;
  const frag = raw.split('#')[1] ?? raw.split('?')[1] ?? '';
  const token = new URLSearchParams(frag).get('gh_token');
  return token && token.trim() ? token : null;
}

/**
 * The HANDOFF TICKET carried by a deep link, or null when there is none.
 *
 * WHY A TICKET AND NOT THE TOKEN (security audit finding 1, HIGH). A custom URI scheme is not exclusive
 * on Android: any installed app may declare `com.navbharat.ai` and receive this link. Our GitHub scope
 * is `repo workflow` — full read/write on every private repository the user has — so the token itself
 * must never travel this way. The ticket is encrypted with the server key and bound to the uid that
 * started the flow, so an app that intercepts it holds something it can neither read nor redeem.
 *
 * ⚠️ `tokenFromDeepLink` STAYS, and must. The server only sends a ticket to an app that asked for one
 * AND was authenticated at the time; if either was missing it sends the legacy token, so the client has
 * to understand both. Removing the token path would break the flow precisely when authentication was
 * unavailable — the moment it is least helpful to fail.
 */
export function ticketFromDeepLink(url: string | null | undefined): string | null {
  const raw = String(url ?? '');
  if (!raw.includes('gh_ticket=')) return null;
  const frag = raw.split('#')[1] ?? raw.split('?')[1] ?? '';
  const ticket = new URLSearchParams(frag).get('gh_ticket');
  return ticket && ticket.trim() ? ticket : null;
}

/**
 * The query NavBharatAI adds when it wants a ticket rather than a raw token.
 *
 * Sent only by an app that understands `gh_ticket`. An older build omits it and keeps the exact flow it
 * shipped with — which is the whole reason this is opt-in: the app runs from assets baked into its APK,
 * so a server-side switch alone would break GitHub sign-in for everyone who has not updated.
 */
export const TICKET_HANDOFF_QUERY = 'handoff=ticket';

/** What the app should do when it comes back to the foreground mid-sign-in. */
export type ResumeOutcome =
  /** Still waiting with nothing to show for it — the user backed out. Say so and stop spinning. */
  | 'cancelled'
  /** Nothing to do: no sign-in was in flight, or the deep link already resolved it. */
  | 'ignore';

/**
 * Decide what a foreground resume means.
 *
 * The ordering here is the whole subtlety. A successful return fires BOTH the deep link and the resume,
 * and on some platforms in an unhelpful order — so this must never conclude "cancelled" from the resume
 * alone. It concludes cancelled only when the overlay is STILL waiting after the deep link has had its
 * chance (the caller applies a short grace period) and no token has arrived. Anything else is `ignore`,
 * because wrongly telling somebody their successful sign-in was cancelled is worse than saying nothing.
 * PURE.
 */
export function resumeOutcome(state: { stillWaiting: boolean; hasToken: boolean }): ResumeOutcome {
  if (!state.stillWaiting) return 'ignore';   // nothing on screen to correct
  if (state.hasToken) return 'ignore';        // the deep link already won — do not overwrite success
  return 'cancelled';
}

/** How long to let the deep link resolve before treating a resume as a cancellation. */
export const RESUME_GRACE_MS = 1_500;

/** What the user is told when they come back without finishing. Never blames them, never spins on. */
export const GITHUB_CANCELLED_MESSAGE = 'GitHub sign-in was not completed. You can try again.';

/**
 * Exchange a handoff ticket for the real GitHub token.
 *
 * The redemption is what makes an intercepted deep link worthless: it is authenticated with the user's
 * Firebase ID token, which an app that merely grabbed the URI does not have. The ticket alone proves
 * nothing.
 *
 * Returns null on any failure rather than throwing. The caller is a deep-link listener with no
 * try/catch around it, and an unhandled rejection there would take down the handler for every future
 * link, not just this one.
 */
export async function redeemGithubTicket(
  ticket: string,
  deps?: {
    headers: () => Promise<Record<string, string>>;
    post: (url: string, init: RequestInit) => Promise<Response>;
  },
): Promise<string | null> {
  try {
    const headers = deps ? await deps.headers() : await (await import('./authHeaders')).authJsonHeaders();
    const post = deps?.post ?? ((url: string, init: RequestInit) => fetch(url, init));
    const res = await post('/api/github/native-exchange', {
      method: 'POST',
      headers,
      body: JSON.stringify({ ticket }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = typeof data?.token === 'string' ? data.token.trim() : '';
    return token || null;
  } catch {
    return null;
  }
}
