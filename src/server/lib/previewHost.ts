// UI-S1 — the preview sandbox page is only a page on the preview origin.
//
// public/preview-sandbox.html writes caller-supplied HTML into itself. On the app origin that HTML
// would share the Firebase session. The route is therefore 404 unless the request's host is the
// configured preview hostname. Unset, blank, or unparseable config is null: fail closed, the same as
// leaving the preview origin unset (docs/ops/preview-origin.md, owner decision D-2).
//
// Helmet is mounted first (server.ts). This route is registered later, just before static/Vite, so
// the header is already on the response when the gate runs. removeHeader + setHeader replaces that
// CSP with frame-ancestors for the app origins and leaves every other security header alone.
// Modern browsers prefer frame-ancestors over Helmet's X-Frame-Options when both are present.
//
// capacitor://localhost is an app origin because capacitor.config.ts sets no server.url — the native
// WebView origin is capacitor://localhost. https://localhost is the https-scheme shell.

import type { Request, Response, NextFunction } from 'express';

/** Parent origins allowed to frame the sandbox and to hand it preview HTML. Keep in lockstep with
 *  ALLOWED_PARENTS in public/preview-sandbox.html. */
export const APP_ORIGINS: readonly string[] = [
  'https://navbharatai.com',
  'https://www.navbharatai.com',
  'https://localhost',
  'http://localhost:3000',
  'http://localhost:5173',
  // No server.url in capacitor.config.ts → the real native WebView origin.
  'capacitor://localhost',
];

function firstNonEmpty(primary: string | undefined, fallback: string | undefined): string {
  const a = (primary ?? '').trim();
  if (a) return a;
  return (fallback ?? '').trim();
}

/**
 * Hostname of the preview origin, or null when it is unset / blank / not an http(s) URL.
 * PREVIEW_ORIGIN wins when it is non-empty; an invalid non-empty value does not fall through.
 * Protocol, port, and path are stripped. PURE apart from reading env.
 */
export function previewHostname(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = firstNonEmpty(env.PREVIEW_ORIGIN, env.VITE_PREVIEW_ORIGIN);
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname || null;
  } catch {
    return null;
  }
}

/**
 * Hostname from the raw Host header (port stripped), lowercased by the URL parser.
 * Not req.hostname: server.ts sets `trust proxy`, and Express then takes req.hostname from
 * X-Forwarded-Host, which the caller can supply. The browser's origin is the Host it requested.
 */
export function hostnameFromHostHeader(host: string | string[] | undefined | null): string | null {
  const raw = (Array.isArray(host) ? host[0] : host ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(`http://${raw}`).hostname || null;
  } catch {
    return null;
  }
}

/**
 * GET /preview-sandbox.html. 404 unless this request is for the preview hostname; otherwise replace
 * the CSP Helmet already set and let static/Vite serve the file.
 */
export function previewSandboxGate(req: Request, res: Response, next: NextFunction): void {
  const previewHost = previewHostname();
  const seen = (req.hostname || '').toLowerCase();
  const requested = hostnameFromHostHeader(req.headers.host);
  if (!previewHost || seen !== previewHost || requested !== previewHost) {
    res.status(404).end();
    return;
  }
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Content-Security-Policy', `frame-ancestors ${APP_ORIGINS.join(' ')}`);
  next();
}
