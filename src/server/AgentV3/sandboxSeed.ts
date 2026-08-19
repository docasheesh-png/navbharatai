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
  for (const [path, content] of Object.entries(saved)) {
    try {
      await actuator.writeFile(workspaceId, path, content);
      seeded += 1;
    } catch { /* one bad file must not abort the restore */ }
  }

  if (seeded === 0) {
    return { ready: false, seeded: 0, reason: 'Your files could not be restored to the build machine. Try again in a moment.' };
  }
  return { ready: true, seeded, reason: '' };
}
