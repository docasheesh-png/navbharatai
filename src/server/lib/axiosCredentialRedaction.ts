// No credential ever survives inside an HTTP error object (forensic audit 2026-10-04, P1).
//
// 🔴 WHY. `console.warn('Failed to fetch blob …', err)` in routes/github.ts printed a whole AxiosError, and
// `util.inspect` of one includes `config.headers.Authorization` and the raw request (`_header`) — the
// user's repo+workflow GitHub token, in the Cloud Run log, up to 200 times per import. The same shape sat
// in routes/cloudsync.ts. Fixing the two call sites fixes the two call sites; the CLASS is "an HTTP error
// carries the credential that made the request", and it is closed here, once, for every request the
// server's axios makes: a rejected response has its credential headers replaced before any caller can
// log, rethrow or serialise it. Nothing in the server reuses a failed request's config (no axios-retry),
// so the redaction changes what is printed, never what is sent.

import axios, { type AxiosInstance } from 'axios';

const SENSITIVE_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-goog-api-key|x-client-secret|x-client-id|x-admin-token|x-github-token)$/i;
const REDACTED = '[redacted]';

function redactHeaderBag(h: unknown): void {
  if (!h || typeof h !== 'object') return;
  const bag = h as Record<string, unknown>;
  for (const k of Object.keys(bag)) if (SENSITIVE_HEADER.test(k)) bag[k] = REDACTED;
  // AxiosHeaders keeps a normalised copy too; `set` updates it when present.
  const setter = (bag as { set?: (k: string, v: string) => void }).set;
  if (typeof setter === 'function') {
    for (const k of ['Authorization', 'Proxy-Authorization', 'Cookie', 'X-Api-Key', 'X-Client-Secret', 'X-Client-Id', 'X-Admin-Token']) {
      try { if ((bag as { has?: (k: string) => boolean }).has?.(k)) setter.call(bag, k, REDACTED); } catch { /* best-effort */ }
    }
  }
}

/** The raw request line block Node keeps on a ClientRequest (`_header`): credential lines rewritten. */
function redactRawRequest(req: unknown): void {
  if (!req || typeof req !== 'object') return;
  const r = req as { _header?: unknown };
  if (typeof r._header === 'string') {
    r._header = r._header.replace(/^((?:authorization|proxy-authorization|cookie|x-api-key|x-client-secret|x-client-id|x-admin-token|x-github-token)\s*:).*$/gim, `$1 ${REDACTED}`);
  }
}

/**
 * Strip every credential an HTTP error object carries. Mutates and returns the same object.
 *
 * Not just `config.headers`: the request objects hanging off the error keep their OWN copies — Node's
 * `_header` block, follow-redirects' `_options.headers`, the current request's headers — and
 * `util.inspect` prints them all. So this walks the error's enumerable graph (what `inspect` prints),
 * bounded in depth and size, and rewrites every credential-named header it meets.
 */
export function redactHttpErrorCredentials<T>(err: T): T {
  if (!err || typeof err !== 'object') return err;
  const seen = new Set<object>();
  let budget = 5000;
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object' || depth > 10 || budget-- <= 0) return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Buffer.isBuffer(node) || ArrayBuffer.isView(node)) return;
    redactHeaderBag(node);
    redactRawRequest(node);
    // String keys AND symbol keys: Node's ClientRequest keeps its outgoing headers under a symbol
    // (`kOutHeaders`) as `{ authorization: ['Authorization', 'token …'] }`, and inspect prints it.
    let keys: Array<string | symbol> = [];
    try { keys = [...Object.keys(node as object), ...Object.getOwnPropertySymbols(node as object)]; } catch { return; }
    for (const k of keys) {
      let v: unknown;
      try { v = (node as Record<string | symbol, unknown>)[k]; } catch { continue; }
      const name = typeof k === 'string' ? k : '';
      if (typeof v === 'string' && name && SENSITIVE_HEADER.test(name)) {
        try { (node as Record<string, unknown>)[name] = REDACTED; } catch { /* frozen */ }
      } else if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && SENSITIVE_HEADER.test(v[0])) {
        try { v[1] = REDACTED; } catch { /* frozen */ }
      } else if (v && typeof v === 'object') {
        walk(v, depth + 1);
      }
    }
  };
  try {
    const e = err as unknown as { config?: { auth?: unknown } };
    if (e.config && e.config.auth) e.config.auth = REDACTED;
    walk(err, 0);
  } catch { /* redaction must never replace the real error */ }
  return err;
}

const INSTALLED = Symbol.for('nb.axiosCredentialRedaction');

/** Install the redaction on an axios instance (default: the shared one). Idempotent. */
export function installAxiosCredentialRedaction(instance: AxiosInstance = axios): void {
  const flagged = instance as unknown as Record<symbol, boolean>;
  if (flagged[INSTALLED]) return;
  flagged[INSTALLED] = true;
  instance.interceptors.response.use(
    (r) => r,
    (err) => Promise.reject(redactHttpErrorCredentials(err)),
  );
}

// Installed on import: any module that imports this file protects the shared instance for the process.
installAxiosCredentialRedaction();
