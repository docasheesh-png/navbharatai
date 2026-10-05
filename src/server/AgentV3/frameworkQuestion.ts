// AgentV3 — a project whose files and build setup disagree on the framework is ASKED about, not thrashed
// on (Q-144, admin-approved option (b) 2026-10-05).
//
// 🔴 AUTOPSY a4be5a05 (PROGRESS L20988). A `.svelte` source tree on a React package.json (`tsc && vite
// build`, no svelte deps): the builder spent ~18 minutes reconciling, then failed. `checkFrameworkCoherence`
// learned to DETECT it and warn the builder — but a warning leaves the choice to the model, and the model
// cannot know which of the two the user meant. Repairing it automatically means rewriting the build config
// or the sources, which can break a working app. So the turn asks the person who knows, BEFORE a file is
// written: keep the framework the files use (and fix the build setup), or switch to the one the build setup
// names (and rebuild the files). Their answer, in the next message, resumes the request they made.
//
// Asked once per mismatch per project, and never when the message itself names a framework.
// Kill switch: AGENTV3_FRAMEWORK_COHERENCE=off (the detector's own switch). PURE.

import { checkFrameworkCoherence, type FrameworkCoherence } from './ProjectImport';

/** The mismatch, judged from the file LIST and package.json alone — cheap enough for the routing step. */
export function frameworkMismatchFromListing(paths: readonly string[] | null | undefined, packageJson: string | null | undefined): FrameworkCoherence {
  const files: Record<string, string> = {};
  for (const p of paths ?? []) if (typeof p === 'string' && p) files[p] = '';
  if (typeof packageJson === 'string') files['package.json'] = packageJson;
  return checkFrameworkCoherence(files);
}

const FRAMEWORK_WORD = /\b(svelte|sveltekit|vue|nuxt|angular|react|next(?:\.?js)?|solid(?:js|-js)?|preact|vite)\b/i;

/** Does the message itself say which framework the user wants? Then there is nothing to ask. */
export function messageNamesAFramework(message: string | null | undefined): boolean {
  return FRAMEWORK_WORD.test(String(message ?? ''));
}

const OPTION_WORDS = new Set([
  '1', '2', 'one', 'two', 'first', 'second', 'keep', 'same', 'existing', 'current', 'switch', 'change', 'new',
  'pehla', 'pahla', 'dusra', 'doosra', 'purana', 'naya', 'wahi', 'vahi', 'yahi', 'rakho', 'badlo', 'option',
]);

/** Is this message an answer to the framework question (a framework named, or a short option pick)? */
export function answersFrameworkQuestion(message: string | null | undefined): boolean {
  const text = String(message ?? '');
  if (messageNamesAFramework(text)) return true;
  const words = text.toLowerCase().split(/[\s,.!?।()]+/u).filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.some((w) => OPTION_WORDS.has(w));
}

/** The memory note that says this exact mismatch was already asked about, so it is asked once. */
export function frameworkQuestionMarker(c: FrameworkCoherence): string {
  return `framework-question:${c.sourceFramework ?? '?'}->${c.packageFramework ?? '?'}`;
}

/** The chat reply's instruction: ask, in the user's language, and build nothing. */
export function frameworkQuestionSteer(c: FrameworkCoherence): string {
  return '\n\nDo NOT build or change anything in this reply. This project cannot build as it stands: its '
    + `source files are ${c.sourceFramework} (${c.evidence.join('; ')}), but its build setup (package.json) is `
    + `${c.packageFramework}. Before any file is written, ask the user ONE short question, in their language, `
    + 'with two numbered options: 1) keep ' + `${c.sourceFramework}` + ' — the framework their files already use — '
    + 'and fix the build setup to match; or 2) switch to ' + `${c.packageFramework}` + ' and rebuild the files in it. '
    + 'Say in one line that option 1 keeps their existing code. Then stop — their reply starts the work they asked for.';
}

/** The note added to the resumed request, so the builder knows what the user chose. */
export function frameworkAnswerNote(answer: string): string {
  return `[The user was asked whether to keep the framework the project's files use or switch to the one its `
    + `build setup names. Their answer: "${String(answer ?? '').trim().slice(0, 300)}". Reconcile package.json, `
    + 'the build config and the source files to that ONE framework first, verify the dev server starts, then do the request above.]';
}
