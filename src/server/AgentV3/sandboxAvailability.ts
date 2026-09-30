/**
 * WAS THE SANDBOX REALLY UNAVAILABLE? (autopsy a9f8d186, 2026-09-30)
 *
 * Setup failed once on a stale handle ("The sandbox was not found"), the route set
 * `sandboxUnavailable = true`, and nothing ever looked at it again. The same build then ran
 * `npm install` and `npm run build` in that sandbox (exit 0), started the dev server, and watched the
 * app render in a real browser. At the end the flag won anyway: the user read "The build could not
 * run — the sandbox was unavailable", the verdict was `ok:false`, the release gate counted the setup
 * error as a build-breaking blocker, and a working app was made free.
 *
 * A setup failure is a fact about ONE moment. Whether the sandbox served THIS build is answered by
 * what later ran in it, and the answer is decidable: a command that returned an exit code ran there,
 * and an app that rendered was served from there. Either one proves the sandbox was available.
 *
 * ⚠️ An exit code of -1 is NOT evidence: that is the sentinel for "the program never ran" (a dead
 * sandbox), see `resolveThrownCommandExit`. Only a real exit code — success or failure — counts.
 *
 * Pure. Never throws.
 */

export interface SandboxServedEvidence {
  /** Commands recorded for this build, with their exit codes (null when the code was not captured). */
  commands?: ReadonlyArray<{ exitCode?: number | null }> | null;
  /** The app was opened in a real browser and rendered on this turn. */
  appRendered?: boolean;
}

/** Did anything prove the sandbox served this build? */
export function sandboxServedTheBuild(evidence: SandboxServedEvidence): boolean {
  if (evidence.appRendered === true) return true;
  for (const c of evidence.commands ?? []) {
    const code = c?.exitCode;
    if (typeof code === 'number' && Number.isInteger(code) && code >= 0) return true;
  }
  return false;
}

/**
 * The verdict every reader should use: setup failed AND nothing afterwards proved the sandbox served
 * the build. A build whose setup succeeded is never unavailable here.
 */
export function sandboxWasUnavailable(setupFailed: boolean, evidence: SandboxServedEvidence): boolean {
  if (!setupFailed) return false;
  return !sandboxServedTheBuild(evidence);
}
