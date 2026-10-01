import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, resolveVerifiedEmail } from '../lib/authMiddleware';
import { listNotificationsForUser, markNotificationsRead, dismissNotifications } from '../lib/AdminNotificationStore';
import { listSocialInbox, updateSocialInbox } from '../lib/appMartSocialStore';
import { isSocialInboxId } from '../lib/appMartSocialRules';

/**
 * App Mart notifications ("Ravi liked your app", "Asha commented …") are delivered through THIS inbox,
 * so the panel every client already draws — including phone apps installed before App Mart social
 * existed — shows them with no new screen. They live in their OWN per-person collection and carry
 * their OWN read state (appMartSocialStore.ts), and the two are split here by id shape:
 *
 *   · the broadcast store reads the latest 50 messages platform-wide and filters per person, so one
 *     popular app's likes written there would push everybody's real messages out of that window;
 *   · its read list keeps the newest 500 ids, so a stream of like-notification ids would rotate old
 *     broadcast ids out of it and make them unread again.
 *
 * Neither can happen when the social rows never enter that store.
 */
function splitIds(ids: string[]): { social: string[]; admin: string[] } {
  const social: string[] = [];
  const admin: string[] = [];
  for (const id of ids) (isSocialInboxId(id) ? social : admin).push(id);
  return { social, admin };
}

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
    const [broadcasts, social] = await Promise.all([
      listNotificationsForUser(uid, email),
      listSocialInbox(uid).catch(() => []),
    ]);
    const notifications = [...broadcasts, ...social].sort((a, b) => b.createdAt - a.createdAt);
    res.json({ notifications, unread: notifications.filter((n) => !n.read).length });
  });

  // Mark one or more of the user's notifications as read.
  app.post('/api/notifications/read', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const ids = Array.isArray((req.body as { ids?: unknown[] })?.ids) ? ((req.body as { ids: unknown[] }).ids.filter((x): x is string => typeof x === 'string')) : [];
    const { social, admin } = splitIds(ids);
    await Promise.all([markNotificationsRead(uid, admin), updateSocialInbox(uid, social, 'readVersion')]);
    res.json({ ok: true });
  });

  /**
   * Delete notifications for THIS user — by EXPLICIT ID ONLY.
   *
   * 🔴 THERE IS NO "DELETE EVERYTHING" REQUEST, AND THAT IS THE POINT (2026-09-11). The first version
   * accepted `{ all: true }` and resolved it server-side into every message the user could see. One
   * call, whole inbox gone — and the admin lost theirs to a single mis-tap on the button that sent it.
   * The capability is removed rather than merely hidden behind a nicer UI, because a destructive
   * one-shot endpoint that no screen uses is a loaded gun waiting for the next caller.
   *
   * Clearing an inbox is still possible: the client ticks the messages and sends their ids. That is
   * the same outcome reached deliberately, and it is capped at 200 ids per request (the list itself
   * returns at most NOTIFICATIONS_DEFAULT_LIMIT, so a real "select all" is well inside that).
   *
   * Dismissal is per-user — a broadcast is one shared document — so this can only ever empty the
   * caller's own inbox, never anyone else's.
   *
   * Idempotent, and an empty request is a no-op rather than an error: pressing delete twice, or with
   * nothing selected, must never look like a failure.
   */
  app.post('/api/notifications/delete', async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) { res.status(401).json({ error: 'Please sign in.' }); return; }
    const body = (req.body ?? {}) as { ids?: unknown };

    // Bounded: a caller cannot make us write an unbounded id list in one request.
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 128).slice(0, 200)
      : [];

    const { social, admin } = splitIds(ids);
    await Promise.all([dismissNotifications(uid, admin), updateSocialInbox(uid, social, 'dismissedVersion')]);
    res.json({ ok: true, deleted: ids.length });
  });
}
