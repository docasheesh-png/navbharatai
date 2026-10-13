/**
 * WHERE THE CONTRACT MODULE LIVES, AND HOW A FILE IMPORTS IT — ONE IMPLEMENTATION (build report
 * 9c612cdb, 2026-10-13, Q-1026).
 *
 * 🔴 THE FAILURE. Two facts about the contract file were each written twice, in two modules that do not
 * read each other's copy:
 *
 *   • the relative import specifier — `importSpecifierFor` in `contractRenames.ts` and
 *     `contractImportSpecifier` in `SimpleBuilder.ts`, byte-identical bodies;
 *   • where the file IS — `CONTRACT_PATH_CANDIDATES` (the list the healers search) in
 *     `contractRenames.ts`, and `contractFilePath` (the path the fast lane writes) in `SimpleBuilder.ts`.
 *
 * Nothing made the second pair agree. The writer decides the path; the healer guesses it from a hand-kept
 * list. Move the contract to a third location in the writer — `app/types.ts` for a Next project, say — and
 * the healer silently finds no contract, reports no renames, and every TS2749 it exists to fix is handed
 * back to the model. No test fails: the list is still internally consistent, just no longer about reality.
 *
 * 🧬 THE CLASS. Two copies of one truth, where only one of them is the truth. This is the fourth absolute
 * rule's centralisation class — the same shape as the four drifted `safeRelPath` copies that became
 * `workspacePath.ts`, and the five hardcoded model ids that became `visionModels.ts`.
 *
 * 🔒 THE FIX IS STRUCTURAL, NOT A MERGE. The candidate list is DERIVED from the very constants
 * `contractFilePath` returns, so a new location cannot be added to the writer without appearing in the
 * search. `aContractHasOneHome.test.ts` holds that invariant (every path `contractFilePath` can return is
 * a candidate) and the census that no other module grows its own copy.
 *
 * Everything here is PURE: no I/O, no env, no clock.
 */

import { posix } from 'path';

/** The contract module's path when the app's sources are under `src/`. */
const CONTRACT_UNDER_SRC = 'src/types.ts';

/** The contract module's path when the app's sources sit at the workspace root. */
const CONTRACT_AT_ROOT = 'types.ts';

/**
 * Every path `contractFilePath` can return, most-specific first — so a reader that has only the written
 * files in hand (the heal path: `contractRenamesInSources`, the dispatcher's contract read) can find the
 * contract without being told where the writer put it. DERIVED, never hand-kept.
 */
export const CONTRACT_PATH_CANDIDATES: readonly string[] = [CONTRACT_UNDER_SRC, CONTRACT_AT_ROOT];

/** Where the contract module lives: beside the app's sources when they are under `src/`. PURE. */
export function contractFilePath(manifest: ReadonlyArray<{ path: string }>): string {
  return manifest.some((f) => f.path.startsWith('src/')) ? CONTRACT_UNDER_SRC : CONTRACT_AT_ROOT;
}

/** The relative import specifier for `contractPath` from inside `fromPath` (no extension). PURE. */
export function contractImportSpecifier(fromPath: string, contractPath: string): string {
  let rel = posix.relative(posix.dirname(fromPath), contractPath).replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}
