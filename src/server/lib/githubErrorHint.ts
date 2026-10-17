/**
 * WHAT TO SAY WHEN GITHUB REFUSES — decided ONCE, not per route.
 *
 * 🔴 WHY (Q-1133, found while fixing Q-887). Measured across the repo, the same question had three
 * different answers and four non-answers:
 *
 *   ❌ `github.ts` ×3 and `cloudsync.ts` answered with the upstream service's own message as the
 *      WHOLE error — `{ error: err.response?.data?.message || err.message }`. A user who pulled a
 *      private repo met GitHub's wording ("Not Found"), which tells a non-technical owner nothing
 *      about what to DO, and `GitPanel` renders that string straight into its log line.
 *   ✅ `mobileShip.ts` had the considered form — a curated hint per status with the upstream message
 *      kept as a secondary `detail`.
 *   ✅ `mobileSetup.ts` had a THIRD, separately-written ladder for the same statuses.
 *
 * 🔑 THE CLASS: a judgement every call site had to make for itself. Four made none, and the two that
 * made it made it twice — so a wording improvement in one place could never reach the others. This is
 * the ladder; a route supplies what the user was trying to do, and overrides only where it genuinely
 * knows something more exact (which is why `mobileShip`'s and `mobileSetup`'s own sentences survive
 * this move verbatim rather than being flattened into generic ones).
 *
 * 🔒 AND THE DETAIL IS REDACTED NOW, which it was not before. The upstream message is useful to the
 * user and is deliberately kept (that is Q-887's recorded line: a BODY must never pass through, a
 * `.message` from a service the user connected may) — but it goes through `toSafeClientMessage`, so a
 * URL, a token-bearing clone URL or a vendor name inside somebody else's error text cannot ride out
 * on it.
 *
 * PURE: facts in, answer out. No Express, no I/O, so every rung is tested on its own.
 */

import { errToString, toSafeClientMessage } from './httpError';

/** The statuses a route may say something more exact about. */
export type GithubHintStatus = 401 | 403 | 404 | 409 | 422 | 429;

export interface GithubErrorAnswer {
  /** What to answer with. Upstream 5xx (and an unreachable GitHub) become 502 — our server is fine. */
  status: number;
  /** The curated sentence. Never the upstream wording alone. */
  error: string;
  /** The upstream message, redacted. Absent when there was none. */
  detail?: string;
}

/** Status + upstream message, read defensively from anything axios-shaped. */
function readUpstream(err: unknown): { status: number; message: string } {
  const e = err as { response?: { status?: number; data?: { message?: unknown } } };
  const status = typeof e?.response?.status === 'number' ? e.response.status : 0;
  const fromBody = e?.response?.data?.message;
  const message = typeof fromBody === 'string' && fromBody.trim() ? fromBody.trim() : errToString(err);
  return { status, message };
}

/**
 * GitHub answers 403 for BOTH "you may not" and "you have asked too often", and the two need
 * opposite actions — reconnect versus wait. Only the message tells them apart.
 */
function isRateLimited(status: number, message: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  return /rate limit|secondary rate|abuse detection|too many requests/i.test(message);
}

export function githubErrorAnswer(
  err: unknown,
  what: {
    /**
     * What the user was trying to do, as a verb phrase completing "Could not …" —
     * e.g. `'read that repository'`. Lower case, no trailing full stop.
     */
    action: string;
    /** The thing being acted on, for the 404 rung — e.g. `'that repository'`. */
    subject?: string;
    /**
     * Per-status sentences a route knows more exactly than this ladder can.
     *
     * The object form also carries a `status`, for the one real case a route knows better: `mobileSetup`
     * answers **403** to an upstream 401, because on that route a 401 means "your connection may not
     * create repositories", not "sign in again" — and a client that saw a 401 could reasonably throw
     * the user at a sign-in screen they do not need. A wording override must never silently change a
     * status, so saying it is explicit.
     */
    hints?: Partial<Record<GithubHintStatus, string | { error: string; status?: number }>>;
  },
): GithubErrorAnswer {
  const { status, message } = readUpstream(err);
  const subject = what.subject || 'it';
  const hintFor = (s: GithubHintStatus) => what.hints?.[s];
  const override = (s: GithubHintStatus): string | undefined => {
    const h = hintFor(s);
    return typeof h === 'string' ? h : h?.error;
  };
  /** A status a route explicitly chose for this rung, or 0. */
  const overrideStatus = (s: GithubHintStatus): number => {
    const h = hintFor(s);
    return typeof h === 'object' && typeof h.status === 'number' ? h.status : 0;
  };

  let error: string;
  if (isRateLimited(status, message)) {
    error = override(429) ?? override(403)
      ?? 'GitHub is asking us to slow down (its rate limit). Nothing was changed — try again in a few minutes.';
  } else if (status === 401) {
    error = override(401) ?? 'GitHub did not accept the connection. Reconnect GitHub in Settings and try again.';
  } else if (status === 403) {
    error = override(403)
      ?? 'GitHub refused the request — your connection may not have permission for this. Reconnect GitHub and allow the "repo" and "workflow" permissions.';
  } else if (status === 404) {
    error = override(404)
      ?? `GitHub could not find ${subject}. It may be private, renamed or deleted — check the name, and that the GitHub account you connected can see it.`;
  } else if (status === 409) {
    error = override(409) ?? `${subject} changed while we were working on it. Please try again.`;
  } else if (status === 422) {
    error = override(422) ?? `GitHub refused the request as invalid, so nothing was changed. Could not ${what.action}.`;
  } else {
    // 5xx, a network failure, or anything unrecognised: this is not the user's doing, and it is not
    // our server's either — say so plainly and do not invite them to change anything.
    error = status >= 500 || status === 0
      ? `GitHub is not responding right now, so nothing was changed. Could not ${what.action} — try again in a moment.`
      : `Could not ${what.action}.`;
  }

  const detail = message ? toSafeClientMessage(message, message) : '';
  // A 4xx is the client's/GitHub's answer and is passed through; everything else is a gateway problem
  // and 502 is the honest code for it. mobileShip already answered 502 this way.
  const chosen = status >= 400 && status < 500 ? overrideStatus(status as GithubHintStatus) : 0;
  return {
    status: chosen || (status >= 400 && status < 500 ? status : 502),
    error,
    ...(detail ? { detail } : {}),
  };
}
