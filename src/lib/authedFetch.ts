// One authenticated fetch for the client, so the Authorization header is built in exactly ONE place.
//
// This used to live privately inside `secretsApi.ts`. It moved here the moment a second caller needed
// it, rather than being copy-pasted — a duplicated auth helper is precisely the kind of drift that
// later produces "works in Settings, 401s everywhere else" (the repo has paid for that lesson before
// with four copies of one path helper).
//
// The timeout is a parameter, not a constant, because callers differ honestly: a vault write should
// never hang more than a few seconds, while creating a database genuinely takes minutes. A single
// global ceiling would either strand the fast calls or kill the slow one mid-flight.

import { authHeader } from './authHeaders';

/**
 * Authorization header for the signed-in user, or `{}` when signed out.
 *
 * Empty on purpose: sending no header lets the server answer 401 honestly, which is a better outcome
 * than the client guessing at the session state and rendering its own wrong story.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  // Audit finding #3b: this used to be a SECOND implementation of the token path, beside
  // `lib/authHeaders`. Same behaviour, two owners — exactly the drift this module's own header warns
  // about. The name stays (eight files import it); the implementation is now the one path.
  return authHeader();
}

/** Default ceiling — long enough for a normal API call, short enough that a stalled server surfaces. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * `fetch` with auth attached and a bounded timeout, so no caller's spinner can hang forever.
 *
 * An abort is rethrown as a plain Error with a readable message; callers show it as-is.
 */
export async function authedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), ...(await authHeaders()) },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new Error('That took too long to respond. Please check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
