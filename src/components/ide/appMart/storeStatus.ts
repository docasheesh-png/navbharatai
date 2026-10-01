// THE STORE'S STATUS IS ACCEPTED ONLY WHEN IT IS THE STATUS — never any JSON the server happened to send.
//
// 🔴 WHY (admin's TestFlight screenshot, 2026-10-01, build 105): App Mart crashed into the error
// boundary with `undefined is not an object (evaluating 'c.missing.join')`. `GET /api/nav-store/status`
// always answers `{ acceptingUploads, missing: [...] , … }` — but the screen stored WHATEVER JSON came
// back as that status: `const data = await res.json(); if (data) setStatus(data as StoreStatus)`. The
// first guard that answers a phone with a JSON ERROR body instead (the adaptive bot guard's 429, the
// App Check 401, the global 500 `{ error: 'Internal server error' }`) made `acceptingUploads` undefined,
// so the Publish tab took the "not accepting apps" branch and read `.missing.join` off an object with
// no `missing` — and retrying could not help, because the same body came back.
//
// THE CLASS: a server body trusted as the typed success shape without `res.ok` and a shape check. The
// other cast sites in the client gate on `res.ok` (StoreBuildPanel, PerformanceAnalyzer, WebsiteCheckup);
// this one did not. `tests/anErrorBodyIsNotTheStoreStatus.test.ts` holds a census over every client
// `res.json().catch(() => null)` → `set…(data as T)` pair, so a new unchecked cast fails CI.
//
// PURE — no fetch, no React. The screen fetches; this decides what it is allowed to keep.

export interface StoreStatus {
  acceptingUploads: boolean;
  uploadFeeInr: number;
  categories: string[];
  maxSizeMb: number;
  isAdmin: boolean;
  /** Which of the two store prerequisites are still unconfigured — ALWAYS an array (empty when ready). */
  missing: string[];
}

/** The success body, field by field. Anything else — an `{ error }` body, HTML parsed to null — is not it. */
export function isStoreStatus(x: unknown): x is StoreStatus {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.acceptingUploads === 'boolean'
    && typeof o.uploadFeeInr === 'number'
    && Array.isArray(o.categories)
    && typeof o.maxSizeMb === 'number'
    && typeof o.isAdmin === 'boolean'
    && Array.isArray(o.missing);
}

export interface StoreStatusRead {
  /** The status, only when the response was a 2xx carrying the real shape. */
  status: StoreStatus | null;
  /**
   * Why the status could not be read, in words the screen can show. `null` when `status` is set. Carries
   * the server's own `error` sentence when it sent one (that sentence is what names the real trigger —
   * a bot-guard 429, an App Check 401 — on the user's screen instead of in a stack trace).
   */
  problem: string | null;
}

/**
 * Decide what a `/api/nav-store/status` response is allowed to become.
 *
 * `ok` is `res.ok`; `body` is `res.json()` or `null` when it could not be parsed; `httpStatus` is used
 * only to say something honest when the body carries no sentence of its own.
 */
export function readStoreStatus(ok: boolean, body: unknown, httpStatus?: number): StoreStatusRead {
  if (ok && isStoreStatus(body)) return { status: body, problem: null };
  const sentence = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error.trim()
    : '';
  if (sentence) return { status: null, problem: sentence };
  if (!ok) return { status: null, problem: `the server answered HTTP ${httpStatus ?? 'error'} instead of the store status` };
  return { status: null, problem: 'the server answered something that is not the store status' };
}
