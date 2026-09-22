// THE BOX EMPTIES WHEN YOU PRESS SEND, AND YOUR WORDS COME BACK ONLY IF THE SEND FAILED.
//
// 🔴 THE REPORT (admin 2026-09-22, two screenshots): a free image request was pressed, the message
// bubble appeared in the thread, "NavBharatAI's engine is busy — trying again (52s)" counted down —
// and the whole brief was STILL sitting in the input box the entire time. Every chat surface in
// this app clears its box the moment a message is sent; the two image composers cleared theirs
// only on SUCCESS, which on the free tier can be a minute later. For that minute the screen said
// two contradictory things: "sent" (the bubble) and "not sent" (the box).
//
// The reason it was written that way was a real one and is KEPT: "a FAILED request keeps the words,
// because retyping a brief you already wrote is the worst possible answer to 'that did not work'".
// Clearing at send and RESTORING on failure satisfies both — the box behaves like every other box,
// and a failure still hands the words back.
//
// ⚠️ RESTORE ONLY INTO AN EMPTY BOX. If the user started typing a new brief while the old one was
// in flight, a failure of the OLD one must not overwrite the NEW words. Pure.

/** What the input should hold after a send failed: the sent words, unless the user has moved on. */
export function draftAfterFailedSend(current: string, sent: string): string {
  return String(current ?? '').trim() === '' ? String(sent ?? '') : String(current ?? '');
}
