// THE WORDS OF A USER'S MESSAGE, IN ANY SCRIPT (autopsy 15e69839, 2026-10-12).
//
// 🔴 THREE COPIES OF ONE TOKENIZER, ALL BLIND TO THE SAME NINE SCRIPTS. `buildableInput.instructionWords`,
// `unrelatedRequest.subjectStems` and `offTopicSummary.significantWords` each split a user's text on
// `/[^a-z0-9ऀ-ॿ]+/` — Latin and Devanagari kept, every other letter treated as a SEPARATOR. A Tamil request
// ("ஒரு மரத்தில் ஒரு 17 வயது பையன் …") came out as `["17"]`: too short to be worth a domain lookup, with no
// subject to compare against the app already in the workspace, and no name to check a summary against. The
// copies had each been widened for Hindi on their own, which is how the next language was missed in all three.
//
// One definition: a word is a run of letters, combining marks and digits — `\p{L}\p{M}\p{N}` — in whatever
// script the user wrote. Combining marks matter: Tamil, Telugu, Bengali and the rest write vowels as marks, and
// splitting on them would cut every word in half. Punctuation such as the Devanagari danda (।) now separates
// words, as it should. `tests/oneWordSplitterForEveryScript.test.ts` keeps the private copies from coming back.
//
// PURE.

/** Split text into words: runs of letters, marks and digits in any script, NFC-normalised. Empty runs dropped. */
export function textWords(text: string): string[] {
  return String(text ?? '').normalize('NFC').split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}
