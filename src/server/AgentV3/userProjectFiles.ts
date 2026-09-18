/**
 * DOES THIS WORKSPACE HOLD THE USER'S APP, OR ONLY OUR OWN SCAFFOLD?
 *
 * 🔴 WHY (autopsy e9b25b08, 2026-09-18, and autopsy 2026-07-07 before it). The build route decides
 * whether a turn is a fresh build or an edit, and one input is `projectExists = fileCount > 0`. That
 * counts FILES, and it cannot tell the user's application from the golden scaffold the platform seeds
 * into every workspace itself.
 *
 * `"Build a search engines like google"` was consequently built as an EDIT of a four-file scaffold:
 * the user was told *"✏️ Editing your existing app (4 source files)"* about an app they had never
 * written, Software Project Mode recorded *"this turn is not a fresh build, so no plan was created"*
 * — the admin's own first test of that flag, blocked here — and the user stopped the build at 69
 * seconds having seen nothing produced. `GREEN_GUARD_NONE` confirms no working state had ever
 * existed there.
 *
 * ⚠️ THE 2026-07-07 REPORT NAMED THIS EXACT CAUSE AND IT WAS TREATED IN VOCABULARY INSTEAD. Its own
 * words, still in `IntentClassifier.ts`: *"a handful of scaffold/test files had been restored from
 * history (projectExists=true)"*. The remedy chosen then was `isExplicitCompleteBuild`, a PROMPT
 * guard — so the cause survived, and two months later a prompt one word outside that guard hit it
 * again. This is the same finding treated at the cause: in STATE, where it lives.
 *
 * 🔒 IT CANNOT ENDANGER A REAL APP. Any application a user has actually built carries files the
 * scaffold does not, so `userOwnedFileCount` is positive and every caller behaves exactly as before.
 * The only population that moves is a workspace holding nothing but our own starter files.
 *
 * 🔒 THE PATH LIST IS DERIVED, NEVER RE-LISTED. `goldenBaseFiles` is the one place the scaffold's
 * shape is decided; a second hand-maintained copy is precisely the drift this repo has paid for in
 * four `safeRelPath`s and two complex-app detectors. Adding a file to the scaffold updates this
 * automatically.
 *
 * PURE. No I/O, no clock, no env.
 */
import { goldenBaseFiles } from './goldenScaffolds/base';

/** Every path the platform's own starter project writes. Derived from its single source of truth. */
export const SCAFFOLD_PATHS: ReadonlySet<string> = new Set(
  Object.keys(goldenBaseFiles('NavBharatAI App', '')).map((p) => normalize(p)),
);

/** `./src/App.tsx`, `/src/App.tsx` and `src/App.tsx` are one file. */
function normalize(raw: string): string {
  return String(raw ?? '').trim().replace(/^\.?\/+/, '').replace(/\\/g, '/');
}

/**
 * How many of these files are the USER's, rather than the scaffold we seeded.
 *
 * ⚠️ `src/App.tsx` IS a scaffold path, and a very small app can live entirely inside it. Stated
 * plainly rather than discovered later: such a workspace reads as "no app of your own yet", so an
 * explicit build order there starts a fresh build instead of an edit. That is what the order asked
 * for, and it is the conservative direction for the case this module exists to fix — a scaffold the
 * user never wrote must never be presented to them as "your existing app".
 */
export function userOwnedFileCount(paths: readonly string[] | null | undefined): number {
  if (!Array.isArray(paths)) return 0;
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string') continue;
    const p = normalize(raw);
    if (!p || SCAFFOLD_PATHS.has(p)) continue;
    seen.add(p);
  }
  return seen.size;
}

/**
 * Has the user got an application here at all?
 *
 * 🔒 UNKNOWN MEANS YES. A listing we could not read must never be treated as an empty workspace —
 * that would be the one direction in which this change could reach a real app. `null` therefore
 * answers `true`, which is today's behaviour exactly.
 */
export function workspaceHoldsUserApp(paths: readonly string[] | null | undefined): boolean {
  if (paths === null || paths === undefined) return true;
  return userOwnedFileCount(paths) > 0;
}
