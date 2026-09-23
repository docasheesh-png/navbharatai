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

/**
 * 🔴 A BROWSER THAT RENDERED THE STARTER DID NOT RENDER THE APP (autopsy 0d297b25, 2026-09-23).
 *
 * The readiness gate above is the one place that knew, and it said so: `READINESS_BLOCKER` — *"the
 * app's entry point is still the starter template we seeded — nothing has been built yet"* — and the
 * build finished `ok: false`. Then three later passes asked a different question, *"does the preview
 * render?"*, and the answer was yes, because a Hello World page renders perfectly:
 *
 *   - `RENDER_RESCUE` upgraded the build to success *"so health, billing and the verdict are honest"*;
 *   - `VERDICT_HELD_BY_RUN` then held that success against a RED release gate, because *"a real browser
 *     rendered it"*;
 *   - `IN_BUILD_GREEN` told the user *"Your app rendered — this working version is now protected"*.
 *
 * The user asked for an APK of a project that was never in the workspace, received one Markdown file,
 * was told *"✅ Your app is built and working — you can use it right now"*, and was charged ₹47.36 of
 * their welcome balance with the full markup. **Every one of those passes was right about the page and
 * wrong about the app**, because "the preview renders" and "the app renders" are the same fact only
 * once somebody has written the app.
 *
 * So every producer of the render proof asks THIS, not a copy of it. It is the same exact-match rule
 * the readiness blocker uses — one question, one answer — so the gate and the proofs can no longer
 * disagree about the same file.
 *
 * `read` rejects for a path that does not exist; the first entry that CAN be read decides, exactly as
 * `_blockIfStillTheStarterApp` walks them. Nothing readable ⇒ `false`: "we could not look" must never
 * veto a real app's proof (the asymmetry `isUntouchedStarterEntry` is built on).
 */
export async function entryIsStillTheStarter(read: (path: string) => Promise<string>): Promise<boolean> {
  for (const path of STARTER_ENTRY_PATHS) {
    let content: string;
    try { content = await read(path); } catch { continue; }
    return isUntouchedStarterEntry(content);
  }
  return false;
}

/** The admin-only timeline code for a render that proved only the starter page. */
export const STARTER_RENDER_CODE = 'RENDERED_ONLY_THE_STARTER' as const;

/** The admin-only line recorded where a render proof was refused because the app is still the starter. */
export function starterRenderNote(where: string): {
  code: typeof STARTER_RENDER_CODE; severity: 'info'; message: string; autoResolved: false;
} {
  return {
    code: STARTER_RENDER_CODE,
    severity: 'info',
    autoResolved: false,
    message: `The preview rendered, but what rendered is the untouched starter page we seeded — not an app anybody built. `
      + `Not counted as the app working (${where}), so it cannot upgrade the verdict, earn the markup, or be protected as a working version.`,
  };
}

/**
 * The user's summary when the only thing standing between this build and "done" is that nothing was
 * built. `This app isn't fully working yet — a couple of things still need fixing` is the wrong sentence
 * for it: there is no app to be "not fully working", and "a couple of things" invents a small fix list.
 *
 * The model's own closing words are kept beneath the headline, because on a turn like 0d297b25 they are
 * the valuable part — the model had found, correctly, that the project it was asked to change was not
 * in the workspace, and the platform replaced that finding with a generic headline.
 */
export function starterSummary(modelText: string | null | undefined): string {
  const head = '⚠️ Nothing has been built yet — this project still holds only the empty starter page, so there is no app to use or preview.';
  const said = String(modelText ?? '').trim();
  if (!said) return head;
  const cap = 1_500;
  const body = said.length > cap ? `${said.slice(0, cap).replace(/\s+\S*$/, '')}…` : said;
  return `${head}\n\n${body}`;
}

/** Is this readiness blocker the "nothing has been built" one? Compared against the ONE producer. */
export function isStarterBlocker(blocker: string): boolean {
  return blocker === starterAppBlocker(STARTER_ENTRY_CONTENT);
}
