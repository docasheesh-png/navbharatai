import type { Express, Request, Response } from 'express';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { encodeWorkspace, decodeWorkspace } from '../project/WorkspaceStore';

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

// Hard safety ceiling to avoid unbounded writes; generous (≈ many MB of code).
const MAX_WORKSPACE_BYTES = 8_000_000;

const chunkDocId = (userId: string, i: number) => `${userId}__c${i}`;

export function registerSyncRoutes(app: Express): void {
  app.get('/api/sync/:userId', async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    if (!db) return res.json({ sessions: [], lastApp: '', updatedAt: null });
    try {
      const snap = await getDoc(doc(db, 'user_workspaces', userId));
      if (!snap.exists()) return res.json({ sessions: [], lastApp: '', updatedAt: null });
      const data = snap.data();

      // v2: chunked, lossless payload
      if (data.version === 2 && typeof data.chunkCount === 'number') {
        const chunks: string[] = [];
        for (let i = 0; i < data.chunkCount; i++) {
          const cs = await getDoc(doc(db, 'user_workspaces', chunkDocId(userId, i)));
          chunks.push(cs.exists() ? (cs.data().data || '') : '');
        }
        const payload = decodeWorkspace<{ sessions?: any[]; lastApp?: string }>(chunks) || {};
        return res.json({
          sessions: payload.sessions || [],
          lastApp: payload.lastApp || '',
          updatedAt: data.updatedAt || null,
        });
      }

      // Legacy v1: single inline doc (read transparently)
      return res.json({
        sessions: data.sessions || [],
        lastApp: data.lastApp || '',
        updatedAt: data.updatedAt || null,
      });
    } catch (err: any) {
      console.error('[API SYNC GET ERROR]:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Sync load failed' });
    }
  });

  app.post('/api/sync/:userId', async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    if (!db) return res.json({ ok: false, reason: 'db_unavailable' });
    try {
      const sessions = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
      const lastApp = typeof req.body?.lastApp === 'string' ? req.body.lastApp : '';

      const encoded = encodeWorkspace({ sessions, lastApp });
      if (encoded.manifest.totalBytes > MAX_WORKSPACE_BYTES) {
        return res.status(413).json({
          error: 'Workspace too large to sync',
          totalBytes: encoded.manifest.totalBytes,
          limit: MAX_WORKSPACE_BYTES,
        });
      }

      // Find how many chunks existed before (to clean up stale chunk docs).
      let prevChunkCount = 0;
      const prevSnap = await getDoc(doc(db, 'user_workspaces', userId));
      if (prevSnap.exists() && typeof prevSnap.data().chunkCount === 'number') {
        prevChunkCount = prevSnap.data().chunkCount;
      }

      // Write all chunk docs.
      for (let i = 0; i < encoded.chunks.length; i++) {
        await setDoc(doc(db, 'user_workspaces', chunkDocId(userId, i)), { data: encoded.chunks[i] });
      }
      // Delete any leftover chunks from a previously-larger save.
      for (let i = encoded.chunks.length; i < prevChunkCount; i++) {
        await deleteDoc(doc(db, 'user_workspaces', chunkDocId(userId, i)));
      }

      // Write the manifest last (so a partial write is never read as complete).
      await setDoc(doc(db, 'user_workspaces', userId), {
        userId,
        ...encoded.manifest,
      });

      return res.json({
        ok: true,
        stored: sessions.length,
        chunks: encoded.chunks.length,
        totalBytes: encoded.manifest.totalBytes,
        updatedAt: encoded.manifest.updatedAt,
      });
    } catch (err: any) {
      console.error('[API SYNC POST ERROR]:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Sync save failed' });
    }
  });
}
