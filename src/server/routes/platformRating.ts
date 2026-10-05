// RATE NAVBHARATAI — the routes (rules: lib/platformRatingRules.ts, store: lib/platformRatingStore.ts).
//
//   GET  /api/platform-rating/status    → { ask, rated } for the signed-in user (signed out: never asked)
//   POST /api/platform-rating           → save { stars 1–5, comment?, platform? }
//   POST /api/platform-rating/dismiss   → "Not now": pause the question (3 days, 7, then 30)
//   GET  /api/admin/platform-ratings    → admin only: average, per-star counts, newest ratings with notes
//
// The client asks for the status only after a publish that went live (PlatformRatingHost), so the
// moment is decided there; whether THIS person may be asked is decided here, from their durable record.
import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity, rateLimiter } from '../lib/authMiddleware';
import { requireAdmin } from '../lib/adminAuth';
import { parseRatingSubmission } from '../lib/platformRatingRules';
import { ratingStatus, saveRating, dismissRating, ratingsOverview, RatingUnavailable } from '../lib/platformRatingStore';

export function registerPlatformRatingRoutes(app: Express): void {
  const statusLimiter = rateLimiter({ name: 'platform-rating-status', authed: 120, anon: 60, noun: 'checks', durable: false });
  const writeLimiter = rateLimiter({ name: 'platform-rating-write', authed: 30, anon: 10, noun: 'ratings' });

  app.get('/api/platform-rating/status', statusLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req).catch(() => null);
    if (!me) { res.json({ ask: false, rated: false }); return; }
    res.json(await ratingStatus(me.uid, Date.now()));
  });

  app.post('/api/platform-rating', writeLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req).catch(() => null);
    if (!me) { res.status(401).json({ error: 'Sign in to rate NavBharatAI.' }); return; }
    const sub = parseRatingSubmission(req.body);
    if (!sub) { res.status(400).json({ error: 'Choose from 1 to 5 stars.' }); return; }
    try {
      await saveRating({ uid: me.uid, email: me.email }, sub, Date.now());
      res.json({ ok: true });
    } catch (e) {
      const unavailable = e instanceof RatingUnavailable;
      if (!unavailable) console.warn('[platform-rating] save failed:', e instanceof Error ? e.message : String(e));
      res.status(503).json({ error: 'Your rating could not be saved right now. Please try again in a moment.' });
    }
  });

  app.post('/api/platform-rating/dismiss', writeLimiter, async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req).catch(() => null);
    if (!me) { res.status(401).json({ error: 'Not signed in.' }); return; }
    try {
      await dismissRating(me.uid, Date.now());
      res.json({ ok: true });
    } catch (e) {
      if (!(e instanceof RatingUnavailable)) console.warn('[platform-rating] dismiss failed:', e instanceof Error ? e.message : String(e));
      res.status(503).json({ error: 'Could not save that right now.' });
    }
  });

  app.get('/api/admin/platform-ratings', requireAdmin, async (_req: Request, res: Response) => {
    try {
      res.json(await ratingsOverview(100));
    } catch (e) {
      if (!(e instanceof RatingUnavailable)) console.warn('[platform-rating] overview failed:', e instanceof Error ? e.message : String(e));
      res.status(503).json({ error: 'Ratings could not be read right now.' });
    }
  });
}
