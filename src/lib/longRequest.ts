// LONG REQUESTS — the timeouts that match the work, and the truth to tell when one is cut short.
// (admin 2026-09-07, screenshot: "Could not reach NavBharatAI — nothing was changed" under a button
// that had, in fact, changed things.)
//
// 🔴 THE CLASS OF BUG THIS CLOSES. `authedFetch` has a 20-second default ceiling, chosen for ordinary
// API calls. Several actions on the Publish screen are NOT ordinary API calls: saving an app to GitHub
// resumes a sandbox and pushes a hundred files, a backend deploy talks to a host's API several times,
// creating a database takes minutes by the provider's own admission. Every one of those callers
// silently inherited the 20-second default — and every one of their `catch` blocks then told the user
// that NOTHING had happened. The server had not stopped; only the client had stopped listening.
//
// So the user pressed "Put this app in my GitHub", watched 20 seconds of spinner, read "nothing was
// changed", and pressed it again — while the first push was landing behind their back. A message
// that is false in the one case it is shown for is worse than no message.
//
// Two rules, both enforced here rather than remembered per call site:
//   1. A long action passes a timeout that matches its real duration (`LONG_REQUEST_TIMEOUT_MS`),
//      bounded by the server's own request ceiling (Cloud Run is configured at 3600 s).
//   2. A timeout is reported as "still running, nothing lost" — never as "nothing happened". Only a
//      request that never reached the server can honestly say that. `fetchFailureLine` makes the
//      distinction for every caller, so no `catch` has to get it right on its own.
//
// PURE — no auth, no Firebase, no fetch — so it is testable and importable from anywhere.

/**
 * The error `authedFetch` throws when ITS timer cut the request. A distinct class (and name) so callers
 * can tell "we stopped waiting" from "the network failed", which are different truths to tell.
 */
export class FetchTimeoutError extends Error {
  constructor(message = 'That took too long to respond. Please check your connection and try again.') {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

/** True for a FetchTimeoutError, by class or by name (a value that crossed a module boundary). */
export function isFetchTimeout(err: unknown): boolean {
  if (err instanceof FetchTimeoutError) return true;
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'FetchTimeoutError';
}

/**
 * How long each long-running Publish action is allowed before the client stops waiting.
 *
 * Each value is the real duration of the work, not a guess at what feels responsive: pushing an app
 * to GitHub first resumes (or re-seeds) a sandbox and then runs a full git push; a backend deploy
 * makes several host API calls and may create the service; provisioning a database is minutes at the
 * provider. All are far below the server's 3600 s request ceiling, so the server never cuts them first.
 */
export const LONG_REQUEST_TIMEOUT_MS = {
  pushAppToGitHub: 5 * 60_000,
  deployBackend: 2 * 60_000,
  provisionDatabase: 3 * 60_000,
  storePublish: 90_000,
} as const;

export interface FailureWording {
  /** What to say when the request never reached the server — the only case "nothing happened" is true. */
  notStarted: string;
  /** What to say when WE stopped waiting — the work may well be completing behind the screen. */
  stillRunning: string;
}

/**
 * The honest line for a failed long request.
 *
 * 🔒 A TIMEOUT NEVER SAYS "NOTHING WAS CHANGED". When our own timer fired, the server is still working
 * and may finish; claiming otherwise invites the user to repeat the action on top of the first one.
 * Only a request that failed before reaching the server may say nothing happened. PURE.
 */
export function fetchFailureLine(err: unknown, wording: FailureWording): string {
  return isFetchTimeout(err) ? wording.stillRunning : wording.notStarted;
}
