// AN ERROR MESSAGE THE USER ASKS FOR IS A FEATURE, NOT A BUG REPORT (autopsy 303e8a6f, 2026-10-12).
//
// Read by the request analyser, the dialogue-phase reader and the change classifier, so "is this a bug report?" is
// answered from the same text everywhere.
//
// The first starter chip asks for "friendly error messages with a Try again button". The request analyser read
// "error" as a DEBUGGING task (score 50, the "sonnet" band, a 150-step ceiling), and the dialogue-phase reader would
// read an edit like "add a friendly error message when the upload fails" as the user reporting something broken.
//
// The shape, not the word: a builder verb in the imperative AT THE START OF A CLAUSE (add / include / implement /
// show / display) followed by an error-UI noun (message, handling, state, screen, toast, boundary…), optionally with
// the condition it is for. ⚠️ NARROWED by the adversarial review of 303e8a6f: with "with" / "plus" as verbs and no
// clause anchor, "the page loads with an error screen" and "checkout opens with an error page" — real bug reports in
// an edit — lost their debugging reading. Those keep every word now, as do "I'm getting an error message" and "it
// shows an error". PURE.
//
// ⚠️ A NEGATED NEED ("needs no API key", "without login", "no api keys") IS NOT STRIPPED ANY MORE. The same review
// measured it turning "users can open the admin page without login, fix it" and "make sure the frontend has no api
// keys in the bundle" — real access-control and security edits — into a low-risk bug and a feature: the classifier's
// expensive direction. On a new build the change classifier no longer runs at all (classifyNewApp), which is what
// the reported item needed; in an edit a descriptive "needs no key" costing a deeper review is the accepted side.

const ERROR_FEATURE = /(^|[.,;:!?\n]\s*|\b(?:and|also|please|then)\s+)(add|include|implement|show|display)\s+(?:(?:an?|the|some|proper|friendly|clear|better|nice|helpful|good|user-?friendly|graceful|inline|polite)\s+)*(?:error|errors|failure)\s+(?:message|messages|handling|handler|handlers|state|states|screen|screens|page|pages|toast|toasts|banner|banners|boundary|boundaries|alert|alerts|notice|notices)\b(?:\s+with\s+an?\s+["'“”]?(?:try again|retry)["'“”]?\s+button)?(?:\s+(?:when|if|on|whenever)\s+[^.;\n]{0,50}?\b(?:fails?|failed|errors?)\b)?/gi;

/**
 * The text with every requested error-UI feature phrase removed, so a debug-word check reads only the rest. The
 * builder VERB is kept ("add …" stays "add"), so a reader that asks "is this a feature request?" still sees one.
 * PURE.
 */
export function withoutErrorFeaturePhrases(text: string): string {
  return String(text ?? '').replace(ERROR_FEATURE, '$1$2 ');
}
