// AN ERROR MESSAGE THE USER ASKS FOR IS A FEATURE, NOT A BUG REPORT (autopsy 303e8a6f, 2026-10-12).
//
// The first starter chip asks for "friendly error messages with a Try again button". The request analyser
// read "error" as a DEBUGGING task (score 50, the "sonnet" band, a 150-step ceiling), and the dialogue-phase
// reader would read an edit like "add a friendly error message when the upload fails" as the user reporting
// something broken — and tell the builder "do not add unrelated features" while it was being asked to add one.
//
// The shape, not the word: a builder verb in the imperative (add / include / implement / with / show /
// display) followed by an error-UI noun (message, handling, state, screen, toast, boundary…), optionally with
// the condition it is for ("when the upload fails"). "I'm getting an error message", "it shows an error", "the
// app is showing an error" are NOT this shape (no imperative builder verb in front), so a real bug report
// keeps every word. PURE.

const ERROR_FEATURE = /\b(?:add|adding|include|including|implement|with|plus|show|display)\s+(?:(?:an?|the|some|proper|friendly|clear|better|nice|helpful|good|user-?friendly|graceful|inline|polite)\s+)*(?:error|errors|failure)\s+(?:message|messages|handling|handler|handlers|state|states|screen|screens|page|pages|toast|toasts|banner|banners|boundary|boundaries|alert|alerts|notice|notices)\b(?:\s+with\s+an?\s+["'“”]?(?:try again|retry)["'“”]?\s+button)?(?:\s+(?:when|if|on|whenever)\s+[^.;\n]{0,50}?\b(?:fails?|failed|errors?)\b)?/gi;

/** The text with every requested error-UI feature phrase removed, so a debug-word check reads only the rest. PURE. */
export function withoutErrorFeaturePhrases(text: string): string {
  return String(text ?? '').replace(ERROR_FEATURE, ' ');
}
