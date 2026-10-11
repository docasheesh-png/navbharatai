// GOING BACK TO A VERSION PUTS THE WHOLE APP BACK — the app the engine builds on, not a copy on screen
// (admin 2026-10-11, Q-128: "one timeline — Time Machine is the one version history; the History tab becomes a
// view of it").
//
// 🔴 WHAT WAS WRONG. Time Machine's Restore downloaded the version and handed it to the browser
// (`setFiles` + `updatePreview`). The app's SAVED workspace — what the next build reads, what a reload shows,
// what another device opens — was never touched. So "Version restored ✓" was true of one tab's memory, and
// the next message to the builder carried on from the newer files. THE CLASS: a restore that changes the
// view and not the thing viewed.
//
// Now a restore runs on the server: the version replaces the saved file set (no hybrid of old and new — the
// GreenGuard `restorePlan`, the one restore planner this repo already trusts), the running sandbox is brought
// to the same state, and the app as it stood a moment ago is saved as a version FIRST, so "you can come
// forward again" (versionHelp.ts) is a fact rather than a hope. PURE planning here; the route does the I/O.
import { restorePlan } from '../AgentV3/GreenGuard';

/** The most paths a version remembers it could not keep — enough to protect them, bounded for the doc. */
export const MAX_OMITTED_PATHS_REMEMBERED = 500;

export interface VersionRestoreInput {
  /** The version's files. Empty or missing ⇒ not restorable (an unreadable payload is never "an empty app"). */
  versionFiles: Record<string, string> | null | undefined;
  /** Files the version could not keep (too large even compressed). */
  omittedFileCount?: number;
  /** Which ones, when the version remembers (written since 2026-10-11). */
  omittedPaths?: readonly string[];
  /** The app's saved files right now. */
  current: Record<string, string>;
}

export type VersionRestorePlan =
  | { ok: false; reason: 'version-unreadable' }
  | {
      ok: true;
      /** The whole file set the saved workspace holds after the restore. */
      target: Record<string, string>;
      /** Files whose content changes, and files that go. */
      write: Record<string, string>;
      remove: string[];
      unchanged: number;
      /** Current files left as they are because the version could not say whether it had them. */
      keptUnknown: number;
      /** Nothing would change — the app already IS this version. */
      noChange: boolean;
    };

/**
 * What a restore writes and removes. A file the version could not keep is never deleted: when the version
 * names those files, exactly they keep today's copy; when it does not (older versions), every current file
 * the version lacks is kept and COUNTED, because "added since" and "too large to keep" cannot be told apart.
 * PURE.
 */
export function versionRestorePlan(input: VersionRestoreInput): VersionRestorePlan {
  const files = input.versionFiles && typeof input.versionFiles === 'object' ? input.versionFiles : null;
  if (!files || Object.keys(files).length === 0) return { ok: false, reason: 'version-unreadable' };
  const current = input.current ?? {};
  const omitted = Math.max(0, Number(input.omittedFileCount) || 0);
  const named = Array.isArray(input.omittedPaths) ? input.omittedPaths.filter((p) => typeof p === 'string') : [];
  // Which current files must survive although the version does not list them.
  const protect = new Set<string>(
    omitted === 0 ? []
      : named.length > 0 ? named.filter((p) => p in current)
        : Object.keys(current).filter((p) => !(p in files)),
  );
  const plan = restorePlan(files, current, protect);
  const target: Record<string, string> = { ...files };
  for (const p of protect) if (!(p in target)) target[p] = current[p];
  const keptUnknown = omitted > 0 && named.length === 0 ? protect.size : 0;
  return {
    ok: true,
    target,
    write: plan.write,
    remove: plan.remove,
    unchanged: plan.unchanged,
    keptUnknown,
    noChange: Object.keys(plan.write).length === 0 && plan.remove.length === 0,
  };
}

/** The name of the version saved just before a restore, so the user can come forward again. PURE. */
export function beforeRestoreVersionName(restoredName: string): string {
  const name = String(restoredName ?? '').trim().slice(0, 80) || 'an earlier version';
  return `Before going back to "${name}"`;
}

export type SandboxRestoreState = 'updated' | 'not-updated';

/** What the user is told. Plain words; no file paths, no vendor names. PURE. */
export function versionRestoreMessage(r: {
  name: string;
  savedBefore: boolean;
  keptUnknown: number;
  sandbox: SandboxRestoreState;
  noChange: boolean;
}): string {
  const name = String(r.name ?? '').trim() || 'that version';
  if (r.noChange) return `Your app is already the same as "${name}" — nothing needed to change.`;
  const parts = [`Your app is back to "${name}".`];
  if (r.savedBefore) parts.push('The app as it was a moment ago is saved in your versions, so you can come forward again.');
  if (r.keptUnknown > 0) {
    parts.push(`${r.keptUnknown} file${r.keptUnknown === 1 ? ' was' : 's were'} left as ${r.keptUnknown === 1 ? 'it is' : 'they are'}: this version was too large to keep every file, and it does not record which.`);
  }
  // ⚠️ Said plainly, with the one action that finishes it: a running copy left on the newer files would be
  // what the next build starts from (the File Guardian only re-adds MISSING files), so "it will catch up"
  // would be false. Restore is safe to press again — the saved app already matches, so only the running
  // copy is brought in line.
  if (r.sandbox === 'not-updated') parts.push('The running copy could not be updated yet — tap Restore on this version again before your next change.');
  return parts.join(' ');
}

/** Refused while a build holds the app — its end-of-build save would overwrite the restore, or mix the two. */
export const VERSION_RESTORE_BUILD_RUNNING =
  'A build is running for this app right now. Wait for it to finish (or stop it), then go back to the version.';
