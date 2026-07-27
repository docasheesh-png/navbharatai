// Minifier routes — minify a user's OWN app files, and optionally write the result back.
//
// WHY THIS EXISTS (admin 2026-07-26): the Minifier only accepted pasted code. "User aise kahan se code
// layega?" — exactly right. When v5 builds someone an app, the code they want to optimise is THAT app's,
// so the tool has to reach the user's real project instead of a textarea.
//
// FOUR SAFETY RULES, all load-bearing:
//
//  1. THE SERVER DERIVES THE WORKSPACE ID from the verified uid — the client only ever names a
//     sessionId. A caller therefore cannot address another account's workspace at all; there is no id
//     to tamper with.
//
//  2. THE SERVER RE-MINIFIES; it never writes client-supplied text. `apply` loads the stored file,
//     minifies it here, and saves that. What lands in the file is provably the minified form of what
//     was actually there — a tampered or stale client payload cannot become the user's source code.
//
//  3. A RESTORE POINT IS SAVED FIRST **AND VERIFIED BY READING IT BACK**. This is the only operation
//     in the app that overwrites a user's source with machine-generated output, and minified code
//     cannot be un-minified by hand. `buildHistoryStore.save()` is deliberately best-effort — it
//     swallows every error and returns void — and it truncates large snapshots to fit Firestore's
//     document limit. So "we called save()" proves nothing. We re-read the saved version and confirm
//     it contains this exact file's ORIGINAL bytes; if it does not, the apply is refused. A safety net
//     that was never checked is not a safety net.
//
//  4. THE WRITE IS VERIFIED THE SAME WAY. `mergeWorkspaceFiles()` returns void and no-ops when
//     Firestore is unavailable, so reporting success off a resolved promise would be a fake success.
//     We read the file back and confirm it changed before telling the user anything did.

import type { Express, Request, Response } from 'express';
import { minifySource, isMinifiable, detectLanguage } from '../lib/codeMinifier';
import { loadWorkspaceFiles, mergeWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { buildHistoryStore } from '../project/BuildHistoryStore';
import { verifyFirebaseToken } from '../lib/authMiddleware';

/** Cap a single minify request so one huge paste cannot tie up the server. */
export const MAX_MINIFY_BYTES = 2 * 1024 * 1024;

/** How many recent restore points to search when confirming ours actually landed. */
const RESTORE_POINT_SEARCH_DEPTH = 5;

/**
 * Build the workspace id for one of THIS user's apps.
 *
 * Every Pro v5 app is stored as `agentv3-{uid}-{sessionId}`, so deriving the id from the verified uid
 * (rather than accepting one from the client) makes cross-account access impossible by construction
 * instead of by check. Returns null when the session id is not a plausible id.
 */
export function sessionWorkspaceId(uid: string, sessionId: string): string | null {
  if (!uid || !/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return null;
  if (!sessionId || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) return null;
  return `agentv3-${uid}-${sessionId}`;
}

interface HistoryDeps {
  save: typeof buildHistoryStore.save;
  list: typeof buildHistoryStore.list;
  get: typeof buildHistoryStore.get;
}

const realHistory: HistoryDeps = {
  save: (...a) => buildHistoryStore.save(...a),
  list: (...a) => buildHistoryStore.list(...a),
  get: (...a) => buildHistoryStore.get(...a),
};

/**
 * Save a restore point AND prove it can actually restore this file.
 *
 * The proof is the whole point: we re-read the stored snapshot and require it to hold `original`
 * verbatim for `filePath`. That catches all three ways the net could be silently missing — Firestore
 * unavailable, the write failing inside the store's own try/catch, and the snapshot being truncated
 * past this file to fit the document size limit.
 *
 * Returns the restorable version's id, or null if no verified restore point exists.
 */
export async function saveVerifiedRestorePoint(
  sessionId: string,
  files: Record<string, string>,
  filePath: string,
  original: string,
  deps: HistoryDeps = realHistory,
): Promise<string | null> {
  try {
    await deps.save(sessionId, {
      commitMessage: `Before optimising ${filePath}`,
      fileCount: Object.keys(files).length,
      files,
      isEdit: true,
      tier: 'manual',
      ok: true,
    });
    // Newest first. Ours should be first, but a concurrent save could beat us — and either way the
    // question that matters is "does a restore point holding this exact file exist NOW?", not "was it
    // the one I just wrote".
    const recent = (await deps.list(sessionId)).slice(0, RESTORE_POINT_SEARCH_DEPTH);
    for (const meta of recent) {
      const full = await deps.get(sessionId, meta.id);
      if (full?.files?.[filePath] === original) return meta.id;
    }
    return null;
  } catch {
    return null;
  }
}

interface WorkspaceDeps {
  load: typeof loadWorkspaceFiles;
  merge: typeof mergeWorkspaceFiles;
}

const realWorkspace: WorkspaceDeps = {
  load: (...a) => loadWorkspaceFiles(...a),
  merge: (...a) => mergeWorkspaceFiles(...a),
};

/**
 * Write one file and confirm it really changed.
 *
 * `mergeWorkspaceFiles` resolves happily when there is no database and when the content exceeds its
 * own per-file cap, so the resolved promise means nothing on its own. Reading the file back is the
 * only honest way to tell the user their app changed.
 */
export async function writeFileVerified(
  workspaceId: string,
  filePath: string,
  code: string,
  deps: WorkspaceDeps = realWorkspace,
): Promise<boolean> {
  try {
    await deps.merge(workspaceId, { [filePath]: code });
    const after = await deps.load(workspaceId);
    return after[filePath] === code;
  } catch {
    return false;
  }
}

export function registerMinifyRoutes(app: Express): void {
  /**
   * Minify code and report the result. Works for pasted code AND for a file the caller already has —
   * it never touches storage, so it is safe to call as often as the UI likes.
   */
  app.post('/api/minify', async (req: Request, res: Response) => {
    const { code, filename, keepConsole } = (req.body || {}) as Record<string, unknown>;
    if (typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ error: 'Nothing to minify — send some code.' });
    }
    if (Buffer.byteLength(code, 'utf8') > MAX_MINIFY_BYTES) {
      return res.status(413).json({ error: 'That file is too large to optimise here (over 2 MB).' });
    }
    const result = await minifySource(code, typeof filename === 'string' && filename ? filename : 'input.js', {
      keepConsole: keepConsole === true,
    });
    return res.json(result);
  });

  /**
   * List the minifiable files of one of the caller's own apps, so the UI can show a real file list
   * instead of asking the user to paste something.
   */
  app.get('/api/minify/files', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in to see your apps.' });
    const workspaceId = sessionWorkspaceId(uid, String(req.query.sessionId || ''));
    if (!workspaceId) return res.status(400).json({ error: 'Which app?' });
    try {
      const files = await loadWorkspaceFiles(workspaceId);
      const list = Object.keys(files)
        .filter(isMinifiable)
        .sort()
        .map((path) => ({
          path,
          bytes: Buffer.byteLength(files[path] || '', 'utf8'),
          language: detectLanguage(path),
        }));
      return res.json({ files: list });
    } catch {
      return res.status(502).json({ error: 'Could not read that app’s files.' });
    }
  });

  /** Read one file's current source, so the editor shows the real thing rather than a paste. */
  app.get('/api/minify/file', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in to open your app’s files.' });
    const workspaceId = sessionWorkspaceId(uid, String(req.query.sessionId || ''));
    if (!workspaceId) return res.status(400).json({ error: 'Which app?' });
    const path = String(req.query.path || '');
    if (!path) return res.status(400).json({ error: 'Which file?' });
    try {
      const files = await loadWorkspaceFiles(workspaceId);
      const code = files[path];
      if (typeof code !== 'string') return res.status(404).json({ error: 'That file is no longer in the app.' });
      return res.json({ path, code, language: detectLanguage(path) });
    } catch {
      return res.status(502).json({ error: 'Could not open that file.' });
    }
  });

  /**
   * Write the optimised version back into the user's real app file.
   *
   * The order is deliberate and each step gates the next: derive the workspace from the verified uid →
   * refuse files that must not be minified → load the CURRENT source → minify → save a restore point
   * and PROVE it holds the original → write → PROVE the write landed. Nothing is reported as done
   * until it has been read back.
   */
  app.post('/api/minify/apply', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in before changing your app.' });

    const { sessionId, path, keepConsole } = (req.body || {}) as Record<string, unknown>;
    const sid = String(sessionId || '');
    const workspaceId = sessionWorkspaceId(uid, sid);
    if (!workspaceId) return res.status(400).json({ error: 'Which app should be optimised?' });

    const filePath = String(path || '');
    if (!filePath) return res.status(400).json({ error: 'Which file should be optimised?' });
    if (!isMinifiable(filePath)) {
      return res.status(400).json({
        error: 'This file must not be optimised — it is either already optimised or read directly by the build tools.',
      });
    }

    try {
      const files = await loadWorkspaceFiles(workspaceId);
      const original = files[filePath];
      if (typeof original !== 'string') return res.status(404).json({ error: 'That file is no longer in the app.' });

      // Minify BEFORE touching anything, so a file that cannot be minified is never checkpointed or
      // written — a pointless restore point is confusing, and a failed write is worse.
      const result = await minifySource(original, filePath, { keepConsole: keepConsole === true });
      if (!result.ok) {
        return res.status(422).json({ error: `That file could not be optimised: ${result.error}`, detail: result.error });
      }
      if (result.savedBytes <= 0) {
        return res.json({ ok: true, applied: false, reason: 'Already as small as it can get — nothing was changed.' });
      }

      // THE SAFETY NET — and the proof that it exists. Minified code cannot be un-minified, so an
      // unverified restore point is worth nothing. No verified restore point ⇒ no write.
      const versionId = await saveVerifiedRestorePoint(sid, files, filePath, original);
      if (!versionId) {
        return res.status(503).json({
          error: 'Could not save a restore point you could undo from, so nothing was changed. Your app is exactly as it was — please try again.',
        });
      }

      const written = await writeFileVerified(workspaceId, filePath, result.code);
      if (!written) {
        return res.status(502).json({ error: 'The change could not be saved, so your app is unchanged. Please try again.' });
      }

      return res.json({
        ok: true,
        applied: true,
        path: filePath,
        versionId,
        originalBytes: result.originalBytes,
        minifiedBytes: result.minifiedBytes,
        savedBytes: result.savedBytes,
        savedPercent: result.savedPercent,
        undoHint: 'A restore point was saved first — you can undo this any time from Versioning (Time Machine).',
      });
    } catch {
      return res.status(502).json({ error: 'Could not update that file. Your app is unchanged.' });
    }
  });
}
