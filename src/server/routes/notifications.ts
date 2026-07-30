import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, resolveVerifiedEmail } from '../lib/authMiddleware';
import { listNotificationsForUser, markNotificationsRead } from '../lib/AdminNotificationStore';

/**
 * User-facing notification delivery (admin 2026-07-30). The admin sends messages from the admin panel
 * (to ALL users or a specific user); these endpoints deliver them to the signed-in user and track
 * read state. Auth is the user's Firebase token (NOT admin) — a user only ever sees notifications
 * targeted at everyone or at them specifically (enforced server-side by notificationMatchesUser).
 */
export function registerNotificationRoutes(app: Express): void {
  // The signed-in user's notifications (broadcasts + those targeted at them), newest first.
  app.get('/api/notifications', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const email = await resolveVerifiedEmail(uid).catch(() => null);
    const notifications = await listNotificationsForUser(uid, email);
    res.json({ notifications, unread: notifications.filter((n) => !n.read).length });
  });

  // Mark one or more of the user's notifications as read.
  app.post('/api/notifications/read', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const ids = Array.isArray((req.body as { ids?: unknown[] })?.ids) ? ((req.body as { ids: unknown[] }).ids.filter((x): x is string => typeof x === 'string')) : [];
    await markNotificationsRead(uid, ids);
    res.json({ ok: true });
  });
}
