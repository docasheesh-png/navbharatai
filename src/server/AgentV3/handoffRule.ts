// AgentV3 — the ONE exception to the architect's delegation rule, and the marker that turns it on.
//
// 🔴 WHY (autopsy 121c2431, 2026-09-26; admin approved the narrow exception the same day: "architect
// wala PR banao"). Two instructions reached the architect in the same build and contradicted each other:
//
//   • the system prompt: "MANDATORY DELEGATION (no exceptions) … never write application code yourself";
//   • the fast-lane hand-off note: "READ these files first and COMPLETE the app around them … fix any
//     error in place".
//
// The architect fixed one import itself, then spent a 71-second call and 26,371 characters arguing with
// itself about which instruction it had broken, and ended its turn without a tool call. Build 2 of the
// same app delegated the same fixes to the frontend specialist and succeeded — so the rule is not
// wrong, it is incomplete. Delegating a one-line import fix costs a specialist spawn (minutes); arguing
// about it costs the build.
//
// 🔒 THE EXCEPTION IS NARROW BY CONSTRUCTION, and both halves read from here so they cannot drift:
//   • it applies only to files a faster lane already wrote — the hand-off note carries
//     `SALVAGE_HANDOFF_MARKER`, and the rule names that exact marker;
//   • only MECHANICAL errors: an import, a type or props annotation, a name collision, a path. A new
//     feature, component or page is still delegated, exactly as before.

/** Opens the build prompt when the fast lane handed finished files to the full builder. */
export const SALVAGE_HANDOFF_MARKER = '[CONTINUE — DO NOT START OVER]';

/** The system-prompt lines that grant the exception (indented to sit under the delegation rule). */
export const HANDOFF_MECHANICAL_FIX_RULE: readonly string[] = [
  `  ONE EXCEPTION — files a faster lane already wrote: when the request opens with ${SALVAGE_HANDOFF_MARKER},`,
  '  you MAY fix MECHANICAL errors in those files yourself with edit_file — a missing or wrong import, a',
  '  wrong type or props annotation, a name collision, a wrong path. Delegating a one-line fix costs minutes.',
  '  New features, new components and new pages are still delegated. Do not deliberate over this rule: if',
  '  the fix is mechanical, make it; if it is not, send it to the specialist.',
];

/** The sentence the hand-off note adds, so the note and the rule say the same thing. */
export const HANDOFF_NOTE_FIX_LINE =
  'Mechanical fixes in these files (an import, a type or props annotation, a name, a path) you make yourself with edit_file — '
  + 'that is the one exception to delegation. New features, components and pages still go to the specialists.';
