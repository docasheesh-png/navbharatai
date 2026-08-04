// react/jsx-runtime facade over the UMD React, built ONLY on the public createElement API (never on
// element internals like $$typeof — those shift between React versions). The automatic-runtime
// contract is jsx(type, props, key) where props.children is ALREADY set; createElement(type, config)
// with no child args keeps config.children as the children and extracts key from config — exactly
// the same element. jsxs (static children arrays) is identical for createElement's semantics.
const R = window.React;
if (!R) throw new Error('vendored React runtime not loaded');
export const Fragment = R.Fragment;
export function jsx(type, props, key) {
  return R.createElement(type, key !== undefined ? { ...props, key } : props);
}
export const jsxs = jsx;
export default { Fragment, jsx, jsxs };
