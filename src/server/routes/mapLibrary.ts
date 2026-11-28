// 📚 THE USER'S MAP LIBRARY — list, save and delete the maps a person keeps to reuse in another game (admin 2026-11-27, wave 2 part 2).
//
//   GET    /api/map-library        → { maps: [...] }       this account's saved maps, newest first
//   POST   /api/map-library        → { map }               save { name, plan, preview } (the card the build showed)
//   DELETE /api/map-library/:id    → { ok: true }          delete one of this account's maps
//
// "Use in a new game" is not a route: the screen puts lib/mapPreview.ts useSavedMapPrompt in the composer and the build reads the
// saved map by name for the account it VERIFIED (ToolDispatcher generate_athree_map → savedMapRequest.ts).
//
// 🔒 Every route needs a signed-in account (verifyFirebaseToken); the uid comes from the verified token, never from the body. Someone
// else's map id answers exactly like a missing one (404), so ids cannot be probed. Rate-limited per account; bodies are bounded by
// the store (a name of 60 characters, a preview of at most 160 x 160 cells, 50 maps per account).

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken, rateLimiter } from '../lib/authMiddleware';
import { routeParam } from '../lib/expressCompat';
import { deleteSavedMap, isSavedMapId, listSavedMaps, saveMap, type SavedMap } from '../lib/mapLibraryStore';

/** What the screen receives for one map — never the owner's uid. */
export function publicSavedMap(m: SavedMap): { id: string; name: string; plan: SavedMap['plan']; preview: SavedMap['preview']; createdAt: number } {
  return { id: m.id, name: m.name, plan: m.plan, preview: m.preview, createdAt: m.createdAt };
}

export function registerMapLibraryRoutes(app: Express): void {
  const readLimiter = rateLimiter({ name: 'map-library-read', authed: 600, anon: 0, noun: 'map library reads', durable: false });
  const writeLimiter = rateLimiter({ name: 'map-library-write', authed: 120, anon: 0, noun: 'map library changes', durable: false });

  app.get('/api/map-library', readLimiter, async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to see your saved maps.', needsSignIn: true });
    try {
      const maps = await listSavedMaps(uid);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ maps: maps.map(publicSavedMap) });
    } catch {
      return res.status(502).json({ error: 'Your saved maps could not be loaded just now. Please try again.' });
    }
  });

  app.post('/api/map-library', writeLimiter, async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to save a map.', needsSignIn: true });
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const r = await saveMap(uid, { name: body.name, plan: body.plan, preview: body.preview });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      return res.json({ map: publicSavedMap(r.map) });
    } catch {
      return res.status(502).json({ error: 'The map could not be saved just now. Please try again.' });
    }
  });

  app.delete('/api/map-library/:id', writeLimiter, async (req: Request, res: Response) => {
    const uid = await verifyFirebaseToken(req);
    if (!uid) return res.status(401).json({ error: 'Sign in to delete a map.', needsSignIn: true });
    const id = String(routeParam(req.params.id) || '');
    if (!isSavedMapId(id)) return res.status(404).json({ error: 'That map is not in your library.' });
    try {
      const gone = await deleteSavedMap(uid, id);
      return gone ? res.json({ ok: true }) : res.status(404).json({ error: 'That map is not in your library.' });
    } catch {
      return res.status(502).json({ error: 'The map could not be deleted just now. Please try again.' });
    }
  });
}
