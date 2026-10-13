// AgentV3 — ADDING TO THE END OF A FILE NEEDS NO ANCHOR, and every instruction that asks for an addition
// says so up front.
//
// 🔴 WHY (autopsy 9c612cdb, 2026-10-12, Q-986). The builder was told to "add the rules to src/index.css now"
// and to extend the design kit "by APPENDING (edit_file, new rules at the end)". Nothing it could see before
// its first attempt said HOW to append: the edit_file contract read "old_string must appear exactly once",
// and the one anchor-free form — an EMPTY old_string, which `applyEdit` has appended since 2026-07-21 — was
// taught only inside failure messages. So it quoted an anchor from its compacted memory of a 538-line kit,
// missed (28.4 s and 1,952 output tokens thrown away) and resent the whole CSS on the next turn.
//
// That was the FIFTH time this class came back. Every earlier fix added the hint to one more branch of the
// failure message (no anchor, ambiguous, missing rule) — healing after the miss — and none of them told the
// first attempt. This sentence now rides the tool contract and every instruction that asks for an addition,
// so the first attempt is the right one; the failure messages keep it as the last line of defence.
// `tests/theVideoAppGuessedTheEndOfTheKit.test.ts` fails CI when a new "add rules to the stylesheet"
// instruction is written without it.
//
// A LEAF — no imports — so the tool catalog, the prompts, the write-time notes and the dispatcher can all
// read it without an import cycle.

/**
 * The one sentence that teaches the anchor-free append. It says `old_string: ""` literally, because the
 * argument repair (toolArgRepair.ts) reads an alias key such as `search` or `find` when old_string is
 * empty: the documented form is the bare empty string, with nothing beside it.
 */
export const APPEND_WITH_EMPTY_OLD_STRING =
  'To ADD content at the end of a file, call edit_file with an EMPTY old_string — it appends new_string to the '
  + 'end of the file. Send old_string: "" exactly; no anchor and no read are needed.';
