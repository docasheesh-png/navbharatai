// AN UNTOUCHED SCAFFOLD IS NOT A FINISHED APP.
//
// 🔴 THE INCIDENT (autopsy 31dc61fd, 2026-09-20). Five minutes into a UPSC-app build the platform told
// the model, in its own words:
//
//     [BUILD CHECKPOINT] An automatic check of the whole project says the app is complete and healthy
//     — 100/100, no blockers. If everything the user asked for is present, STOP HERE.
//
// and narrated "✅ The app looks complete — wrapping up." to the user. The workspace at that moment,
// from the build's own `cat`:
//
//     function App() { return (<div><h1>Hello World</h1></div>); }
//
// The app was the starter template. The model DISBELIEVED the platform, ran `find src -type f`, wrote
// *"The workspace still only has the scaffold — I need to build the actual UPSC app"*, and went on to
// build it. **A model rescuing a platform signal is a red flag, not a self-heal** (CLAUDE.md, the
// 50/50 law): the next model, on the next build, may simply obey and hand over a Hello World.
//
// 🔑 WHY THE SCORE WAS 100, AND WHY THAT IS NOT A BUG IN THE SCORER. Readiness measures CODE HEALTH:
// unresolved imports, security findings, a missing entry point. A pristine scaffold has none of those.
// It is healthy. It is also empty. This is EXACTLY the class `BuildJudge.ts` already names, in a fix
// made on 2026-08-06 for the judge:
//
//     "AN EMPTY WORKSPACE IS NOT A PERFECT ONE … every analyser here treats 'no files' as 'nothing
//      wrong'. For a pure analyser given a subset that is correct; for the JUDGE, whose whole output
//      is a quality VERDICT, it is a false success of the worst kind: the emptier the app, the better
//      it scored."
//
// **The judge was fixed for it. The readiness gate — which feeds the done signal — was never hunted.**
// That is the sibling this module closes (rule 3).
//
// ⚠️ AND AN EMPTY-FILE COUNT WOULD NOT HAVE CAUGHT IT. `producingToolUses` and `hasExistingFiles` both
// said "yes, something was built": the fast lane had salvaged a real 893-line `src/index.css` into the
// workspace before dying. One real file and an untouched entry point is not an app, so the question
// this module asks is about the ENTRY, not about the count.
//
// PURE — string comparison only. No I/O, no clock, no model.

import { appTsx } from './sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

/**
 * The entry files a scaffold seeds, in the order we would look for them.
 *
 * Deliberately short. This asks one narrow question — "is the app's own front door still ours?" — and
 * a longer list would start guessing at frameworks whose scaffolds this repo does not seed.
 */
export const STARTER_ENTRY_PATHS: readonly string[] = ['src/App.tsx', 'src/App.jsx', 'App.tsx'];

/**
 * Whitespace-insensitive comparison, because that is the only difference a formatter may legitimately
 * introduce without the app having changed. Anything else — a word, an element, an import — means the
 * model touched the file, and this must then say NO.
 */
const squash = (s: string): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The exact content this repo seeds as the starter entry point. */
export const STARTER_ENTRY_CONTENT = appTsx;

/**
 * Is this file still, byte-for-byte modulo whitespace, the entry point we seeded?
 *
 * ⚠️ EXACT-MATCH ON PURPOSE, not a heuristic like "contains Hello World". A real app may legitimately
 * print the words Hello World; only a file nobody has edited is still identical to the template. The
 * cost of being wrong here is asymmetric and points the same way: a false NO costs nothing (the build
 * simply carries on as it does today), a false YES would block a finished app from being called done.
 */
export function isUntouchedStarterEntry(content: string | null | undefined): boolean {
  if (content == null) return false;
  return squash(content) === squash(STARTER_ENTRY_CONTENT);
}

/**
 * The blocker line for the readiness report, or null when the app has genuinely been built.
 *
 * 🔒 IT IS A BLOCKER, NOT A WARNING, AND THAT CHOICE IS THE FIX. `appIsDone` already refuses any
 * readiness report carrying a blocker, so routing this through the existing mechanism means the done
 * signal, the weak checkpoint and every other reader inherit it at once — rather than a fourth place
 * learning the same fact separately and drifting from the other three.
 *
 * A file that could not be read yields null: "we could not look" is not "the app is a scaffold", and
 * inventing a blocker out of an unreadable file would fail real builds on our own trouble.
 */
export function starterAppBlocker(entryContent: string | null | undefined): string | null {
  if (!isUntouchedStarterEntry(entryContent)) return null;
  return (
    'The app\'s entry point is still the starter template we seeded — nothing has been built yet. '
    + 'Health checks pass because an empty scaffold has no defects, not because the app is finished.'
  );
}
