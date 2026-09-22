// RUN THE BUILD GITHUB WILL RUN — here, first, in the sandbox the app is already living in.
//
// 🔴 WHY (admin 2026-09-22: *"NavBharatAI ka user jab apni app ka APK banata hai to 80% baar fail hoti
// hai aur theek nahi hoti"*). `mobileShipPreflight` already refuses to push an app that cannot parse,
// whose local imports do not resolve, or whose packages are undeclared — and its own header says the
// worst place to find a compile error is a GitHub runner. But the three checks it makes are all
// STATIC. The thing GitHub actually does — `npm run build`, the app's own script — was never run
// anywhere before the push, so the first execution of a generated app's real build was five minutes
// into a remote run that costs one of the user's three repair attempts.
//
// The app is ALREADY ALIVE in a sandbox with its dependencies installed, because that is where it was
// built and previewed seconds ago. Running the same command there is the same question asked in the
// cheap place instead of the expensive one.
//
// 🔒 THREE RULES THAT KEEP IT FROM COSTING MORE THAN IT SAVES:
//
//  1. **It NEVER starts a machine.** `hasLiveSandbox` is an in-memory map lookup; if no sandbox for
//     this workspace is warm in this process, the check is SKIPPED and the ship proceeds exactly as it
//     does today. A pre-flight that woke a billable VM would be the most expensive step in the ship.
//  2. **It is bounded.** A build that has not answered inside the budget is abandoned and reported as
//     "could not tell" — never as a failure. We are adding certainty, not a new way to be blocked.
//  3. **It is NOT stricter than the runner.** The generated workflow packages straight from the
//     bundler when only TYPE findings stopped the strict script (`WEB_BUILD_STEP`), so a `tsc` error
//     is not a ship blocker there and must not be one here. That judgement is `classifyBuildFailure`'s
//     — the SAME classifier the remote repair loop uses — never a second copy of the rule. Being
//     stricter than the thing we are predicting would refuse apps that really do build.

import { classifyBuildFailure } from './mobileBuildRepair';
import { detectProjectKind } from './mobileProjectAssembler';
import { envFlag } from './envFlag';

/** Kill switch. Unset means ON: the check makes the ship cheaper, so it is the default. */
export function realBuildCheckEnabled(): boolean {
  return envFlag('MOBILE_SHIP_REAL_BUILD', true);
}

/** How long the real build may take before we stop waiting and report "could not tell". */
export function realBuildBudgetMs(): number {
  const raw = Number(process.env.MOBILE_SHIP_REAL_BUILD_MS);
  // A malformed value takes the default, never "no limit" — the unbounded direction is the bug.
  if (!Number.isFinite(raw) || raw < 10_000) return 180_000;
  return Math.min(raw, 600_000);
}

export type RealBuildSkip =
  | 'flag-off'
  | 'no-sandbox'
  | 'static-app'
  | 'timed-out'
  | 'unavailable';

export type RealBuildVerdict =
  /** The check did not run. The ship proceeds exactly as it would have without it. */
  | { ran: false; reason: RealBuildSkip }
  /** It ran and the app's own build succeeded — the strongest evidence a push can carry. */
  | { ran: true; ok: true }
  /**
   * It ran and the build failed. `blocking` says whether the GitHub runner would ALSO have failed:
   * a type-only failure is rescued there by the workflow's bundler fallback, so it is reported and
   * not acted on.
   */
  | { ran: true; ok: false; blocking: boolean; code: string; summary: string; log: string };

/**
 * The classes a real-build failure can carry that the GENERATED WORKFLOW already rescues by itself.
 *
 * ⚠️ Keep this narrow and justified per entry. Every other failure of the app's own build script is a
 * failure the runner will meet too, and pushing into it spends five minutes and one of three attempts
 * to learn what we already know.
 */
const RESCUED_BY_THE_WORKFLOW: ReadonlySet<string> = new Set([
  // `WEB_BUILD_STEP` re-runs the bundler directly when only `error TS…` stopped the strict script, so
  // the app is packaged exactly as the preview showed it and the findings are a warning.
  'TYPE_GATE_BLOCKED_PACKAGING',
]);

/**
 * Read a failed real build. PURE — the classifier does the naming, this only decides who acts.
 *
 * The log comes from OUR sandbox, so it carries no `NBAI_FAILED_STAGE` marker; `classifyBuildFailure`
 * treats an absent marker as "stage unknown", which is the branch its type-gate rule already allows.
 */
export function readRealBuildFailure(log: string): { blocking: boolean; code: string; summary: string } {
  const diag = classifyBuildFailure(String(log || ''), '.github/workflows/android-apk.yml');
  return {
    blocking: !RESCUED_BY_THE_WORKFLOW.has(diag.code),
    code: diag.code,
    summary: diag.summary,
  };
}

/** Just enough of the actuator for this check — so a test needs no sandbox and no E2B key. */
export interface RealBuildActuator {
  hasLiveSandbox?(workspaceId: string): boolean;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  build(workspaceId: string): Promise<{ success: boolean; logs: string }>;
}

/**
 * Run the app's own build in the warm sandbox, bounded, and say what it means.
 *
 * `changed` is the pre-flight's healed files — the sandbox already holds everything else, because that
 * is where the app was built. Writing only what changed keeps this to a handful of small writes rather
 * than a whole-project upload.
 */
export async function runRealBuildCheck(
  actuator: RealBuildActuator | null | undefined,
  workspaceId: string,
  files: Record<string, string>,
  changed: Record<string, string> = {},
  budgetMs: number = realBuildBudgetMs(),
): Promise<RealBuildVerdict> {
  if (!realBuildCheckEnabled()) return { ran: false, reason: 'flag-off' };
  if (!actuator || !workspaceId) return { ran: false, reason: 'unavailable' };
  // An actuator that cannot answer the warmth question is treated as NO. A wrong yes starts a machine.
  if (typeof actuator.hasLiveSandbox !== 'function' || !actuator.hasLiveSandbox(workspaceId)) {
    return { ran: false, reason: 'no-sandbox' };
  }
  // A static app has no build script to run; its page IS its files. Nothing to predict.
  if (detectProjectKind(files) === 'static') return { ran: false, reason: 'static-app' };

  try {
    for (const [path, content] of Object.entries(changed)) {
      await actuator.writeFile(workspaceId, path, content);
    }
  } catch {
    // The heal could not reach the sandbox, so a build there would judge the OLD code and its verdict
    // would be about an app we are not pushing. Skipping is the honest outcome.
    return { ran: false, reason: 'unavailable' };
  }

  let result: { success: boolean; logs: string } | null = null;
  try {
    result = await Promise.race([
      actuator.build(workspaceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
    ]);
  } catch {
    // A sandbox that threw tells us nothing about the app. Never a failure verdict.
    return { ran: false, reason: 'unavailable' };
  }
  if (!result) return { ran: false, reason: 'timed-out' };
  if (result.success) return { ran: true, ok: true };

  const read = readRealBuildFailure(result.logs);
  return { ran: true, ok: false, ...read, log: String(result.logs || '').slice(-6000) };
}

/**
 * What the user is told. Branded, vendor-free, and it never blames their app for our own uncertainty.
 *
 * ⚠️ A SKIP SAYS NOTHING AT ALL. "We could not check" is not information a user can act on, and putting
 * it on screen would turn a silent optimisation into a worry — the ship proceeds either way.
 */
export function realBuildNote(v: RealBuildVerdict): string | null {
  if (!v.ran) return null;
  if (v.ok) return 'Your app was built here first and it compiled, so the phone build starts from something that already works.';
  if (!v.blocking) return null; // the runner rescues this class itself; saying so would invent a worry
  return `Your app did not compile here, so the phone build would have failed too: ${v.summary}`;
}
