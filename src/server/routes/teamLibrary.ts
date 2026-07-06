import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { listMembers } from '../lib/TeamStore';
import { teamLibraryStore, buildLibraryItem, normalizeKind, type LibraryKind } from '../lib/TeamLibraryStore';

/**
 * P-COLLAB.4 — team-scoped shared library (prompts / templates / components).
 *
 *   GET    /api/team/:teamId/library[?kind=prompt|template|component]  — list (active members)
 *   POST   /api/team/:teamId/library    { kind, title, content }       — add  (active members)
 *   DELETE /api/team/:teamId/library/:itemId                           — remove (active members)
 *
 * Access is fail-closed: only the team owner (teamId === uid) or an ACTIVE member may read/contribute.
 */

/** Resolve the caller and confirm they are an active member of `teamId`. Returns the uid or null. */
async function activeMemberUid(req: Request, teamId: string): Promise<string | null> {
  const uid = await verifyFirebaseToken(req);
  if (!uid || !teamId) return null;
  if (uid === teamId) return uid; // the owner
  const members = await listMembers(teamId).catch(() => []);
  return members.some((m) => m.uid === uid && m.status === 'active') ? uid : null;
}

export function registerTeamLibraryRoutes(app: Express): void {
  app.get('/api/team/:teamId/library', async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    const uid = await activeMemberUid(req, teamId);
    if (!uid) return res.status(403).json({ error: 'Active team membership required.' });
    const kind = typeof req.query.kind === 'string' ? normalizeKind(req.query.kind) : undefined;
    const items = await teamLibraryStore.list(teamId, kind as LibraryKind | undefined);
    return res.json({ items });
  });

  app.post('/api/team/:teamId/library', async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    const uid = await activeMemberUid(req, teamId);
    if (!uid) return res.status(403).json({ error: 'Active team membership required.' });
    const item = buildLibraryItem({
      id: crypto.randomBytes(9).toString('base64url'),
      teamId, kind: req.body?.kind, title: req.body?.title, content: req.body?.content,
      createdBy: uid, now: Date.now(),
    });
    if (!item) return res.status(400).json({ error: 'A non-empty title and content are required.' });
    const ok = await teamLibraryStore.add(item);
    if (!ok) return res.status(503).json({ error: 'Could not save the item (storage unavailable).' });
    return res.status(201).json({ item });
  });

  app.delete('/api/team/:teamId/library/:itemId', async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    const uid = await activeMemberUid(req, teamId);
    if (!uid) return res.status(403).json({ error: 'Active team membership required.' });
    const removed = await teamLibraryStore.remove(teamId, String(req.params.itemId || ''));
    if (!removed) return res.status(404).json({ error: 'Item not found.' });
    return res.json({ ok: true });
  });
}
