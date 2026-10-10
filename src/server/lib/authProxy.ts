// Firebase Auth helper reverse-proxy — extracted from server.ts so a unit test can prove the
// hang fix (BLD-10) without booting the whole server.
//
// An upstream error BEFORE headers is a 504 the browser can retry. An upstream error AFTER
// headers (or an error on the piped response body) must destroy `res`, or the login popup sits
// on a socket that will never end.

import type { IncomingMessage, RequestOptions } from 'node:http';
import type { ClientRequest } from 'node:http';
import { rewriteProxyHeaders } from './authProxyCookies';
import { withoutOpenerPolicy } from './securityHeaders';

export const FIREBASE_AUTH_HOST = 'gen-lang-client-0866594388.firebaseapp.com';
export const AUTH_PROXY_TIMEOUT_MS = 15000;

export interface AuthProxyRequest extends Pick<ClientRequest, 'destroy'> {
  on(event: 'timeout' | 'error', listener: (...args: any[]) => void): this;
}

export interface AuthProxyDeps {
  /** `https.request` in production. Tests pass a fake so no socket is opened. */
  request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => AuthProxyRequest;
  agent?: RequestOptions['agent'];
  hostname?: string;
  timeoutMs?: number;
}

export function createAuthProxy(deps: AuthProxyDeps) {
  const hostname = deps.hostname ?? FIREBASE_AUTH_HOST;
  const timeoutMs = deps.timeoutMs ?? AUTH_PROXY_TIMEOUT_MS;
  return function proxyFirebaseAuth(req: {
    originalUrl?: string;
    url?: string;
    method?: string;
    headers?: Record<string, unknown>;
    pipe: (dest: AuthProxyRequest, opts?: { end?: boolean }) => unknown;
  }, res: {
    headersSent: boolean;
    destroyed?: boolean;
    writeHead: (status: number, headers: Record<string, unknown>) => void;
    status: (code: number) => { end: (body?: string) => void };
    destroy: () => void;
  }): void {
    const upstream = deps.request(
      {
        hostname,
        port: 443,
        path: req.originalUrl || req.url,
        method: req.method,
        headers: { ...(req.headers || {}), host: hostname },
        agent: deps.agent,
        timeout: timeoutMs,
      },
      (pres) => {
        // 🔒 COOKIES MUST BIND TO *OUR* HOST (admin 2026-08-22 — the Apple redirect login loop).
        // The upstream sets its cookies for `*.firebaseapp.com`; arriving from navbharatai.com the
        // browser MUST reject those. See authProxyCookies. And never an opener policy of its own:
        // this page answers the window that opened it (Q-732).
        const host = String(req.headers?.host || '').split(':')[0];
        res.writeHead(pres.statusCode || 502, withoutOpenerPolicy(rewriteProxyHeaders(pres.headers as Record<string, unknown>, host)));
        pres.pipe(res, { end: true });
        // The body can fail AFTER headers. Leaving `res` open hangs the popup.
        pres.on('error', () => { res.destroy(); });
      },
    );
    // timeout fires on an idle socket (connect or response stall) — abort so the client fails fast.
    upstream.on('timeout', () => { upstream.destroy(new Error('auth proxy upstream timeout')); });
    upstream.on('error', () => {
      if (!res.headersSent) res.status(504).end('Auth proxy timeout');
      else res.destroy();
    });
    req.pipe(upstream, { end: true });
  };
}
