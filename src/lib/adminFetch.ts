/**
 * HOW AN ADMIN REQUEST IS AUTHENTICATED — one place, because four places is how it went wrong.
 *
 * 🔴 THE BUG THIS EXISTS TO KILL (admin screenshot, 2026-09-14: "live matrix farzi hai, real data
 * nahi show ho raha"). Settings → Metrics showed **0 total builds, 0% success, 0% preview, 0s average,
 * "No AI calls recorded yet", $0.0000** — on an account that had built apps that same day.
 *
 * Nothing was mocked. The screen had simply NEVER been able to load anything:
 *
 *   • `/api/admin/metrics` authenticates with the **`x-admin-token`** header (`verifyAdminToken`).
 *   • `SettingsPanel` sent **`Authorization: Bearer <token>`** — in BOTH of its call sites.
 *   • So the route answered **401 `{ error: 'Admin token required.' }`**, every time, for every admin.
 *   • The client did `.then(r => r.json()).then(setAdminLiveMetrics)` with **no `r.ok` check**, so that
 *     error object became the dashboard's data. It is truthy, so the panel rendered — and every field
 *     fell through its `?? 0`.
 *
 * **A confident dashboard of zeros, assembled entirely out of fallbacks over an auth failure.** That
 * is the second absolute rule's "a status indicator MUST reflect real state — never faked", and it is
 * worse than a blank screen: a blank screen asks a question, and this answered one, wrongly.
 *
 * 🔒 WHY A SHARED HELPER RATHER THAN A ONE-LINE HEADER FIX. `'x-admin-token'` was written out by hand
 * in FOUR client files (`LoadBoard`, `MonitorPanels`, `AdminDashboard`, and this panel). Three had it
 * right and one did not, and nothing could tell — there was no single answer to "how does an admin
 * request authenticate?" for the wrong one to disagree with. Fixing only the typo leaves the next
 * caller exactly as free to invent a fifth spelling.
 */

/** The header name the server's `verifyAdminToken` actually reads. Never write this string elsewhere. */
export const ADMIN_TOKEN_HEADER = 'x-admin-token';

/** Where the admin session token lives. localStorage, so it survives a cold app restart. */
export const ADMIN_TOKEN_KEY = 'admin_token';

export function adminToken(storage?: Pick<Storage, 'getItem'>): string {
  try {
    const s = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    return s?.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return ''; // a blocked/absent storage is "not signed in", never a crash
  }
}

/** The headers every admin request carries. PURE. */
export function adminHeaders(token?: string): Record<string, string> {
  return { [ADMIN_TOKEN_HEADER]: token ?? adminToken() };
}

export interface AdminFetchOk<T> { ok: true; data: T }

/**
 * 🔒 A FAILURE IS ITS OWN ANSWER, never a `data` the caller can spread `?? 0` over. `status` is 0
 * when the request never reached the server at all — "we could not ask" and "the server said no" are
 * different facts, and a panel that shows the same thing for both is the bug above in a different
 * costume.
 */
export interface AdminFetchFailed { ok: false; status: number; message: string }

/** Named members rather than an inline union, so `if (r.ok)` narrows for every caller. */
export type AdminFetchResult<T> = AdminFetchOk<T> | AdminFetchFailed;

/**
 * Narrow a result to the failure branch.
 *
 * ⚠️ AN EXPLICIT TYPE PREDICATE, not a bare `if (r.ok)`. This project's frontend tsconfig does not
 * narrow the discriminated union reliably at every call site, and a caller that cannot reach
 * `message` is a caller that will reach for `data` instead — which is precisely the "an error became
 * the dashboard" bug this module exists to end. The guard makes the safe path the easy one.
 */
export function adminFailed<T>(r: AdminFetchResult<T>): r is AdminFetchFailed {
  return r.ok === false;
}

/**
 * GET an admin endpoint. NEVER throws, and never returns an error body as data.
 *
 * A 401 is named as a sign-in problem rather than a generic failure, because that is the one the
 * admin can actually act on — and it is exactly the case that rendered as zeros for a month.
 */
export async function adminGet<T>(
  url: string,
  opts?: { token?: string; fetchImpl?: typeof fetch },
): Promise<AdminFetchResult<T>> {
  const f = opts?.fetchImpl ?? (typeof fetch === 'undefined' ? null : fetch);
  if (!f) return { ok: false, status: 0, message: 'Could not load — no network client available.' };
  let res: Response;
  try {
    res = await f(url, { headers: adminHeaders(opts?.token) });
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach the server (${e instanceof Error ? e.message : String(e)}).` };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: res.status === 401
        ? 'Admin sign-in required — open the Admin console and log in, then reopen this screen.'
        : `Could not load this data (HTTP ${res.status}).`,
    };
  }
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    // A 200 we cannot parse is NOT data either — the whole point of this module.
    return { ok: false, status: res.status, message: 'The server answered with something unreadable.' };
  }
}
