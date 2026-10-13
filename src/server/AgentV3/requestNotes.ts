// AgentV3 — THE ONE REQUEST-NOTES LIST, AND HOW A LANE READS IT (autopsy 9c612cdb, 2026-10-12, Q-991).
//
// Every note about the REQUEST (the stack we do not build, a script asked for, a name we do not know, the
// no-login scope, a keypad phone, a property only a third party controls) is gathered into ONE list in the
// route, and every lane that plans or writes the app reads that list: the architect, the fast lane, the
// one-shot lane, the project planner, the plan-first planner and the writing sub-agents. Each note used to be
// threaded into each lane by hand, and each fix reached only the lanes its author remembered.
//
// The join lives here, not in the route, because the chat handler sits at TypeScript's control-flow limit
// (TS2563): every `notes ? … : …` written there is one more branch the checker must walk. PURE.

/** What separates one note from the next, and the notes from the prompt they open. */
export const REQUEST_NOTE_SEPARATOR = '\n\n---\n\n';

/** A prompt opened by the request notes; the prompt unchanged when there are none. PURE. */
export function withRequestNotes(prompt: string, notesText: string): string {
  return notesText ? `${notesText}${REQUEST_NOTE_SEPARATOR}${prompt}` : prompt;
}
