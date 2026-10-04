/**
 * A CommonJS `require()` of a package that moved to ESM-only no longer returns the thing it exports —
 * it returns the module NAMESPACE, with the real export under `default` (Node 22's `require(esm)`).
 *
 * 🔴 WHY THIS EXISTS (#3501, 2026-10-04): `zip-stream` 7 became ESM-only (`"type": "module"`). The
 * server bundle keeps packages external (`esbuild --packages=external`), so `routes/zip.ts`'s
 * `const ZipStream = require('zip-stream'); new ZipStream(...)` received `{ __esModule, default }` and
 * every `/api/download-zip` call died with "m is not a constructor" — while `tsc` and the suite stayed
 * green, because nothing exercised the require at runtime. `firebaseAdminModule.ts` had already met the
 * same shape for `firebase-admin` and resolved it inline; this is that rule, once, for every caller.
 *
 * PURE. A function or class is returned as-is; a namespace yields its `default`; anything else is
 * returned unchanged so a caller's own error names the real problem.
 */
export function interopDefault<T>(mod: unknown): T {
  if (mod && typeof mod === 'object' && 'default' in (mod as Record<string, unknown>)) {
    const d = (mod as { default?: unknown }).default;
    if (d !== undefined && d !== null) return d as T;
  }
  return mod as T;
}
