import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes user_workspaces (server-only).
import { getServerDb as getDb } from '../lib/serverDb';
import { readWorkspaceTx, saveWorkspaceTx, type SyncTx } from '../project/syncTransaction';
import { requireUserMatch } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';
import { routeParam, routeParams } from '../lib/expressCompat';

/**
 * Cross-device cloud sync routes (chat sessions + last generated app), stored in
 * Firestore. Phase 2 redesign: workspaces are now persisted LOSSLESSLY via the
 * chunked codec (`WorkspaceStore`) — the old slimSession logic that dropped any
 * file > 60KB and truncated whole workspaces past 800KB is gone.
 *
 * Storage layout:
 *   user_workspaces/{userId}           → v2 manifest { version, chunkCount, totalBytes, updatedAt }
 *   user_workspaces/{userId}__c{i}     → { data: <chunk> }
 * Legacy v1 single-doc workspaces are still read transparently (backward compat).
 */

// The size ceiling and the chunk id now live with the CODEC (`WorkspaceStore`), not here. They were
// defined privately in this file, which is how the only written description of the layout — the one in
// `WorkspaceStore`'s header — came to say `{userId}_chunk_{i}` while every real document was
// `{userId}__c{i}`, with nothing able to notice. The eraser (`syncWorkspaceErase.ts`) now deletes
// through the same builder this route writes through (Q-763).

export function registerSyncRoutes(app: Express): void {
  // SECURITY (audit): require the verified Firebase token uid to match :userId — without this any
  // caller could read (GET) or overwrite (POST) ANY account's entire workspace by uid. The client
  // sends the Bearer token via authedHeaders(); VITEST skips the check (see requireUserMatch).
  app.get('/api/sync/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = routeParams(req.params);
    if (!db) return res.json({ sessions: [], lastApp: '', updatedAt: null });
    try {
      // ONE consistent snapshot — the manifest and every chunk it names, in a read-only transaction with a
      // single batched chunk read (audit 2026-10-11, D7). Read piecemeal, a load between a save's chunk writes
      // and its manifest could decode chunks from two different saves.
      const ref = (id: string) => db.collection('user_workspaces').doc(id);
      const stored = await db.runTransaction((tx: SyncTx<unknown>) => readWorkspaceTx(tx, ref, userId), { readOnly: true });
      if (!stored.exists) return res.json({ sessions: [], lastApp: '', updatedAt: null });
      return res.json({ sessions: stored.payload.sessions, lastApp: stored.payload.lastApp, updatedAt: stored.updatedAt });
    } catch (err: any) {
      console.error('[API SYNC GET ERROR]:', err?.message || err);
      return sendSafeError(res, 500, 'Sync load failed. Please try again.', err, 'sync get');
    }
  });

  app.post('/api/sync/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = routeParams(req.params);
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    if (!db) return res.json({ ok: false, reason: 'db_unavailable' });
    try {
      const sessions = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
      const lastApp = typeof req.body?.lastApp === 'string' ? req.body.lastApp : '';

      // P4.4 — MERGE rather than blindly overwrite: last-write-wins PER SESSION, so a device saving a stale
      // view can never drop another device's newer sessions. 🔴 AUDIT 2026-10-11 (D7): that merge only holds
      // if the read it merges against is still current when the write lands. It was a plain read, then up to
      // ten plain writes — two devices saving together each merged against the state BEFORE the other's
      // write, and the second dropped the first's sessions. Read, merge and write are now ONE transaction,
      // which Firestore retries on a conflicting write, so the merge always sees the latest state.
      const ref = (id: string) => db.collection('user_workspaces').doc(id);
      const outcome = await db.runTransaction((tx: SyncTx<unknown>) => saveWorkspaceTx(tx, ref, userId, { sessions, lastApp }));
      if (!outcome.ok) {
        return res.status(413).json({ error: 'Workspace too large to sync', totalBytes: outcome.totalBytes, limit: outcome.limit });
      }
      return res.json({
        ok: true,
        stored: outcome.stored,
        chunks: outcome.chunks,
        totalBytes: outcome.totalBytes,
        updatedAt: outcome.updatedAt,
      });
    } catch (err: any) {
      console.error('[API SYNC POST ERROR]:', err?.message || err);
      return sendSafeError(res, 500, 'Sync save failed. Please try again.', err, 'sync save');
    }
  });
}
