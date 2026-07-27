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
//  3. A RESTORE POINT IS SAVED FIRST **AND VERIFIED BY READING IT BACK**, and 4. THE WRITE IS
//     VERIFIED THE SAME WAY. Both stores fail silently — `buildHistoryStore.save()` swallows every
//     error and truncates large snapshots, `mergeWorkspaceFiles()` no-ops without a database — so
//     neither can be taken on trust. That sequence now lives in ONE shared module used by every tool
//     that writes into a user's app (src/server/lib/workspaceEdit.ts), rather than a copy per tool.

import type { Express, Request, Response } from 'express';
import { minifySource, isMinifiable, detectLanguage } from '../lib/codeMinifier';
import { loadWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { sessionWorkspaceId, applyFilesToApp } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';

/** Cap a single minify request so one huge paste cannot tie up the server. */
export const MAX_MINIFY_BYTES = 2 * 1024 * 1024;

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
      // unverified restore point is worth nothing. The shared apply sequence refuses to write without
      // one, and reads the write back before reporting success.
      const applied = await applyFilesToApp(
        workspaceId,
        sid,
        { [filePath]: result.code },
        `Before optimising ${filePath}`,
      );
      if (!applied.ok) {
        return res.status(applied.status).json({ error: applied.error });
      }

      return res.json({
        ok: true,
        applied: true,
        path: filePath,
        versionId: applied.versionId,
        originalBytes: result.originalBytes,
        minifiedBytes: result.minifiedBytes,
        savedBytes: result.savedBytes,
        savedPercent: result.savedPercent,
        undoHint: applied.undoHint,
      });
    } catch {
      return res.status(502).json({ error: 'Could not update that file. Your app is unchanged.' });
    }
  });
}
