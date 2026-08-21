import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { listMembers } from '../lib/TeamStore';
import { teamLibraryStore, buildLibraryItem, normalizeKind, type LibraryKind } from '../lib/TeamLibraryStore';
import { resolveMentions } from '../lib/MentionRouter';
import { mentionNotificationStore, deliverMentions } from '../lib/MentionNotificationStore';

/**
 * P-COLLAB.4 — team-scoped shared library (prompts / templates / components).
 *
 *   GET    /api/team/:teamId/library[?kind=prompt|template|component]  — list (active members)
 *   POST   /api/team/:teamId/library    { kind, title, content }       — add  (active members)
 *   DELETE /api/team/:teamId/library/:itemId                           — remove (active members)
 *
 * P-COLLAB.5 (delivery) / T1-mention-inbox — @mentions are now DELIVERED, not just resolved:
 *   POST   /api/team/:teamId/mentions/notify  { text }  — store a mention notification for each tagged member
 *   GET    /api/notifications                            — the caller's own inbox (per-user)
 *   POST   /api/notifications/read  { ids }              — mark the caller's notifications read
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
  // P-COLLAB.5 (resolution core) — resolve @mentions in a text to the team's ACTIVE members.
  app.post('/api/team/:teamId/mentions/resolve', async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    const uid = await activeMemberUid(req, teamId);
    if (!uid) return res.status(403).json({ error: 'Active team membership required.' });
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    const members = await listMembers(teamId).catch(() => []);
    // The owner is an implicit active member (teamId === owner uid) — include them so @owner resolves.
    const resolvable = [...members.map((m) => ({ uid: m.uid, email: m.email, status: m.status }))];
    res.json(resolveMentions(text, resolvable));
  });

  // P-COLLAB.5 (delivery) — DELIVER an @mention: store a notification in each tagged member's inbox.
  // Called when a message with mentions is actually sent (not on every keystroke preview).
  app.post('/api/team/:teamId/mentions/notify', async (req: Request, res: Response) => {
    const teamId = String(req.params.teamId || '');
    const uid = await activeMemberUid(req, teamId);
    if (!uid) return res.status(403).json({ error: 'Active team membership required.' });
    const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 4000) : '';
    if (!text.trim()) return res.status(400).json({ error: 'text is required.' });
    const members = await listMembers(teamId).catch(() => []);
    const resolvable = members.map((m) => ({ uid: m.uid, email: m.email, status: m.status }));
    const fromEmail = members.find((m) => m.uid === uid)?.email ?? '';
    const notifications = deliverMentions(text, resolvable, {
      fromUid: uid, fromEmail, teamId, now: Date.now(),
      idFor: () => crypto.randomBytes(9).toString('base64url'),
    });
    const delivered = await mentionNotificationStore.addMany(notifications);
    res.json({ delivered, mentioned: notifications.length });
  });

  /**
   * Per-user @mention inbox (NOT team-scoped — the caller reads only their OWN mentions).
   *
   * ⚠️ THE PATH IS `/api/mentions`, NOT `/api/notifications` — and that is the whole bug fix
   * (2026-08-21). This pair used to be registered on `/api/notifications`, which
   * `routes/notifications.ts` ALSO registers for the admin's broadcast inbox. Express hands a
   * duplicated path to whoever registered FIRST and says nothing about the loser, and `server.ts`
   * registers notifications (line ~582) before teamLibrary (~636) — so for every request ever made,
   * these two handlers were unreachable code.
   *
   * What the user saw: `MentionInbox` asks for `json.items`, the admin handler answers with
   * `{ notifications, unread }`, so the mention list was permanently EMPTY while the badge showed the
   * admin inbox's unread count — a number that opened onto nothing. Meanwhile
   * `/api/team/:teamId/mentions/notify` above kept genuinely storing mentions that no reader could
   * ever reach, and "mark all read" wrote into the admin store instead of this one.
   *
   * They stay two separate inboxes on purpose: an admin broadcast is not an @mention, and merging
   * them would put platform announcements inside the IDE's team-collaboration popover.
   */
  app.get('/api/mentions', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign-in required.' });
    const items = await mentionNotificationStore.listForUser(uid);
    res.json({ items, unread: items.filter((n) => !n.read).length });
  });

  app.post('/api/mentions/read', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign-in required.' });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === 'string') : [];
    const ok = await mentionNotificationStore.markRead(uid, ids);
    res.json({ ok });
  });

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
