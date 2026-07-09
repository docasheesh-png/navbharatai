/**
 * Regression lock for the 2026-07-09 "admin-unavailable" root cause.
 *
 * In the PRODUCTION bundle (esbuild --format=cjs + Node's ESM dynamic import of this CJS
 * package), `await import('firebase-admin')` returns a namespace whose real exports live
 * under `.default` — top-level `initializeApp`/`apps`/`auth`/`firestore` are `undefined`, so
 * the old `(await import('firebase-admin')).initializeApp(...)` threw and every token verify
 * silently failed. loadFirebaseAdmin() unwraps `.default` so the top-level exports are always
 * callable.
 *
 * NOTE ON WHY THIS WENT UNDETECTED: under vitest (Vite's module resolution) the RAW dynamic
 * import already hoists the exports to the top level, so the broken shape does NOT reproduce
 * here — the failure only ever appeared in the production bundle. So this test does not assert
 * the raw broken shape (that is environment-specific); it locks the CONTRACT that matters:
 * loadFirebaseAdmin() always returns callable top-level exports.
 */
import { describe, it, expect } from 'vitest';
import { loadFirebaseAdmin } from './firebaseAdminModule';

describe('loadFirebaseAdmin (interop-safe firebase-admin loader)', () => {
  it('exposes the top-level CJS exports as callable functions (the exact regression)', async () => {
    const admin = await loadFirebaseAdmin();
    expect(typeof admin.initializeApp).toBe('function');
    expect(typeof admin.auth).toBe('function');
    expect(typeof admin.firestore).toBe('function');
    expect(admin.apps).toBeDefined();
  });
});
