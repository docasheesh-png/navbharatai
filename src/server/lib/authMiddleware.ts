/**
 * P0a — Reusable Firebase ID-token verification helpers.
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
 * Used by /api/secrets/* routes (C4). Will also be used in Phase 0b for
 * /api/build, /api/build-stream, /api/engineer-chat (C3).
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
