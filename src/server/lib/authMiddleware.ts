/**
 * P0a/P0b — Reusable Firebase ID-token verification + rate-limiting helpers.
 *
 * verifyFirebaseToken(req) — resolves to the decoded token's uid, or null if
 *   no/invalid Bearer token is provided. Best-effort: never throws.
 *
 * requireUserMatch(paramName) — Express middleware that:
 *   1. Reads Authorization: Bearer <idToken>
 *   2. Verifies with firebase-admin (skipped in VITEST)
 *   3. Asserts decoded uid === req.params[paramName]
 *   Returns 401 (missing/invalid token) or 403 (uid mismatch).
 *
 * buildRateLimiter() — Express middleware for hot build endpoints:
 *   - Authenticated users (valid Bearer token): 10 builds per hour
 *   - Anonymous (no token): 5 builds per hour (keyed by IP)
 *   Returns 429 when over limit. VITEST-skipped.
 */
import type { Request, Response, NextFunction } from 'express';

async function getAdminAuth(): Promise<import('firebase-admin/auth').Auth | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await import('firebase-admin');
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return admin.auth();
  } catch {
    return null;
  }
}

export async function verifyFirebaseToken(req: Request): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * Like verifyFirebaseToken, but returns the VERIFIED uid AND email from the decoded token (or null
 * when no valid Bearer token). Use this where the email also drives an authorization decision (e.g.
 * an allowlist) so the check can't be spoofed by a client-supplied `email` body field.
 */
export async function verifyFirebaseIdentity(req: Request): Promise<{ uid: string; email: string | null } | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, email: typeof decoded.email === 'string' ? decoded.email : null };
  } catch {
    return null;
  }
}

export function requireUserMatch(paramName = 'userId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // VITEST: skip auth checks entirely
    if (process.env.VITEST) { next(); return; }

    const uid = await verifyFirebaseToken(req);
    if (!uid) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (uid !== req.params[paramName]) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    next();
  };
}

// In-memory rate-limit buckets — keyed by "<bucketName>:<uid|IP>" so DIFFERENT
// limiters (build vs workspace) never share a counter for the same user. Map is
// periodically self-pruning to prevent unbounded growth.
const _rateBuckets = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface RateLimitOptions {
  /** Namespace so each limiter has its own counters (e.g. 'build', 'workspace'). */
  name: string;
  /** Max requests per hour for an authenticated user. */
  authed: number;
  /** Max requests per hour for an anonymous caller (keyed by IP). */
  anon: number;
  /** Noun shown in the 429 message (e.g. 'builds', 'requests'). Default 'requests'. */
  noun?: string;
}

/**
 * Generic per-hour rate limiter. Authenticated callers (valid Bearer token) are keyed
 * by uid and get the `authed` limit; anonymous callers are keyed by IP and get the
 * `anon` limit. VITEST-skipped. Returns 429 when over the limit.
 */
export function rateLimiter(opts: RateLimitOptions) {
  const noun = opts.noun ?? 'requests';
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }

    const uid = await verifyFirebaseToken(req);
    const key = `${opts.name}:${uid ?? (req.ip || 'anon')}`;
    const limit = uid ? opts.authed : opts.anon;
    const now = Date.now();

    // Self-prune when the map gets large (evict windows that have expired).
    if (_rateBuckets.size > 5000) {
      for (const [k, v] of _rateBuckets) {
        if (now - v.windowStart > RATE_WINDOW_MS) _rateBuckets.delete(k);
      }
    }

    const bucket = _rateBuckets.get(key);
    if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
      _rateBuckets.set(key, { count: 1, windowStart: now });
      next();
      return;
    }
    if (bucket.count >= limit) {
      res.status(429).json({ error: `Rate limit exceeded: max ${limit} ${noun} per hour. Try again later.` });
      return;
    }
    bucket.count++;
    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P-SEC.1 — RBAC (Role-Based Access Control)
// Roles live in Firestore `users/{uid}.role`. CRITICAL backward-compat rule: a user
// with NO role set defaults to `owner` (full access), so this is purely additive —
// no existing single-user account is ever locked out. Granularity only kicks in once
// a role is explicitly assigned (e.g. team members get `editor`/`viewer`).
// ─────────────────────────────────────────────────────────────────────────────
export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer' | 'billing_only';

/** Higher rank = more privilege. `billing_only` is a side-grant (billing actions), low general rank. */
export const ROLE_RANK: Record<UserRole, number> = { viewer: 1, billing_only: 1, editor: 2, admin: 3, owner: 4 };

/** Pure, testable access decision. owner/admin are superusers (always allowed). */
export function isRoleAllowed(role: UserRole, allowed: UserRole[]): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return allowed.includes(role);
}

async function getAdminFirestore(): Promise<import('firebase-admin/firestore').Firestore | null> {
  if (process.env.VITEST) return null;
  try {
    const admin = await import('firebase-admin');
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return admin.firestore();
  } catch {
    return null;
  }
}

/** Read a user's role from Firestore. Defaults to `owner` (backward-compatible) when unset/unreadable. */
export async function getUserRole(uid: string): Promise<UserRole> {
  if (process.env.VITEST) return 'owner';
  try {
    const db = await getAdminFirestore();
    if (!db) return 'owner';
    const snap = await db.collection('users').doc(uid).get();
    const role = snap.exists ? (snap.data()?.role as UserRole | undefined) : undefined;
    return role && ROLE_RANK[role] ? role : 'owner';
  } catch {
    return 'owner';
  }
}

/** Assign a user's role (admin/owner operation). Best-effort; throws only on hard Firestore error. */
export async function setUserRole(uid: string, role: UserRole): Promise<void> {
  if (process.env.VITEST) return;
  const db = await getAdminFirestore();
  if (!db) return;
  await db.collection('users').doc(uid).set({ role }, { merge: true });
}

/**
 * Express middleware: require the authenticated user to hold one of `allowed` roles
 * (owner/admin always pass). 401 if unauthenticated, 403 if role insufficient.
 * VITEST-skipped. Attaches the resolved role to `req.userRole`.
 */
export function requireRole(...allowed: UserRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Authentication required.' }); return; }
    const role = await getUserRole(uid);
    if (!isRoleAllowed(role, allowed)) {
      res.status(403).json({ error: 'Forbidden: insufficient role for this action.' });
      return;
    }
    (req as Request & { userRole?: UserRole }).userRole = role;
    next();
  };
}

/** Hot build endpoint (`/chat`): 10 builds/hr authed, 5/hr anonymous. */
export function buildRateLimiter() {
  return rateLimiter({ name: 'build', authed: 10, anon: 5, noun: 'builds' });
}

/**
 * Workspace endpoints (`/restore`, `/import-files`, `/inbrowser-preview`, `/workspace-files`):
 * cheaper than a full build but still hit the sandbox / Firestore, so they get a more generous
 * but real ceiling — 60/hr authed, 30/hr anonymous — to stop abuse/hammering.
 */
export function workspaceRateLimiter() {
  return rateLimiter({ name: 'workspace', authed: 60, anon: 30, noun: 'requests' });
}

/**
 * P-SEC.13 — Device binding for sensitive operations. Records the caller's device fingerprint
 * (hashed UA + IP) against the user and DETECTS anomalies. Non-blocking by design (a UA bump or
 * mobile IP change must never lock a real user out — see sessionTracker.ts): on a first-seen
 * device it audits the access and sets an honest `X-Device-New: true` response header that the
 * client can surface, then lets the request proceed. Must run AFTER an auth middleware that has
 * established the uid (e.g. `requireUserMatch`). VITEST/DB-outage safe — degrades to a no-op.
 */
export function trackDevice(paramName = 'userId') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.VITEST) { next(); return; }
    try {
      const uid = req.params[paramName] || (await verifyFirebaseToken(req));
      if (uid) {
        const { recordAndEvaluateDevice } = await import('./sessionTracker');
        const evaluation = await recordAndEvaluateDevice(
          uid, req.headers['user-agent'] as string | undefined, req.ip, new Date().toISOString(),
        );
        if (evaluation.risk === 'high') {
          res.setHeader('X-Device-New', 'true');
          const { audit } = await import('./audit');
          audit('SENSITIVE_ACCESS_NEW_DEVICE', { uid, ip: req.ip, path: req.path }, 'warn');
        }
      }
    } catch (err) {
      // Never let device tracking break a legitimate request.
      console.error('[trackDevice] non-fatal:', err);
    }
    next();
  };
}
