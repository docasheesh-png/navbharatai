// Same-origin facade over the self-hosted react-dom 18 UMD (see react.mjs for the why).
const D = window.ReactDOM;
if (!D) throw new Error('vendored ReactDOM runtime not loaded');
export default D;
export const {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  createPortal, createRoot, findDOMNode, flushSync, hydrate, hydrateRoot, render,
  unmountComponentAtNode, unstable_batchedUpdates, unstable_renderSubtreeIntoContainer, version,
} = D;
