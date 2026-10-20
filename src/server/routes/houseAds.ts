// The public half of the admin's house ads: what a screen asks for, and the picture it draws.
//
//   GET /api/ads/:placement   → { ad: ServedHouseAd | null }
//   GET /api/ads/image/:id    → the picture, with a cache lifetime
//
// The admin half (create, list, edit, delete) is in routes/admin.ts behind the admin token.
//
// 🔒 `{ ad: null }` IS THE ANSWER TO EVERY DOUBT. No ad configured, a paid account, a database that did not
// answer, a wallet that could not be read, a token that was sent but did not verify — each one is the same
// empty answer, and the screen draws nothing at all. An ad is never guessed, and never shown to somebody
// who might have paid.
//
// 🔒 A TOKEN THAT FAILS TO VERIFY IS NOT AN ANONYMOUS VISITOR. `verifyFirebaseToken` returns null for both
// "no header" and "header with an expired token", and treating the second as anonymous would show an ad to
// a paying customer whose token merely expired. So a request that CARRIES a bearer token and yields no uid
// gets no ad.

import type { Express, Request, Response } from 'express';
import { getServerDb } from '../lib/serverDb';
import { rateLimiter, verifyFirebaseToken } from '../lib/authMiddleware';
import { houseAdAudience } from '../lib/houseAdAudience';
import { servedAdFor, readAdImage, AD_ID_RE } from '../lib/houseAdStore';
import { isHouseAdPlacement } from '../../lib/houseAds';

const NO_AD = { ad: null } as const;

export function registerHouseAdRoutes(app: Express): void {
  const limiter = rateLimiter({ name: 'house-ads', authed: 600, anon: 300, noun: 'requests' });

  app.get('/api/ads/image/:id', limiter, async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!AD_ID_RE.test(id)) return res.status(404).end();
    try {
      const db = getServerDb() as any;
      if (!db) return res.status(503).end();
      const img = await readAdImage(db, id);
      if (!img) return res.status(404).end();
      res.setHeader('Content-Type', img.mime);
      // The URL carries `?v=<version>`, so a changed picture is a NEW url and this one never goes stale.
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.send(img.bytes);
    } catch {
      res.status(502).end();
    }
  });

  app.get('/api/ads/:placement', limiter, async (req: Request, res: Response) => {
    const placement = String(req.params.placement || '');
    if (!isHouseAdPlacement(placement)) return res.status(404).json({ error: 'That is not a place an ad can appear.' });
    // The answer depends on WHO asks, so no shared cache may keep it.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Authorization');
    try {
      const carriesToken = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ');
      const uid = await verifyFirebaseToken(req);
      if (carriesToken && !uid) return res.json(NO_AD);
      if ((await houseAdAudience(uid)) !== 'ads') return res.json(NO_AD);
      const db = getServerDb() as any;
      if (!db) return res.json(NO_AD);
      return res.json({ ad: await servedAdFor(db, placement) });
    } catch {
      return res.json(NO_AD);
    }
  });
}
