// Q-1133 — A GITHUB FAILURE IS ANSWERED IN OUR OWN WORDS, NOT GITHUB'S.
//
// 🔴 THE DEFECT. Four routes answered a failed GitHub call like this:
//
//     res.status(err.response?.status || 500).json({ error: err.response?.data?.message || err.message });
//
// so whatever wording GitHub chose became the WHOLE error the user read — "Not Found",
// "Bad credentials", "Git Repository is empty." Each is literally true and tells a
// non-technical person nothing about what to DO. A fifth site (`github.ts` push-enhanced)
// had a fallback sentence of ours but still put GitHub's message first, so it reads the same
// way whenever GitHub supplies one. That fifth was not in the row; it was found by hunting
// the shape across the repo, which is the only reason it is fixed here too.
//
// 🧬 THE CLASS IS NOT "FOUR ROUTES FORGOT A SENTENCE" — it is that writing the sentence was
// each route's own job, so four routes independently decided not to. `mobileShip.ts` already
// showed the considered form (a curated hint per status, the upstream message kept as a
// secondary `detail`), and it stayed one route's private good habit instead of becoming the
// way this is done. One function now owns the mapping, and `tests/aGithubFailureIsAnsweredInOurWords.test.ts`
// fails when a NEW route answers by hand — the sibling that does not exist yet.
//
// WHY GITHUB MAY BE NAMED HERE, when the white-label law forbids naming a vendor: GitHub is not
// one of OUR providers running hidden behind the product. It is a service the USER connected,
// with their own account, and the action they are being asked to take ("reconnect GitHub") is
// one they perform on it by name. `httpError.ts`'s redactor lists the model vendors that must
// never surface; GitHub is deliberately not among them.
//
// PURE mapping + one sender. No I/O in the mapping, no clock, no env.

import type { Response } from 'express';
import { sendSafeError, errToString } from './httpError';

/** What the user was trying to do — the hint has to name THAT, not the HTTP verb. */
export type GithubAction = 'fetch' | 'file' | 'branches' | 'push' | 'import';

/** What the person was doing, in their words, for the sentence that always ends the chain. */
const WHAT: Record<GithubAction, string> = {
  fetch: 'read that repository',
  file: 'open that file',
  branches: 'list the branches',
  push: 'push to GitHub',
  import: 'import that repository',
};

export interface GithubErrorAnswer {
  /** The status to answer with. A GitHub 5xx becomes 502: their outage is not the user's bad request. */
  readonly status: number;
  /** The curated sentence the user reads. Never GitHub's own wording. */
  readonly error: string;
  /** GitHub's own message, kept as secondary context when it exists. */
  readonly detail?: string;
}

/**
 * Map a failed GitHub API call to the answer we give. PURE — unit-tested on the real statuses.
 *
 * The hints say what to DO, because that is the whole point of replacing GitHub's wording: a
 * person who reads "Not Found" learns nothing, and a person who reads "that repository or branch
 * does not exist on GitHub, or your account cannot see it" knows where to look.
 */
export function githubApiErrorAnswer(err: unknown, action: GithubAction): GithubErrorAnswer {
  const upstream = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
  const status = typeof upstream?.status === 'number' ? upstream.status : 0;
  const detail = typeof upstream?.data?.message === 'string' && upstream.data.message.trim()
    ? upstream.data.message.trim()
    : undefined;
  const what = WHAT[action];

  const error =
    status === 401 ? 'GitHub did not accept your sign-in. Reconnect GitHub and try again.'
    : status === 403 ? 'GitHub refused the request. This is usually a missing permission or GitHub’s rate limit — reconnect GitHub, or wait a few minutes and try again.'
    : status === 404 ? `We could not ${what}. That repository, branch or file does not exist on GitHub, or your connected account cannot see it.`
    : status === 409 ? 'GitHub has newer changes than the copy here. Import the latest changes first, then try again.'
    : status === 422 ? `GitHub rejected the request to ${what}. Check the repository and branch you selected are the ones you meant.`
    : status === 429 ? 'GitHub is rate-limiting this account right now. Wait a few minutes and try again.'
    : status >= 500 ? `GitHub is having trouble right now, so we could not ${what}. Try again shortly.`
    // No status at all — the call never reached GitHub (network, DNS, timeout).
    : status === 0 ? `We could not reach GitHub to ${what}. Check your connection and try again.`
    : `We could not ${what}. Try again, and reconnect GitHub if it keeps failing.`;

  return { status: status === 0 || status >= 500 ? 502 : status, error, detail };
}

/**
 * Answer a failed GitHub call through the one shared door, so the raw error is still logged
 * server-side and the redactor still runs over everything the client reads.
 */
export function sendGithubApiError(
  res: Response,
  err: unknown,
  action: GithubAction,
  logContext: string,
): Response {
  const answer = githubApiErrorAnswer(err, action);
  return sendSafeError(
    res,
    answer.status,
    answer.error,
    err ?? errToString(err),
    logContext,
    answer.detail,
  );
}
