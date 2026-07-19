import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes user_workspaces (server-only).
import { doc, getDoc, setDoc, deleteDoc, getServerDb as getDb } from '../lib/serverDb';
import { encodeWorkspace, decodeWorkspace } from '../project/WorkspaceStore';
import { mergeWorkspaceState, type WorkspacePayload } from '../project/SyncMerge';
import { requireUserMatch } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';

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
  // SECURITY (audit): require the verified Firebase token uid to match :userId — without this any
  // caller could read (GET) or overwrite (POST) ANY account's entire workspace by uid. The client
  // sends the Bearer token via authedHeaders(); VITEST skips the check (see requireUserMatch).
  app.get('/api/sync/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
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
      return sendSafeError(res, 500, 'Sync load failed. Please try again.', err, 'sync get');
    }
  });

  app.post('/api/sync/:userId', requireUserMatch('userId'), async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'User is not authenticated' });
    if (!db) return res.json({ ok: false, reason: 'db_unavailable' });
    try {
      const sessions = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
      const lastApp = typeof req.body?.lastApp === 'string' ? req.body.lastApp : '';

      // P4.4 — read the existing stored workspace so we can MERGE rather than blindly
      // overwrite. This enforces last-write-wins PER SESSION on the server, so a device
      // saving a stale view can never drop another device's newer sessions (lost-update).
      let prevChunkCount = 0;
      let storedPayload: WorkspacePayload = { sessions: [], lastApp: '' };
      const prevSnap = await getDoc(doc(db, 'user_workspaces', userId));
      if (prevSnap.exists()) {
        const pdata = prevSnap.data();
        try {
          if (pdata.version === 2 && typeof pdata.chunkCount === 'number') {
            prevChunkCount = pdata.chunkCount;
            const prevChunks: string[] = [];
            for (let i = 0; i < pdata.chunkCount; i++) {
              const cs = await getDoc(doc(db, 'user_workspaces', chunkDocId(userId, i)));
              prevChunks.push(cs.exists() ? (cs.data().data || '') : '');
            }
            const decoded = decodeWorkspace<{ sessions?: any[]; lastApp?: string }>(prevChunks) || {};
            storedPayload = { sessions: decoded.sessions || [], lastApp: decoded.lastApp || '' };
          } else {
            // Legacy v1 inline doc.
            storedPayload = { sessions: pdata.sessions || [], lastApp: pdata.lastApp || '' };
          }
        } catch {
          // Corrupt/unreadable prior state → fall back to a blind write (never lose this save).
          storedPayload = { sessions: [], lastApp: '' };
        }
      }

      const merged = mergeWorkspaceState(storedPayload, { sessions, lastApp });

      const encoded = encodeWorkspace(merged);
      if (encoded.manifest.totalBytes > MAX_WORKSPACE_BYTES) {
        return res.status(413).json({
          error: 'Workspace too large to sync',
          totalBytes: encoded.manifest.totalBytes,
          limit: MAX_WORKSPACE_BYTES,
        });
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
        stored: merged.sessions.length, // count AFTER the server-side merge
        chunks: encoded.chunks.length,
        totalBytes: encoded.manifest.totalBytes,
        updatedAt: encoded.manifest.updatedAt,
      });
    } catch (err: any) {
      console.error('[API SYNC POST ERROR]:', err?.message || err);
      return sendSafeError(res, 500, 'Sync save failed. Please try again.', err, 'sync save');
    }
  });
}
