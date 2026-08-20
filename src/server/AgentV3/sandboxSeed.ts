// "Your app did not build, so there was nothing to publish" — when the app was fine all along.
//
// ── THE REPORT (admin 2026-08-19) ───────────────────────────────────────────────────────────────
// A piano app built at 10:20 and previewed correctly. At 16:11 the admin pressed Publish and got:
//
//   npm error path /home/user/workspace/package.json
//   npm error enoent Could not read package.json
//
// Nothing was wrong with the app. Its 21 files were safe in the durable store the whole time — the
// in-browser preview was rendering them on the same screen. What was missing was the SANDBOX.
//
// ── WHY IT ONLY HAPPENS AFTER A WHILE ───────────────────────────────────────────────────────────
// Publish runs `npm run build` straight through the actuator, which assumes the workspace's files are
// already in the sandbox. That holds for minutes after a build and stops holding soon after:
//
//   • the idle sweep pauses the sandbox (5 minutes of no activity), and
//   • it also DROPS the actuator's in-memory `_fileCache` for that workspace, which is the only thing
//     the recreate-after-death restore replays from — and that cache dies with the Cloud Run instance
//     anyway, i.e. on every deploy.
//
// So the next sandbox comes back EMPTY, `npm run build` runs in an empty directory, and the user is
// shown npm's raw ENOENT for a mistake they did not make. Publish worked only while the sandbox
// happened to still be warm — which is a clock, not a condition anyone can see or control.
//
// ── THE FIX IS TO STOP ASSUMING ─────────────────────────────────────────────────────────────────
// The durable store is the source of truth for a workspace's files (`WorkspaceFileStore` — Firestore,
// no TTL, written on every build and edit). Any deterministic operation that runs a command in the
// sandbox must make sure the sandbox actually HAS them first, rather than hoping. This module is that
// step, shared rather than inlined so the next such operation inherits it instead of re-learning this
// the same way.

import type { IEngineerActuator } from './sandbox/EngineerAI/actuators/IEngineerActuator';
import { loadWorkspaceFiles } from './WorkspaceFileStore';
import { runInPass } from './greenFreeze';

/** What a seed attempt did — returned so callers can report honestly instead of guessing. */
export interface SeedOutcome {
  /** True when the sandbox already had the project, or now does. False ⇒ there is genuinely nothing. */
  ready: boolean;
  /** How many files were written into the sandbox (0 when it was already populated). */
  seeded: number;
  /** Why `ready` is false, in words a caller can show a user. Empty when ready. */
  reason: string;
}

/**
 * The marker that decides "does this sandbox hold the project?".
 *
 * `package.json` specifically, not "any file at all": a sandbox can come back with a stray scaffold
 * remnant or a lockfile and still be useless to `npm run build` — which is exactly the failure being
 * fixed. The file the build actually needs is the file we check for.
 */
export const PROJECT_MARKER = 'package.json';

/** Static projects have no package.json and need no seeding decision made on one. */
export function projectNeedsMarker(files: Record<string, string>): boolean {
  return Object.prototype.hasOwnProperty.call(files, PROJECT_MARKER);
}

/**
 * Decide whether the sandbox needs seeding, from the two file listings. PURE, so the rule is testable
 * without a sandbox or Firestore.
 *
 * `null` sandbox files means the listing FAILED — which is not the same as "the sandbox is empty" and
 * must not be treated as it. A failed listing seeds anyway: writing files that are already there is
 * harmless, while skipping a seed because we could not look is the original bug wearing a new hat.
 */
export function shouldSeedSandbox(
  sandboxFiles: string[] | null,
  savedFiles: Record<string, string>,
): { seed: boolean; reason: string } {
  const savedCount = Object.keys(savedFiles).length;
  if (savedCount === 0) return { seed: false, reason: 'no saved files' };
  if (sandboxFiles === null) return { seed: true, reason: 'sandbox listing failed' };
  if (sandboxFiles.length === 0) return { seed: true, reason: 'sandbox empty' };
  // A populated sandbox that is missing the very file the build opens is not populated enough.
  if (projectNeedsMarker(savedFiles) && !sandboxFiles.some((f) => f === PROJECT_MARKER || f.endsWith(`/${PROJECT_MARKER}`))) {
    return { seed: true, reason: 'project marker missing' };
  }
  return { seed: false, reason: 'already present' };
}

/**
 * Make sure this workspace's saved files are in the sandbox, seeding from the durable store if not.
 *
 * Best-effort per file: one unwritable file must not abort the whole restore, because a partial
 * project still builds far more often than an empty one. Never throws — a caller mid-publish gets a
 * verdict, not an exception.
 */
export async function ensureWorkspaceFilesInSandbox(
  actuator: Pick<IEngineerActuator, 'listFiles' | 'writeFile'>,
  workspaceId: string,
  load: typeof loadWorkspaceFiles = loadWorkspaceFiles,
): Promise<SeedOutcome> {
  if (!workspaceId) return { ready: false, seeded: 0, reason: 'no workspace' };

  let sandboxFiles: string[] | null = null;
  try {
    sandboxFiles = await actuator.listFiles(workspaceId);
  } catch {
    sandboxFiles = null; // could not look — deliberately NOT read as "empty"
  }

  const saved = await load(workspaceId).catch(() => ({} as Record<string, string>));
  const decision = shouldSeedSandbox(sandboxFiles, saved);

  if (!decision.seed) {
    // Nothing saved AND nothing in the sandbox is the one genuinely-not-ready case.
    if (decision.reason === 'no saved files' && (sandboxFiles?.length ?? 0) === 0) {
      return { ready: false, seeded: 0, reason: 'This workspace has no saved files yet — build an app first.' };
    }
    return { ready: true, seeded: 0, reason: '' };
  }

  let seeded = 0;
  // WHY THE PASS NAME MATTERS: every sandbox write goes through Green Freeze, which refuses to touch a
  // verified-working app from a pass it does not recognise. Without this wrapper the restore was
  // refused on exactly the apps most worth publishing — a green one — and the user was told their
  // files could not be restored, on a workspace where the files were perfectly safe. See the entry
  // for 'sandbox-file-restore' in greenFreeze.ts for why a restore is not an alteration.
  let firstFailure = '';
  await runInPass('sandbox-file-restore', async () => {
    for (const [path, content] of Object.entries(saved)) {
      try {
        await actuator.writeFile(workspaceId, path, content);
        seeded += 1;
      } catch (e) {
        // One bad file must not abort the restore — but the FIRST reason is kept, because a message
        // that says "could not be restored" without saying why is the exact failure this file was
        // written to end. Swallowing it silently is what hid the Green Freeze refusal for a day.
        if (!firstFailure) firstFailure = e instanceof Error ? e.message : String(e);
      }
    }
  });

  if (seeded === 0) {
    return {
      ready: false,
      seeded: 0,
      reason: `Your files could not be restored to the build machine.${firstFailure ? ` ${firstFailure}` : ''}`,
    };
  }
  return { ready: true, seeded, reason: '' };
}

/** What preparing a sandbox for a build actually did — each half reported separately, and honestly. */
export interface PrepareOutcome {
  /** The files half. False ⇒ do not attempt a build; `reason` says why in words a user can act on. */
  ready: boolean;
  reason: string;
  seeded: number;
  /** True when a dependency install actually ran. */
  installed: boolean;
  /**
   * The install FAILED (or the actuator does not offer one and the sandbox was cold). Deliberately
   * NOT fatal — see the note in `prepareSandboxForBuild`.
   */
  installFailed: boolean;
  /** The install's own output, for the caller to append to a build failure. Empty when it succeeded. */
  installLog: string;
}

/**
 * Get a sandbox genuinely ready to run a build: the project's FILES, then its DEPENDENCIES.
 *
 * ── WHY BOTH HALVES LIVE HERE (admin 2026-08-19, two reports, twenty minutes apart) ─────────────
 * Publish failed twice in a row, and each failure was the same mistake at a different depth:
 *
 *   1. `npm error enoent ... package.json` — the sandbox had no FILES. The durable re-seed that
 *      fixes this already existed, in `preview-diagnose`.
 *   2. `sh: 1: tsc: not found` — the sandbox now had files but no NODE_MODULES. The workspace-level
 *      install that fixes this already existed too, as `actuator.ensureDependencies`, added on
 *      2026-08-09 for the identical shape (`sh: 1: drizzle-kit: not found`).
 *
 * **Publish was simply outside both guarantees.** Each had been added when a different path hit this
 * class, and each was wired only into the path that hit it. Fixing the files half alone was what
 * produced the second report — so the two are now ONE step that callers cannot take half of.
 *
 * ── WHY A FAILED INSTALL IS NOT FATAL ───────────────────────────────────────────────────────────
 * `ensureDependencies` is documented as optional and best-effort: actuators without real isolation
 * do not offer it, and callers must "carry on and report honestly, never a hard stop". So a failed
 * install does not block the build — it is RECORDED, and the caller appends it to the build's own
 * error if the build then fails. That way the user sees the real first cause ("dependencies could not
 * be installed") instead of its symptom ("tsc: not found") — which is the whole reason this file exists.
 */
export async function prepareSandboxForBuild(
  actuator: Pick<IEngineerActuator, 'listFiles' | 'writeFile'> & Pick<Partial<IEngineerActuator>, 'ensureDependencies'>,
  workspaceId: string,
  load: typeof loadWorkspaceFiles = loadWorkspaceFiles,
): Promise<PrepareOutcome> {
  const seed = await ensureWorkspaceFilesInSandbox(actuator, workspaceId, load);
  if (!seed.ready) {
    return { ready: false, reason: seed.reason, seeded: seed.seeded, installed: false, installFailed: false, installLog: '' };
  }

  let installed = false;
  let installFailed = false;
  let installLog = '';
  try {
    const dep = await actuator.ensureDependencies?.(workspaceId);
    if (dep) {
      installed = dep.ran === true;
      installFailed = dep.ok === false;
      if (dep.ok === false) installLog = String(dep.log ?? '').slice(-2000);
    }
  } catch (e) {
    // Never throws at the caller: an install that blew up is reported, not rethrown mid-publish.
    installFailed = true;
    installLog = e instanceof Error ? e.message : String(e);
  }

  return { ready: true, reason: '', seeded: seed.seeded, installed, installFailed, installLog };
}
