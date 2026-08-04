// Writing into a user's own app — the one shared, verified path.
//
// WHY THIS EXISTS (admin 2026-07-27): five Design & Build tools (Multi-Page, Components, Design
// System, Dark Mode, Figma) all offered an "Inject / Insert / Export into app" button, and every one
// of them only called `setGeneratedCode` — the in-memory preview. Close the tab, come back tomorrow,
// or open the app on another phone, and the change was gone; the v5 builder never saw it either. The
// Minifier had the same gap until it was wired to storage.
//
// One root cause in five places is a class, not five bugs, so the fix is one module every tool calls
// rather than five copies that drift apart. Everything a tool needs to change a user's real app —
// resolving the workspace, protecting what is about to be overwritten, and confirming the write
// actually landed — lives here and nowhere else.
//
// THE THREE INVARIANTS, all learned from how the underlying stores really behave:
//
//  1. THE WORKSPACE IS DERIVED, NEVER ACCEPTED. A caller names only a sessionId; the id is built from
//     the verified uid. Cross-account access is impossible by construction rather than by check.
//
//  2. A RESTORE POINT IS SAVED FIRST AND READ BACK. `buildHistoryStore.save()` deliberately swallows
//     every error and returns void, and it truncates large snapshots to fit Firestore's document
//     limit. So "we called save()" proves nothing at all. The saved version is re-read and required to
//     hold the exact original bytes of every file about to be overwritten. No proof ⇒ no write.
//
//  3. THE WRITE IS READ BACK TOO. `mergeWorkspaceFiles()` resolves happily when there is no database
//     AND silently drops any file over its size cap. Reporting success from a resolved promise would
//     be a fake success, so the files are re-read and compared before anything is reported as saved.

import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { buildHistoryStore } from '../project/BuildHistoryStore';

/** The store silently drops anything larger, so we check first and say so instead. */
export const MAX_WRITE_FILE_BYTES = 900 * 1024;

/** How many recent restore points to search when confirming ours actually landed. */
const RESTORE_POINT_SEARCH_DEPTH = 5;

/**
 * Build the workspace id for one of THIS user's apps.
 *
 * Every Pro v5 app is stored as `agentv3-{uid}-{sessionId}`. Deriving the id from the verified uid,
 * rather than accepting one from the client, means there is no id for a caller to tamper with.
 * Returns null when either part is not a plausible id.
 */
export function sessionWorkspaceId(uid: string, sessionId: string): string | null {
  if (!uid || !/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return null;
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null;
  return `agentv3-${uid}-${sessionId}`;
}

export interface HistoryDeps {
  save: typeof buildHistoryStore.save;
  list: typeof buildHistoryStore.list;
  get: typeof buildHistoryStore.get;
}

export const realHistory: HistoryDeps = {
  save: (...a) => buildHistoryStore.save(...a),
  list: (...a) => buildHistoryStore.list(...a),
  get: (...a) => buildHistoryStore.get(...a),
};

export interface WorkspaceDeps {
  load: typeof loadWorkspaceFiles;
  merge: typeof mergeWorkspaceFiles;
}

export const realWorkspace: WorkspaceDeps = {
  load: (...a) => loadWorkspaceFiles(...a),
  merge: (...a) => mergeWorkspaceFiles(...a),
};

export interface RestorePointResult {
  ok: boolean;
  /** The version the user can restore to, or null when there was nothing to protect. */
  versionId: string | null;
  /** Set when ok is false — why the write must not proceed. */
  reason?: string;
}

/**
 * Save a restore point AND prove it can actually undo this particular change.
 *
 * `protect` is the set of files that already exist and are about to be overwritten — those are the
 * ones the user cannot recreate by hand, so the snapshot is required to hold their exact bytes. A
 * file being CREATED needs no such proof (there is nothing to lose), but the snapshot still has to
 * exist so "undo" returns the app to before those files appeared.
 *
 * An app with no files yet has nothing to protect and is allowed through with versionId null — an
 * honest "no restore point because none was needed", never a made-up id.
 */
export async function saveVerifiedRestorePoint(
  sessionId: string,
  currentFiles: Record<string, string>,
  protect: string[],
  label: string,
  deps: HistoryDeps = realHistory,
): Promise<RestorePointResult> {
  const existing = Object.keys(currentFiles);
  if (existing.length === 0) {
    return { ok: true, versionId: null, reason: 'nothing-to-protect' };
  }

  // Only files that genuinely exist can be verified against their originals.
  const mustHold = protect.filter((p) => typeof currentFiles[p] === 'string');

  try {
    await deps.save(sessionId, {
      commitMessage: label.slice(0, 120),
      fileCount: existing.length,
      files: currentFiles,
      isEdit: true,
      tier: 'manual',
      ok: true,
    });

    // Newest first. Ours should be first, but a concurrent save could beat us — and the question that
    // matters is "does a restore point holding these exact files exist NOW?", not "was it mine".
    const recent = (await deps.list(sessionId)).slice(0, RESTORE_POINT_SEARCH_DEPTH);
    for (const meta of recent) {
      const full = await deps.get(sessionId, meta.id);
      if (!full?.files) continue;
      const holdsAll = mustHold.every((p) => full.files![p] === currentFiles[p]);
      // A snapshot truncated to nothing protects nothing, even when no specific file was named.
      if (holdsAll && Object.keys(full.files).length > 0) return { ok: true, versionId: meta.id };
    }
    return {
      ok: false,
      versionId: null,
      reason: 'A restore point you could undo from could not be saved, so nothing was changed.',
    };
  } catch {
    return {
      ok: false,
      versionId: null,
      reason: 'A restore point you could undo from could not be saved, so nothing was changed.',
    };
  }
}

export interface WriteResult {
  ok: boolean;
  /** Paths confirmed present with the exact intended content after the write. */
  written: string[];
  /** Paths that did NOT land — reported rather than quietly counted as success. */
  failed: string[];
  reason?: string;
}

/**
 * Write files into the user's app and confirm each one really changed.
 *
 * Both failure modes of the underlying store are silent — no database, and per-file size cap — so the
 * files are read back and compared. Oversized files are rejected up front with a clear reason instead
 * of being dropped on the floor by the store.
 */
export async function writeFilesVerified(
  workspaceId: string,
  patch: Record<string, string>,
  deps: WorkspaceDeps = realWorkspace,
): Promise<WriteResult> {
  const paths = Object.keys(patch);
  if (paths.length === 0) return { ok: false, written: [], failed: [], reason: 'Nothing to save.' };

  const tooBig = paths.filter((p) => Buffer.byteLength(patch[p] ?? '', 'utf8') > MAX_WRITE_FILE_BYTES);
  if (tooBig.length > 0) {
    return {
      ok: false,
      written: [],
      failed: tooBig,
      reason: `Too large to save (over ${Math.round(MAX_WRITE_FILE_BYTES / 1024)} KB): ${tooBig.join(', ')}`,
    };
  }

  try {
    await deps.merge(workspaceId, patch);
    const after = await deps.load(workspaceId);
    const written = paths.filter((p) => after[p] === patch[p]);
    const failed = paths.filter((p) => after[p] !== patch[p]);
    return failed.length === 0
      ? { ok: true, written, failed }
      : { ok: false, written, failed, reason: 'The change could not be saved, so your app is unchanged.' };
  } catch {
    return { ok: false, written: [], failed: paths, reason: 'The change could not be saved, so your app is unchanged.' };
  }
}

export interface ApplyResult {
  ok: boolean;
  written: string[];
  versionId: string | null;
  status: number;
  error?: string;
  undoHint?: string;
}

/**
 * The whole safe-write sequence every tool shares: load what is there → protect what is about to be
 * overwritten → write → verify. Each step gates the next, and nothing is reported as done until it
 * has been read back.
 */
export async function applyFilesToApp(
  workspaceId: string,
  sessionId: string,
  patch: Record<string, string>,
  label: string,
  deps: { history?: HistoryDeps; workspace?: WorkspaceDeps } = {},
): Promise<ApplyResult> {
  const workspace = deps.workspace ?? realWorkspace;
  const history = deps.history ?? realHistory;

  const paths = Object.keys(patch);
  if (paths.length === 0) {
    return { ok: false, written: [], versionId: null, status: 400, error: 'Nothing to save.' };
  }

  let current: Record<string, string>;
  try {
    current = await workspace.load(workspaceId);
  } catch {
    return { ok: false, written: [], versionId: null, status: 502, error: 'Could not read that app’s files.' };
  }

  // Skip files whose content is already exactly what we would write — an unnecessary restore point is
  // confusing, and an unnecessary write is a chance to fail for nothing.
  const changed: Record<string, string> = {};
  for (const p of paths) if (current[p] !== patch[p]) changed[p] = patch[p];
  if (Object.keys(changed).length === 0) {
    return { ok: true, written: [], versionId: null, status: 200, error: undefined, undoHint: undefined };
  }

  const overwriting = Object.keys(changed).filter((p) => typeof current[p] === 'string');
  const restore = await saveVerifiedRestorePoint(sessionId, current, overwriting, label, history);
  if (!restore.ok) {
    return { ok: false, written: [], versionId: null, status: 503, error: restore.reason };
  }

  const write = await writeFilesVerified(workspaceId, changed, workspace);
  if (!write.ok) {
    return { ok: false, written: write.written, versionId: restore.versionId, status: 502, error: write.reason };
  }

  return {
    ok: true,
    written: write.written,
    versionId: restore.versionId,
    status: 200,
    undoHint: restore.versionId
      ? 'A restore point was saved first — you can undo this any time from Versioning (Time Machine).'
      : undefined,
  };
}
