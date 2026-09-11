import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, resolveVerifiedEmail } from '../lib/authMiddleware';
import { listNotificationsForUser, markNotificationsRead, dismissNotifications } from '../lib/AdminNotificationStore';

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

  /**
   * Delete notifications for THIS user (admin 2026-09-11: "delete karne ka bhi to button do — select
   * delete, select all delete").
   *
   * `{ ids: [...] }` deletes those; `{ all: true }` deletes everything the user can currently see.
   *
   * 🔒 "ALL" IS RESOLVED SERVER-SIDE FROM WHAT THIS USER CAN SEE — never from a list the client sends
   * and never as "every notification in the system". The store's dismissal is per-user (a broadcast is
   * one shared document), so this can only ever empty the caller's own inbox.
   *
   * Idempotent, and an empty request is a no-op rather than an error: pressing delete twice, or with
   * nothing selected, must never look like a failure.
   */
  app.post('/api/notifications/delete', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const body = (req.body ?? {}) as { ids?: unknown; all?: unknown };

    let ids: string[];
    if (body.all === true) {
      const email = await resolveVerifiedEmail(uid).catch(() => null);
      ids = (await listNotificationsForUser(uid, email)).map((n) => n.id);
    } else {
      // Bounded: a caller cannot make us write an unbounded id list in one request.
      ids = Array.isArray(body.ids)
        ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128).slice(0, 200)
        : [];
    }

    await dismissNotifications(uid, ids);
    res.json({ ok: true, deleted: ids.length });
  });
}
