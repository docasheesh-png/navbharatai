// A FAULT IN NAVBHARATAI'S OWN PREVIEW IS NEVER HANDED TO THE AI AS THE USER'S BUG
// (autopsy "Lekhan Sahyak", 2026-09-27).
//
// The in-browser preview is OUR renderer: it downloads React from a CDN, compiles the app in the
// browser and runs it. When that machinery fails — a CDN that will not serve one consistent React,
// for instance — the resulting crash looks exactly like an app crash, and the preview used to put a
// "Fix with AI" button under it. That button starts a paid build whose instructions say "find the
// cause in the project files". The cause was never in the project files, so the engine either
// invented a change (a `vite.config.ts` alias that fixed nothing) or honestly found nothing. The user
// paid either way: five builds and ₹208 in the report that found this.
//
// So a fault the preview KNOWS is its own carries this marker, written once here and read by both
// sides: the page (server-rendered, `ReactPreview.ts`) prefixes the message with it, and the panel
// (`previewConsole.ts`) refuses to offer a paid repair for a row that carries it. One string, so the
// two cannot drift — the same contract `platformFixRequest.ts` already uses for our own prompts.
//
// PURE. No I/O. Imported by the server-rendered page source and the client alike.

/** The opening words of every preview fault that is ours, not the app's. Matched, not merely shown. */
export const PREVIEW_PLATFORM_FAULT_PREFIX = 'NavBharatAI preview problem (not your app):';

/** The message for a React the preview could not load as one copy. Branded; names no vendor. */
export const REACT_SPLIT_FAULT_MESSAGE =
  `${PREVIEW_PLATFORM_FAULT_PREFIX} the quick preview could not load one consistent copy of React, so it did not start your app. ` +
  'Your files are not the cause and nothing in them needs changing. Tap reload (↻) to try again, or open the Live preview, which runs your app on its own server.';

/** Did the preview itself say this fault is ours? PURE. */
export function isPreviewPlatformFault(text: string | null | undefined): boolean {
  return String(text ?? '').includes(PREVIEW_PLATFORM_FAULT_PREFIX);
}
