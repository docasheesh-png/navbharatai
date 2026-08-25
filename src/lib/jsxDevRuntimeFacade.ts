// Where the preview's `react/jsx-dev-runtime` comes from.
//
// ⚠️ NOT THE CDN, and that is the fix (admin build report 2026-08-25 — "ab to preview hi nahi chal
// raha"). Every React-19 app's in-browser preview died with
//
//     Error: Run src/main.tsx: (0 , _jsxDevRuntime.jsxDEV) is not a function
//
// proven from React's own source rather than inferred:
//
//     // react/cjs/react-jsx-dev-runtime.production.js
//     exports.Fragment = REACT_FRAGMENT_TYPE;
//     exports.jsxDEV = void 0;          // ← literally undefined
//
// We compile the preview with Babel's DEVELOPMENT JSX runtime on purpose — `jsxDEV` carries
// `_debugSource`, which the Visual Editor's click-to-source mapping is built on. React 19's entry then
// picks its build from NODE_ENV, a CDN serves production, and every `jsxDEV(...)` we emitted lands on
// `void 0`. React 18 hid this for years because ITS production dev-runtime aliased jsxDEV to jsx.
//
// THE DECISION LIVES HERE, ONCE, because the mapping is built in three separate places (the client
// preview, the /preview route, and the server-rendered React preview) and three copies of a URL is how
// two of them get fixed and the third does not.
//
// PURE.

/** The facade shipped from our own origin. Same file for every React version. */
export const JSX_DEV_RUNTIME_PATH = '/vendor/jsx-dev-runtime.mjs';

/**
 * The importmap value for `react/jsx-dev-runtime`.
 *
 * Absolute when the caller knows its origin (the preview runs in an iframe whose base is not ours), and
 * root-relative otherwise — the same shape every other self-hosted asset here uses.
 */
export function jsxDevRuntimeUrl(origin?: string): string {
  const o = String(origin ?? '').trim().replace(/\/$/, '');
  return o ? `${o}${JSX_DEV_RUNTIME_PATH}` : JSX_DEV_RUNTIME_PATH;
}
