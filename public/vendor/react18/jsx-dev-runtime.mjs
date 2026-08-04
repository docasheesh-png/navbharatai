// react/jsx-dev-runtime facade — jsxDEV(type, props, key, isStatic, source, self): the dev-only
// extras are metadata for devtools; the element itself is the same createElement product.
const R = window.React;
if (!R) throw new Error('vendored React runtime not loaded');
export const Fragment = R.Fragment;
export function jsxDEV(type, props, key) {
  return R.createElement(type, key !== undefined ? { ...props, key } : props);
}
export default { Fragment, jsxDEV };
