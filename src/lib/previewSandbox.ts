// Sandbox tokens for previewing UNTRUSTED generated HTML (Figma/AI output, imported code) in an
// <iframe>. It critically OMITS `allow-same-origin` — that omission is what gives the iframe a unique
// opaque origin, so scripts in the previewed code cannot read the PLATFORM's cookies / localStorage
// (Firebase auth tokens) or touch the parent DOM. `allow-scripts` lets the preview actually run;
// `allow-forms`/`allow-popups` are harmless conveniences.
//
// DO NOT add `allow-same-origin` here — combined with `allow-scripts` it fully defeats the sandbox
// and re-opens the same-origin XSS this exists to prevent.
export const UNTRUSTED_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups';
