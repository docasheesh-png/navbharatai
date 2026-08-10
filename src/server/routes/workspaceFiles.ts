// The shared "read and change one of my apps" API, used by every Design & Build tool.
//
// WHY (admin 2026-07-27): Multi-Page, Components, Design System, Dark Mode and Figma each had their
// own "put this into my app" button, and each one wrote to the in-memory preview instead of the
// user's real app. They also had no way to CHOOSE which app to work on — they silently operated on
// whatever preview happened to be open. These four routes give all of them one real answer to both
// problems, so no tool has to invent its own (and get it subtly wrong).
//
// Every write goes through `applyFilesToApp`, which saves a restore point and proves it holds the
// originals before overwriting anything, then reads the write back before reporting success. See
// src/server/lib/workspaceEdit.ts for why neither can be taken on trust.

import type { Express, Request, Response } from 'express';
import { loadWorkspaceFiles, listUserWorkspaceApps } from '../AgentV3/WorkspaceFileStore';
import { sessionWorkspaceId, applyFilesToApp } from '../lib/workspaceEdit';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { workspacePrefixFor } from '../lib/workspaceIdentity';

/** Total bytes accepted in one write request. Bounds a single call; the store caps per file too. */
export const MAX_WRITE_REQUEST_BYTES = 4 * 1024 * 1024;

/** Files at most one of these types can be written — a tool has no business writing a binary. */
const WRITABLE = /\.(html?|css|js|jsx|ts|tsx|json|md|txt|svg)$/i;

/**
 * A path is acceptable only if it stays inside the project.
 *
 * The workspace store is a flat key/value map, so a `../` cannot literally escape a directory — but a
 * path like `../../etc/passwd` would still become a real, confusing file in the user's app, and an
 * absolute path would break every tool that reads the tree. Rejecting them keeps the file list honest.
 */
export function isWritablePath(path: string): boolean {
  if (!path || path.length > 400) return false;
  if (path.startsWith('/') || path.includes('\\')) return false;
  if (path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return false;
  if (/(^|\/)package-lock\.json$/i.test(path)) return false; // npm generates this; never hand-write it
  return WRITABLE.test(path);
}

/** Pure: validate a whole write payload, so the route reports ONE clear reason instead of guessing. */
export function validateWritePayload(files: unknown): { ok: true; patch: Record<string, string> } | { ok: false; error: string } {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return { ok: false, error: 'Nothing to save.' };
  }
  const patch: Record<string, string> = {};
  let bytes = 0;
  for (const [path, content] of Object.entries(files as Record<string, unknown>)) {
    if (typeof content !== 'string') return { ok: false, error: `That file has no text content: ${path}` };
    if (!isWritablePath(path)) return { ok: false, error: `This file cannot be written: ${path}` };
    bytes += Buffer.byteLength(path, 'utf8') + Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_WRITE_REQUEST_BYTES) return { ok: false, error: 'That is too much to save in one go.' };
    patch[path] = content;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to save.' };
  return { ok: true, patch };
}

export function registerWorkspaceFileRoutes(app: Express): void {
  /** The apps this user built, so every tool can offer a real "which app?" choice. */
  app.get('/api/workspace/apps', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in to see your apps.' });
    try {
      const prefix = workspacePrefixFor(uid);
      if (!prefix) { res.json({ ok: true, apps: [] }); return; }
      const apps = (await listUserWorkspaceApps(uid)).map((a) => {
        const sessionId = a.workspaceId.startsWith(prefix) ? a.workspaceId.slice(prefix.length) : a.workspaceId;
        const when = a.savedAt > 0 ? new Date(a.savedAt).toISOString().slice(0, 10) : '';
        return {
          sessionId,
          label: `App · ${a.fileCount} file${a.fileCount === 1 ? '' : 's'}${when ? ` · ${when}` : ''}`,
          fileCount: a.fileCount,
          savedAt: a.savedAt,
        };
      });
      return res.json({ apps });
    } catch {
      return res.status(502).json({ error: 'Could not load your apps.' });
    }
  });

  /** The files inside one of the user's apps. */
  app.get('/api/workspace/files', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in to see your app’s files.' });
    const workspaceId = sessionWorkspaceId(uid, String(req.query.sessionId || ''));
    if (!workspaceId) return res.status(400).json({ error: 'Which app?' });
    try {
      const files = await loadWorkspaceFiles(workspaceId);
      const list = Object.keys(files)
        .sort()
        .map((path) => ({ path, bytes: Buffer.byteLength(files[path] || '', 'utf8'), writable: isWritablePath(path) }));
      return res.json({ files: list });
    } catch {
      return res.status(502).json({ error: 'Could not read that app’s files.' });
    }
  });

  /** One file's current source. */
  app.get('/api/workspace/file', async (req: Request, res: Response) => {
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
      return res.json({ path, code });
    } catch {
      return res.status(502).json({ error: 'Could not open that file.' });
    }
  });

  /**
   * Write one or more files into the user's real app.
   *
   * This is the only write path the Design & Build tools have, and it is deliberately narrow: the
   * caller says which app and which files, and the shared apply sequence handles protecting and
   * verifying. A partial success is reported as a failure with the paths named — never as "saved".
   */
  app.post('/api/workspace/write', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Please sign in before changing your app.' });

    const { sessionId, files, label } = (req.body || {}) as Record<string, unknown>;
    const sid = String(sessionId || '');
    const workspaceId = sessionWorkspaceId(uid, sid);
    if (!workspaceId) return res.status(400).json({ error: 'Which app should be changed?' });

    const parsed = validateWritePayload(files);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const name = typeof label === 'string' && label.trim() ? label.trim() : 'Before a change from a NavBharatAI tool';
    const result = await applyFilesToApp(workspaceId, sid, parsed.patch, name);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error, written: result.written });
    }
    return res.json({
      ok: true,
      written: result.written,
      versionId: result.versionId,
      unchanged: result.written.length === 0,
      undoHint: result.undoHint,
    });
  });
}
