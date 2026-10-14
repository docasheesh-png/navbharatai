/**
 * WHY THE STARTER UNIT-TEST PASS WROTE NOTHING — said in the report, never left silent (autopsy 9c612cdb).
 *
 * 🔴 THE PASS WAS DEAD ON THE DEFAULT STARTER, AND NOTHING SAID SO. P-AI.7 (routes/agentv3.ts) writes Vitest
 * starter tests after a successful build, but only where `vitest` is declared (`testSkeletonsCanRun`, autopsy
 * eed79815 / #3331). The default vite-react starter declares no test runner, so since 2026-09-26 the pass has
 * written nothing on an ordinary build — and recorded nothing either. Its sibling, the end-to-end scaffold, has
 * always recorded `E2E_SCAFFOLD_SKIPPED` with a reason ("a silent skip cannot be told from a broken skip"); this
 * pass did not, while `AppKnowledgeBase.ts` told every AI that a starter test skeleton lands BY DEFAULT. A pass
 * advertised as running by default that skips without a word is the class this module closes.
 *
 * Report 9c612cdb is the real case: a green React app on the default starter, "No tests at all" in the
 * readiness gate, and no line anywhere saying why the platform's own starter-test pass added none.
 *
 * The reason is DERIVED from the same facts the pass decided on (the project's package.json, the build-safety
 * verdict, what was planned and what was written), so it cannot drift from the decision it explains. PURE.
 */
import { testSkeletonsCanRun } from './TestGenerationAgent';

/** The reason recorded when the project declares no test runner — the default starter's case. */
export const STARTER_TESTS_NEED_VITEST = 'vitest is not declared in package.json';

/**
 * 🔴 A REASON MUST NAME SOMETHING THAT EXISTS (Q-1034's sibling, Q-1032).
 *
 * `testSkeletonsCanRun` answers false for TWO different worlds: a package.json that declares no
 * vitest, and NO PACKAGE.JSON AT ALL (`JSON.parse(String(null))` throws into its `catch`). Both were
 * reported as *"vitest is not declared in package.json"* — a sentence about a file that does not
 * exist, which sends a reader to add a dependency to nothing. A false reason is worse than a vague
 * one: it is actionable in the wrong direction.
 *
 * The two are not merged into one vague line either, because the fixes differ: one project needs a
 * dependency, the other needs a package.json before that question can be asked.
 */
export const STARTER_TESTS_NO_PACKAGE_JSON = 'no package.json was read for this project, so no test runner could be declared';

/** Present, but not valid JSON — a third world, and the one where the file itself is the problem. */
export const STARTER_TESTS_PACKAGE_JSON_UNREADABLE = "this project's package.json could not be read as JSON";

/** Is there any package.json text in hand at all? PURE. */
function hasPackageJsonText(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.trim() !== '';
}

/** Does the text in hand parse as JSON? PURE. */
function packageJsonParses(text: string): boolean {
  try { JSON.parse(text); return true; } catch { return false; }
}

export interface StarterTestsOutcome {
  /** The package.json text the pass read (null when there was none, or it could not be read). */
  packageJson: string | null | undefined;
  /** The pass's own verdict: the skeletons can run AND cannot break the app's release build. */
  skeletonsSafe: boolean;
  /** How many starter tests the pass planned. */
  planned: number;
  /** How many it actually wrote. */
  written: number;
}

/**
 * Why the pass added no starter test, or null when it added at least one. The order is the pass's own order
 * of decisions, so the FIRST thing that stopped it is the one named. PURE.
 */
export function starterTestsSkipReason(o: StarterTestsOutcome): string | null {
  if (o.written > 0) return null;
  // Q-1032: the three worlds `testSkeletonsCanRun` collapses into one `false`, told apart — so the
  // reason names something that exists and points at the fix this project actually needs.
  if (!hasPackageJsonText(o.packageJson)) return STARTER_TESTS_NO_PACKAGE_JSON;
  if (!packageJsonParses(o.packageJson as string)) return STARTER_TESTS_PACKAGE_JSON_UNREADABLE;
  if (!testSkeletonsCanRun(o.packageJson)) return STARTER_TESTS_NEED_VITEST;
  // `testSkeletonsCannotBreakTheBuild` says yes whenever vitest resolves, so this is reached only if that
  // rule changes — named rather than left to fall through to a reason that would then be false.
  if (!o.skeletonsSafe) return "the app's production build would type-check them";
  if (o.planned <= 0) return 'none of the files this build wrote exports a function that is not already tested';
  return `none of the ${o.planned} planned test file(s) could be written`;
}

/** The report line for a skip. Admin-facing; names no vendor. PURE. */
export function starterTestsSkippedNote(reason: string): string {
  return `No starter unit tests were added — ${reason}.`;
}
