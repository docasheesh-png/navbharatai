import type { Express, Request, Response } from 'express';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getDb } from '../lib/db';

/**
 * Cross-device cloud sync routes (chat sessions + last generated app), stored in
 * Firestore `user_workspaces/{userId}`. Extracted from the server.ts monolith
 * (Phase 1) with behavior unchanged.
 *
 * NOTE: the lossy slimming (60KB/file, 800KB/workspace, 60 msgs) is a known
 * limitation flagged in the audit — it is redesigned in Phase 2 (real project
 * model + per-file storage). Kept as-is here to preserve behavior.
 */
const WORKSPACE_MAX_BYTES = 800_000; // stay safely under Firestore's 1 MB doc limit

// Strip large/embedded blobs from a session so the workspace doc stays small.
const slimSession = (s: any) => {
  if (!s || typeof s !== 'object') return s;
  const stripBlobs = (str: any) =>
    typeof str === 'string'
      ? str.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '(binary)')
      : str;
  const slimMsg = (m: any) => ({
    id: m?.id,
    sender: m?.sender,
    text: stripBlobs(String(m?.text || '')).slice(0, 4000),
    timestamp: m?.timestamp,
    modelUsed: m?.modelUsed,
  });
  const slimFiles: Record<string, string> = {};
  if (s.files && typeof s.files === 'object') {
    for (const [k, v] of Object.entries(s.files)) {
      const cleaned = stripBlobs(String(v ?? ''));
      if (cleaned.length <= 60_000) slimFiles[k] = cleaned; // skip giant files
    }
  }
  return {
    id: s.id,
    title: s.title,
    messages: Array.isArray(s.messages) ? s.messages.slice(-60).map(slimMsg) : [],
    restoredMessages: Array.isArray(s.restoredMessages) ? s.restoredMessages.slice(-60).map(slimMsg) : [],
    files: slimFiles,
    lastUpdated: s.lastUpdated,
    isPinned: s.isPinned,
    mode: s.mode,
    agent: s.agent,
    originalAgent: s.originalAgent,
    currentAgent: s.currentAgent,
    memorySummary: typeof s.memorySummary === 'string' ? s.memorySummary.slice(0, 4000) : s.memorySummary,
  };
};

export function registerSyncRoutes(app: Express): void {
  app.get('/api/sync/:userId', async (req: Request, res: Response) => {
    const db = getDb() as any;
    const { userId } = req.params;
    if (!db) return res.json({ sessions: [], lastApp: '', updatedAt: null });
    try {
      const ref = doc(db, 'user_workspaces', userId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return res.json({ sessions: [], lastApp: '', updatedAt: null });
      const data = snap.data();
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
      const incoming = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
      let lastApp = typeof req.body?.lastApp === 'string' ? req.body.lastApp : '';
      if (lastApp.length > 200_000) lastApp = lastApp.slice(0, 200_000);

      // Newest first, then slim, then drop oldest until under the size budget
      let slim = incoming
        .map(slimSession)
        .sort((a: any, b: any) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime());

      const fits = (arr: any[]) =>
        Buffer.byteLength(JSON.stringify({ sessions: arr, lastApp }), 'utf8') <= WORKSPACE_MAX_BYTES;

      while (slim.length > 0 && !fits(slim)) slim = slim.slice(0, -1);

      const payload = {
        userId,
        sessions: slim,
        lastApp,
        updatedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'user_workspaces', userId), payload);
      return res.json({ ok: true, stored: slim.length, updatedAt: payload.updatedAt });
    } catch (err: any) {
      console.error('[API SYNC POST ERROR]:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Sync save failed' });
    }
  });
}
