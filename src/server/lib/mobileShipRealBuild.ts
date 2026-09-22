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
import { ensureWorkspaceFilesInSandbox } from '../AgentV3/sandboxSeed';
import type { VerifyFix } from './mobileBuildAiRepair';

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
  | 'unavailable'
  /** The ship's own production build already ran here (`mobileShipPrebuilt.ts`); a second build proves nothing. */
  | 'prebuilt';

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
 * The classes that are POSITIVELY the app's own fault — a failure the runner is KNOWN to share, so a
 * refusal here saves the five-minute run rather than inventing one.
 *
 * 🔴 Everything else is NOT blocking, and this is the review's correction (2026-09-22): the first
 * draft blocked on "anything not rescued by the workflow", which made `UNKNOWN` — the classifier's
 * honest "I could not name this" — a 422 that blamed the user's app for a sandbox that ran out of
 * memory, a machine killed mid-build, a registry blip. A failure we cannot name is one the runner gets
 * to judge; the source ship carries the app to it exactly as before this check existed.
 */
const APP_FAULT_CODES: ReadonlySet<string> = new Set([
  'APP_CODE_BUILD_FAILED',
  'NPM_PACKAGE_NOT_FOUND',
  'NPM_VERSION_NOT_FOUND',
  'NPM_PEER_CONFLICT',
  'BUILD_SCRIPT_MISSING',
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
    blocking: APP_FAULT_CODES.has(diag.code) && !RESCUED_BY_THE_WORKFLOW.has(diag.code),
    code: diag.code,
    summary: diag.summary,
  };
}

/** Just enough of the actuator for this check — so a test needs no sandbox and no E2B key. */
export interface RealBuildActuator {
  hasLiveSandbox?(workspaceId: string): boolean;
  readFile(workspaceId: string, filePath: string): Promise<string>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  build(workspaceId: string): Promise<{ success: boolean; logs: string }>;
  /** Needed only by the repair path, which may seed an empty machine. */
  listFiles?(workspaceId: string): Promise<string[]>;
}

/**
 * PROVE the sandbox holds the app before trusting anything its build says.
 *
 * 🔴 `build()` answers `success: true — "(no build step — static project)"` for a machine with NO
 * package.json. A sandbox that came back empty, or a paused handle whose `files.exists` threw and was
 * swallowed, would therefore PASS a real-build check without building anything, and the ship would be
 * told the app compiled. The one fact that rules that out is reading the project marker back: a read
 * that throws or comes back empty means the verdict below would be about a different machine than the
 * app, and no verdict is issued.
 *
 * `null` ⇒ not proven. Never a pass.
 */
export async function sandboxHoldsApp(actuator: RealBuildActuator, workspaceId: string): Promise<boolean> {
  try {
    const marker = await actuator.readFile(workspaceId, 'package.json');
    return typeof marker === 'string' && marker.trim().length > 0;
  } catch {
    return false;
  }
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
  // A warm handle is not proof the machine holds the app — see `sandboxHoldsApp`.
  if (!(await sandboxHoldsApp(actuator, workspaceId))) return { ran: false, reason: 'unavailable' };

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

// ───────────────────────── the repair loop's verifier ─────────────────────────

export interface RepairVerifyOptions {
  /** Which stage the remote build died in, from the workflow's own marker. Decides judgeability. */
  stage: 'install' | 'webbuild' | 'capacitor' | 'android' | 'ios' | null;
  /** The failure class, so a class the sandbox cannot judge is refused before a machine is touched. */
  code: string;
  budgetMs?: number;
}

/**
 * Can `npm run build` in the app's sandbox answer whether this failure is fixed?
 *
 * It can for the stages that ARE the app's own build — dependency install and the web build — and for
 * an unmarked log that the classifier read as the app not compiling. It cannot for the Capacitor,
 * Gradle or Xcode stages: the sandbox has no Android SDK and no Mac, so a "pass" there would be a pass
 * of a different question. Refusing those keeps the verifier from ever certifying a change it did not
 * actually test. PURE.
 */
export function sandboxCanJudge(opts: Pick<RepairVerifyOptions, 'stage' | 'code'>): boolean {
  if (opts.stage === 'install' || opts.stage === 'webbuild') return true;
  if (opts.stage === null) return opts.code === 'APP_CODE_BUILD_FAILED' || opts.code === 'TYPE_GATE_BLOCKED_PACKAGING' || opts.code === 'UNKNOWN';
  return false;
}

/**
 * Build the verifier the AI repair loop calls with each candidate change.
 *
 * Unlike the ship-time check above, this one MAY wake the app's machine: it holds a real failure and a
 * real cost to avoid (a five-minute GitHub run and one of the user's attempts), so a resume — seconds,
 * and a few paise of sandbox time — is the cheap side of that trade. An EMPTY machine is seeded from the
 * durable store first (`ensureWorkspaceFilesInSandbox`, the same path publish uses), because a verdict
 * needs the app to be there.
 *
 * 🔒 THE SANDBOX IS THE USER'S WORKSPACE, BORROWED. Every file this writes is snapshotted first and put
 * back afterwards — on a failed build, on a timeout, on a throw, AND on success — except the app's own
 * source files on success, which the route then also merges into the durable workspace, so the user's
 * app inside NavBharatAI is healed by the same change that heals the repository (the compile
 * pre-flight's own rule). Repository-only files (the workflow, the assembled package.json,
 * capacitor.config.ts) are never left behind in the workspace.
 *
 * A path that does not exist in the sandbox is not written: it could not be affecting the sandbox's
 * build, and writing it would plant a repository file in the workspace. The candidate is still judged
 * on the files that do exist there.
 */
export function makeRepairVerifier(
  actuator: RealBuildActuator | null | undefined,
  workspaceId: string,
  opts: RepairVerifyOptions,
  isAppSource: (path: string) => boolean,
  /**
   * Where a REPOSITORY path lives in the sandbox, or `null` for a path that lives nowhere there (a
   * prebuilt `www/` bundle). Defaults to identity, which is right for a `built` repository. A `static`
   * one keeps its source under `www/` in the repository and at the workspace root — without this map
   * every candidate for such an app was "nothing to test". See `workspacePathForRepoPath`.
   */
  mapPath: (repoPath: string) => string | null = (p) => p,
): VerifyFix | undefined {
  if (!actuator || !workspaceId) return undefined;
  if (!sandboxCanJudge(opts)) return undefined;
  const budgetMs = opts.budgetMs ?? realBuildBudgetMs();

  return async (repoChanged) => {
    // The candidate, re-keyed by SANDBOX path. A repository path with no sandbox home is dropped here.
    const changed: Record<string, string> = {};
    for (const [repoPath, content] of Object.entries(repoChanged)) {
      const local = mapPath(repoPath);
      if (local) changed[local] = content;
    }
    // Presence, then seed, then presence again — a read that still fails means no machine holds the app.
    if (!(await sandboxHoldsApp(actuator, workspaceId))) {
      if (typeof actuator.listFiles === 'function') {
        await ensureWorkspaceFilesInSandbox(
          actuator as { listFiles: (w: string) => Promise<string[]>; writeFile: RealBuildActuator['writeFile'] },
          workspaceId,
        ).catch(() => undefined);
      }
      if (!(await sandboxHoldsApp(actuator, workspaceId))) return { ran: false, reason: 'no-sandbox' };
    }

    // Snapshot what we are about to overwrite. A path the sandbox does not have is skipped, not created.
    const before: Record<string, string> = {};
    for (const path of Object.keys(changed)) {
      try {
        before[path] = await actuator.readFile(workspaceId, path);
      } catch { /* not in the sandbox — skipped below */ }
    }
    const toWrite = Object.keys(changed).filter((p) => p in before);
    if (toWrite.length === 0) return { ran: false, reason: 'nothing-to-test' };

    const restore = async (only?: (path: string) => boolean): Promise<void> => {
      for (const path of toWrite) {
        if (only && !only(path)) continue;
        await actuator.writeFile(workspaceId, path, before[path]).catch(() => undefined);
      }
    };

    try {
      for (const path of toWrite) await actuator.writeFile(workspaceId, path, changed[path]);
    } catch {
      await restore();
      return { ran: false, reason: 'unavailable' };
    }

    let result: { success: boolean; logs: string } | null = null;
    try {
      result = await Promise.race([
        actuator.build(workspaceId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), budgetMs)),
      ]);
    } catch {
      await restore();
      return { ran: false, reason: 'unavailable' };
    }
    if (!result) {
      await restore();
      return { ran: false, reason: 'timed-out' };
    }
    if (result.success) {
      // Keep the app's own healed source in the workspace; put every repository-only file back.
      await restore((p) => !isAppSource(p));
      return { ran: true, ok: true };
    }
    await restore();
    const read = readRealBuildFailure(result.logs);
    return { ran: true, ok: false, log: String(result.logs || '').slice(-6000), summary: read.summary };
  };
}
