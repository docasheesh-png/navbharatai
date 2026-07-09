/**
 * Interop-safe loader for the firebase-admin CJS module via dynamic import.
 *
 * THE BUG THIS KILLS (root cause of "admin-unavailable" → every token verify failed →
 * public v3.0 users blocked, 2026-07-09): under Node's ESM dynamic import of this CJS
 * package, the real module.exports lives under `.default` — the top-level `initializeApp`
 * / `apps` / `auth` / `firestore` are all `undefined`. So `(await import('firebase-admin'))
 * .initializeApp(...)` throws "initializeApp is not a function", which every caller caught
 * and turned into a silent `null` (Firestore/Auth unavailable). NOTE: statically
 * `import * as admin from 'firebase-admin'` does NOT hit this — esbuild's `__toESM` interop
 * copies the exports to the namespace top-level — which is why the store files worked and
 * only the dynamic-import call sites (auth verification, session tracker, abuse ledger,
 * webhook store) were broken.
 *
 * Fix: unwrap `.default` ONCE here so no call site can drift back to the broken pattern.
 */
export async function loadFirebaseAdmin(): Promise<typeof import('firebase-admin')> {
  const mod = (await import('firebase-admin')) as unknown as {
    default?: typeof import('firebase-admin');
  } & typeof import('firebase-admin');
  // `.default` is the real CJS module.exports (initializeApp/apps/auth/firestore/credential…);
  // fall back to `mod` for any loader (e.g. esbuild's __toESM) that already hoisted them.
  return (mod.default ?? mod) as typeof import('firebase-admin');
}
