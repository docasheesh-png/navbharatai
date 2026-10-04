/**
 * 🔴 A SCREEN THIS BUILD WROTE AND NOTHING SHOWS IS HANDED BACK ONCE (Q-202, autopsy 3f959fde, 2026-10-03).
 *
 * The build changed course: a Frontend specialist wrote a generic data analyser, then the architect
 * rebuilt the app as a lottery analyser. `DataPreview.tsx` and `AlgorithmSuggestions.tsx` were left in the
 * project, imported by nothing. Nobody can see them, they still cost a read on every later turn, and the
 * journey check read DataPreview's `<select>` as the reason the app "takes input" (that half is fixed in
 * `unreferencedComponents`, which the journey now skips).
 *
 * 🔑 THE CLASS: a build that writes a component it never wires in had no check at the end of the turn. The
 * readiness gate wires an orphaned PAGE into the router (`healOrphanPages`), but a component is not a page:
 * whether it belongs on a screen or is a leftover of an abandoned approach is a judgement, so it is handed
 * back to the model that wrote it, in the same one-time end-of-turn message as the style hand-back.
 *
 * 🔒 PRECISION FIRST — a file is named only when ALL of these hold:
 *  - THIS build wrote it (the architect's own writes and every other lane's, via the route's write set), so
 *    a file the user already had is never named;
 *  - the import graph PROVES nothing reaches it (`unreferencedComponents`: an entry exists, and every
 *    relative import resolves to a file that was read — one unresolved import and nothing is named);
 *  - it is not a test, a story, a type file or a UI-kit primitive (`/ui/` — a kit ships parts an app may
 *    not use yet);
 *  - the turn is not a project-mode module waiting for the shell (`starterExpected`): there, a component is
 *    wired in by a later module by design.
 * The model is told to wire each one in OR delete it — never to delete something the user asked for.
 *
 * Kill switch: `AGENTV3_ORPHAN_HANDBACK=off`. PURE.
 */
import { unreferencedComponents } from './journeyDerivation';

/** At most this many files in one message. */
export const MAX_ORPHANS_LISTED = 8;

export function orphanHandBackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_ORPHAN_HANDBACK ?? '').trim().toLowerCase() !== 'off';
}

/** Files that are never a screen the app should show, even when nothing imports them. */
const NEVER_A_SCREEN = /\.(?:test|spec|stories)\.[jt]sx?$|\.d\.ts$|(?:^|\/)(?:__tests__|tests?|e2e|stories)\/|(?:^|\/)ui\//i;

/**
 * The component files THIS build wrote that nothing in the app imports. `project` is the app's source as
 * read (path → content); `written` is every path this build wrote. Empty when the graph cannot prove it,
 * when the turn is a module that awaits its shell, or when the hand-back is switched off. PURE.
 */
export function orphansToHandBack(input: {
  project: Readonly<Record<string, string>>;
  written: Iterable<string>;
  starterExpected?: boolean;
  env?: NodeJS.ProcessEnv;
}): string[] {
  if (!orphanHandBackEnabled(input.env) || input.starterExpected) return [];
  const mine = new Set([...input.written].map((p) => String(p).replace(/^\.?\/+/, '')));
  if (mine.size === 0) return [];
  let unreferenced: Set<string>;
  try { unreferenced = unreferencedComponents(input.project as Record<string, string>); } catch { return []; }
  return [...unreferenced]
    .filter((p) => mine.has(p) && !NEVER_A_SCREEN.test(p))
    .sort();
}

/** The part of the end-of-turn message that names them. PURE; '' when there are none. */
export function orphanInstruction(orphans: readonly string[]): string {
  const list = [...new Set(orphans)].filter(Boolean);
  if (list.length === 0) return '';
  const shown = list.slice(0, MAX_ORPHANS_LISTED).map((p) => `- ${p}`).join('\n');
  const more = list.length > MAX_ORPHANS_LISTED ? `\n- …and ${list.length - MAX_ORPHANS_LISTED} more` : '';
  return `${list.length} file(s) you wrote in this build are imported by nothing, so the user can never see them:\n`
    + `${shown}${more}\n`
    + 'For each one: if the app needs it, import it and show it on the screen where it belongs; if it was left over '
    + 'from an approach you replaced, delete it. Never delete something the user asked for.';
}
