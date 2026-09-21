/**
 * THE ABOUT PAGE'S ROUTES — one public read, one admin write.
 *
 * `GET  /api/site/about`       → the page, for everybody. No auth: it is a public page.
 * `PUT  /api/admin/site/about` → save the admin's overrides. Admin token required.
 *
 * 🔒 THE READ IS PUBLIC ON PURPOSE AND CARRIES NOTHING PRIVATE. It returns the same words a visitor
 * reads on the screen — the shipped copy with the admin's overrides applied. No key, no email of any
 * user, no configuration. The one address on it is the SUPPORT address, which exists to be published.
 *
 * 🔒 THE GATE IS THE SHARED ONE (`requireAdmin`), never a second hand-rolled check. `adminAuth.ts`'s
 * own header records what happened the last time two route files each invented their own: one of them
 * compared a password in a QUERY STRING. One verification, one place.
 */

import type { Express, Request, Response } from 'express';
import { requireAdmin } from '../lib/adminAuth';
import { readAboutOverrides, writeAboutOverrides } from '../lib/siteAbout';
import { aboutContent } from '../../content/about';

export function registerSiteAboutRoutes(app: Express): void {
  app.get('/api/site/about', async (_req: Request, res: Response) => {
    // Overrides that cannot be read are simply absent — the shipped copy is a complete page by itself,
    // so a Firestore outage shows the About page rather than an error.
    const overrides = await readAboutOverrides();
    res.json({ ok: true, about: aboutContent(overrides), overrides });
  });

  app.put('/api/admin/site/about', requireAdmin, async (req: Request, res: Response) => {
    const saved = await writeAboutOverrides((req.body as { overrides?: unknown })?.overrides ?? req.body);
    if (!saved) {
      // ⚠️ AN HONEST FAILURE, NOT A CHEERFUL 200. The whole point of this change is that an admin edit
      // reaches real users; telling them "saved" when nothing was written would rebuild the exact bug
      // being fixed, one layer further in.
      res.status(503).json({
        ok: false,
        error: 'Could not save — the content store did not accept the write. Nothing was changed.',
      });
      return;
    }
    const overrides = await readAboutOverrides();
    res.json({ ok: true, about: aboutContent(overrides), overrides });
  });
}
