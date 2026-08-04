// Same-origin ES-module facade over the self-hosted React 18 UMD build (loaded as a <script> before
// the preview loader). Every specifier in the preview's importmap that says "react" resolves HERE, so
// the app code AND every esm.sh package built with ?external=react share this ONE React instance —
// no CDN required for the React core, and no second-copy "Invalid hook call".
// The export list is the EXACT key set of react@18.3.1 (enumerated from the real build, not guessed).
const R = window.React;
if (!R) throw new Error('vendored React runtime not loaded'); // → the loader falls back to the CDN rungs
export default R;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  act, cloneElement, createContext, createElement, createFactory, createRef, forwardRef,
  isValidElement, lazy, memo, startTransition, unstable_act,
  useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId,
  useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef,
  useState, useSyncExternalStore, useTransition, version,
} = R;
