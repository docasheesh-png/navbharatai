import type { Firestore } from 'firebase/firestore';

/**
 * Shared Firestore handle. The server bootstrap initializes Firebase and calls
 * setDb(); extracted route modules read it via getDb() instead of closing over
 * the server.ts module scope. Extracted during the Phase 1 modularization.
 *
 * getDb() may return null when Firebase is not configured — callers must guard,
 * exactly as the original monolith did (`if (!db) ...`).
 */
let _db: Firestore | null = null;

export function setDb(db: Firestore | null): void {
  _db = db;
}

export function getDb(): Firestore | null {
  return _db;
}
