// WHERE THE WAY BACK IS — one sentence, in the place the user already looks.
//
// 🔴 WHY (admin 2026-09-20, two instructions in one breath): *"system A ko hata do agar safe ho to.
// B hi lagao"* and *"par sabhi ko pata hona chahiye. galti hone par backup/revers kaise liya jaye!!"*
//
// NavBharatAI had TWO version systems and the Pro panel showed the weaker one as if it were the way
// back. The checkpoints in that list are real git commits **inside the sandbox**, so `/api/agentv3/
// restore` says in its own comment that it *"can offer a restore the sandbox can no longer perform"*:
// the sandbox pauses after minutes and is rebuilt from durable files, and with it the history those
// commits live in. A button that works this minute and not tomorrow is worse than no button, because
// the user only ever presses it on the day it matters.
//
// 🔒 WHAT WAS REMOVED AND WHAT WAS NOT. Only the RESTORE was removed from that list. Naming a version,
// **Preview** (open an old version running, without touching today's files) and **Compare** (what
// changed between two) are the things only git can do, they cost no extra sandbox, and none of them
// claims to bring anything back — so they stay exactly where they were.
//
// ⚠️ REMOVING A CONTROL WITHOUT NAMING ITS REPLACEMENT WOULD HAVE MADE THE ADMIN'S SECOND INSTRUCTION
// WORSE, NOT BETTER — the way back would have moved from a screen the user is already on to a tool
// three menus deep. So the removal and the sentence below ship together, and the sentence carries the
// exact navigation path rather than the word "settings".

/** Exactly where the durable, always-restorable versions live. Must match AppKnowledgeBase. */
export const TIME_MACHINE_PATH = 'Other AI → AI Tools → Versioning';

/**
 * What the History tab says above the list.
 *
 * It states the DIFFERENCE, because the two are genuinely different things and a user who does not
 * know that will press the wrong one on a bad day: these are the steps of this session (look at them,
 * compare them), and the versions you can actually go back to — from any device, however long
 * afterwards — are kept in the Time Machine.
 */
export const HISTORY_TAB_NOTE =
  `These are the steps inside this session — open one to look at it, or compare two. To go back to an earlier version of your app, use Time Machine (${TIME_MACHINE_PATH}): every build is saved there permanently and restores from any device.`;

/** The one-line answer to "I made a mistake — how do I get my app back?" */
export const HOW_TO_GO_BACK =
  `Open Time Machine (${TIME_MACHINE_PATH}), pick the version from before the change, and tap Restore. Nothing is deleted — you can come forward again.`;
