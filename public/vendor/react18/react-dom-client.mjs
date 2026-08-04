// react-dom/client facade — the UMD build carries createRoot/hydrateRoot on the same global.
const D = window.ReactDOM;
if (!D) throw new Error('vendored ReactDOM runtime not loaded');
export const { createRoot, hydrateRoot } = D;
export default { createRoot: D.createRoot, hydrateRoot: D.hydrateRoot };
