// react/jsx-dev-runtime — a version-agnostic facade.
//
// ⚠️ WHY THIS FILE EXISTS (admin build report 2026-08-25, prompt: "ab to preview hi nahi chal raha").
// Every React-19 app's in-browser preview died with:
//
//     Error: Run src/main.tsx: (0 , _jsxDevRuntime.jsxDEV) is not a function
//
// Proven from React's own source rather than inferred — react/cjs/react-jsx-dev-runtime.production.js:
//
//     exports.Fragment = REACT_FRAGMENT_TYPE;
//     exports.jsxDEV = void 0;          // ← literally undefined
//
// We compile the preview with Babel's DEVELOPMENT JSX runtime on purpose: `jsxDEV` carries
// `_debugSource`, which is what the Visual Editor's click-to-source mapping is built on. React 19's
// entry then picks its build by NODE_ENV, a CDN serves production, and every `jsxDEV(...)` we emitted
// lands on `void 0`. React 18 never showed it because its production dev-runtime aliased jsxDEV to jsx.
//
// 🔑 IT USES `createElement` AND NOTHING ELSE, which is the whole reason this is safe. That is stable
// public API present in every build of every React version, dev or prod. The alternative — asking the
// CDN for the DEVELOPMENT bundle — would pair a dev jsx-runtime with a production React and rely on
// their internals matching, which is exactly the kind of mismatch that produces a worse and stranger
// failure than the one being fixed.
//
// This mirrors the React-18 vendored facade beside it, with one difference: React comes from the
// import map rather than a `window.React` global, because outside the React-18 vendor path there is no
// global to read.

import * as ReactNS from 'react';

const R = ReactNS && ReactNS.createElement ? ReactNS : (ReactNS && ReactNS.default) || ReactNS;

if (!R || typeof R.createElement !== 'function') {
  throw new Error('react/jsx-dev-runtime facade: React did not resolve to a module with createElement');
}

export const Fragment = R.Fragment;

/**
 * jsxDEV(type, props, key, isStaticChildren, source, self)
 *
 * The dev-only tail is metadata for devtools; the element itself is the same createElement product, so
 * it is accepted and ignored. `key` is passed through config exactly as createElement expects.
 */
export function jsxDEV(type, props, key) {
  return R.createElement(type, key !== undefined ? { ...props, key } : props);
}

// The production runtime's names, so one facade can answer for both entry points if either is mapped
// here. Same function: the new transform's jsx/jsxs differ from jsxDEV only in dev metadata.
export const jsx = jsxDEV;
export const jsxs = jsxDEV;

export default { Fragment, jsxDEV, jsx, jsxs };
