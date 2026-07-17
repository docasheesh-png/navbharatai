// P1.1 — API Versioning (UPGRADE v5.0).
//
// Goal: let the HTTP API evolve without breaking existing clients, while never
// breaking a single current request. We do this purely additively:
//
//   • `/api/v1/...`  → the CANONICAL, versioned API. Internally rewritten to the
//     existing `/api/...` handlers, so EVERY current route is instantly available
//     under the versioned prefix with zero per-route changes.
//   • `/api/...`     → still fully works (unchanged behaviour), but is now a
//     DEPRECATED shim: each response carries a `Deprecation` header plus a `Link`
//     pointing to the versioned successor path, so clients can migrate at leisure.
//
// This is a single middleware mounted before route matching. It mutates `req.url`
// (the documented Express way to do an internal rewrite) — never the body, method,
// or original headers — so downstream handlers are completely unaware of the prefix.

import type { Request, Response, NextFunction } from 'express';

/** The current (and only) supported API version. Bump when introducing v2. */
export const CURRENT_API_VERSION = 'v1';

/** All versions this server understands. Versioned paths outside this set 404 naturally. */
export const SUPPORTED_API_VERSIONS = [CURRENT_API_VERSION] as const;

const VERSIONED_BASE = `/api/${CURRENT_API_VERSION}`;

/**
 * Pure helper (unit-tested): if `url` targets the versioned API (`/api/v1` or
 * `/api/v1/...`), return the internally-rewritten unversioned URL (`/api` /
 * `/api/...`), preserving any query string. Returns `null` when no rewrite applies.
 */
export function rewriteVersionedPath(url: string): string | null {
  if (url === VERSIONED_BASE) return '/api';
  if (url.startsWith(VERSIONED_BASE + '/') || url.startsWith(VERSIONED_BASE + '?')) {
    return '/api' + url.slice(VERSIONED_BASE.length);
  }
  return null;
}

/**
 * Pure helper (unit-tested): given an unversioned API path (`/api/foo`), return the
 * canonical versioned successor (`/api/v1/foo`) to advertise via the `Link` header.
 */
export function successorVersionPath(apiPath: string): string {
  // apiPath always begins with '/api'; splice the version segment in after it.
  return `/api/${CURRENT_API_VERSION}` + apiPath.slice('/api'.length);
}

/**
 * Express middleware implementing the contract above. Mount it AFTER the body
 * parser and BEFORE the SPA catch-all + route registration.
 */
export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const rewritten = rewriteVersionedPath(req.url);
  if (rewritten !== null) {
    // Versioned call → rewrite to the real handler and advertise the served version.
    req.url = rewritten;
    res.setHeader('X-API-Version', CURRENT_API_VERSION);
  } else if (req.path.startsWith('/api/')) {
    // Unversioned API call → still served, but flagged deprecated with a successor link.
    res.setHeader('X-API-Version', 'unversioned');
    res.setHeader('Deprecation', 'true');
    res.setHeader('Link', `<${successorVersionPath(req.path)}>; rel="successor-version"`);
  }
  next();
}
