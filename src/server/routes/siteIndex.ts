import type { Express, Request, Response } from 'express';
import { ROBOTS_PATH, SITEMAP_PATH, robotsTxt, sitemapXml, siteOrigin } from '../lib/siteIndex';

/** NavBharatAI's own robots.txt and sitemap.xml (launch checklist 2026-10-04). See lib/siteIndex.ts. */
export function registerSiteIndexRoutes(app: Express): void {
  app.get(ROBOTS_PATH, (_req: Request, res: Response) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(robotsTxt(siteOrigin()));
  });
  app.get(SITEMAP_PATH, (_req: Request, res: Response) => {
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(sitemapXml(siteOrigin()));
  });
}
