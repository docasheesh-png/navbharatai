// WORDS THAT DESCRIBE THE APP ARE NOT THE ASK (autopsy 303e8a6f, 2026-10-12).
//
// Two shapes, one module, read by every intent reader (RequestAnalyser, DialogueStateManager, the change
// classifier), so "is this a bug report?" and "is this a security change?" are answered from the same text.
//
// 1 · AN ERROR MESSAGE THE USER ASKS FOR IS A FEATURE, NOT A BUG REPORT.
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

const ERROR_FEATURE = /\b(add|adding|include|including|implement|with|plus|show|display)\s+(?:(?:an?|the|some|proper|friendly|clear|better|nice|helpful|good|user-?friendly|graceful|inline|polite)\s+)*(?:error|errors|failure)\s+(?:message|messages|handling|handler|handlers|state|states|screen|screens|page|pages|toast|toasts|banner|banners|boundary|boundaries|alert|alerts|notice|notices)\b(?:\s+with\s+an?\s+["'“”]?(?:try again|retry)["'“”]?\s+button)?(?:\s+(?:when|if|on|whenever)\s+[^.;\n]{0,50}?\b(?:fails?|failed|errors?)\b)?/gi;

/**
 * The text with every requested error-UI feature phrase removed, so a debug-word check reads only the rest. The
 * builder VERB is kept ("add …" stays "add"), so a reader that asks "is this a feature request?" still sees one.
 * PURE.
 */
export function withoutErrorFeaturePhrases(text: string): string {
  return String(text ?? '').replace(ERROR_FEATURE, ' $1 ');
}

/**
 * 2 · A THING THE APP SHOULD NOT NEED IS NOT A CHANGE TO IT. "use the free image engine that needs no API key",
 * "without login", "no backend" — the change classifier read "API key" as a SECURITY change and "login" as an
 * app-wide one. A negation directly in front of the need removes the whole phrase. "fix the api key leak" and
 * "add google login" have no negation and keep every word.
 */
const NEGATED_NEED = /\b(?:needs?\s+no|requires?\s+no|without(?:\s+(?:an?|any))?|no(?:\s+(?:an?|any))?|(?:does\s*n[o']?t|do\s*n[o']?t|doesn't|don't)\s+need(?:\s+(?:an?|any))?)\s+(?:api[ -]?keys?|keys?|secrets?|sign[ -]?(?:ins?|ups?)|log[ -]?ins?|logins|accounts?|passwords?|backend|servers?|databases?|auth(?:entication)?)\b/gi;

/** The text with every "needs no X / without X / no X" need removed. PURE. */
export function withoutNegatedNeeds(text: string): string {
  return String(text ?? '').replace(NEGATED_NEED, ' ');
}

/** Both: the requested error UI and the needs the app should not have. What is left is what is ASKED. PURE. */
export function withoutDescribedFeatures(text: string): string {
  return withoutNegatedNeeds(withoutErrorFeaturePhrases(text));
}
