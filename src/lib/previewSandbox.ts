// Sandbox tokens for previewing UNTRUSTED generated HTML (Figma/AI output, imported code) in an
// <iframe>. It critically OMITS `allow-same-origin` — that omission is what gives the iframe a unique
// opaque origin, so scripts in the previewed code cannot read the PLATFORM's cookies / localStorage
// (Firebase auth tokens) or touch the parent DOM. `allow-scripts` lets the preview actually run;
// `allow-forms`/`allow-popups` are harmless conveniences.
//
// DO NOT add `allow-same-origin` here — combined with `allow-scripts` it fully defeats the sandbox
// and re-opens the same-origin XSS this exists to prevent.
//
// `allow-pointer-lock` (2026-11-27, admin choice "A"): a 3D game in the preview captures the mouse on a click, the way a PC
// game does, and Esc frees it. Without the token the browser refuses every lock, and the kit then turned the camera on every
// plain cursor move — the whole frame swung while the user only moved toward a button. It grants no origin and no data.
export const UNTRUSTED_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups allow-pointer-lock';

/**
 * The sandbox for a preview whose page lives on ANOTHER origin (the cloud sandbox's own URL), so same-origin there is that
 * origin, never ours. The one list every such frame uses — a frame with its own copy of the string is how a token went
 * missing in one place and not another.
 */
export const LIVE_PREVIEW_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock';
