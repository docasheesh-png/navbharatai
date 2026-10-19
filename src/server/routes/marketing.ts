import type { Express, Request, Response } from 'express';
import { renderMarketingPage, renderAboutPage } from '../lib/marketingPages';
import { readAboutOverrides } from '../lib/siteAbout';
import { siteOrigin } from '../lib/siteIndex';
import { MARKETING_PAGES, ABOUT_PATH } from '../../content/marketing';

/**
 * NavBharatAI's public product pages, server-rendered (SEO audit 2026-10-18). See lib/marketingPages.ts.
 * Every path is declared in lib/spaFallback.ts (via MARKETING_PATHS) so the SPA catch-all, which is
 * registered first, defers to these handlers instead of answering with the app shell.
 */
export function registerMarketingRoutes(app: Express): void {
  for (const page of MARKETING_PAGES) {
    app.get(page.path, (_req: Request, res: Response) => {
      res.set('Cache-Control', 'public, max-age=600');
      res.type('html').send(renderMarketingPage(page, siteOrigin()));
    });
  }
  app.get(ABOUT_PATH, async (_req: Request, res: Response) => {
    // readAboutOverrides NEVER throws: an unreachable store degrades to the full shipped page.
    const overrides = await readAboutOverrides();
    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(renderAboutPage(siteOrigin(), overrides));
  });
}
