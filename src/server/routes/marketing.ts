import type { Express, Request, Response } from 'express';
import { renderMarketingPage, renderAboutPage } from '../lib/marketingPages';
import { readAboutOverridesForPage } from '../lib/siteAbout';
import { noteWebsiteVisit } from '../lib/ownAudience';
import { siteOrigin } from '../lib/siteIndex';
import { useStaticPageCsp } from '../lib/securityHeaders';
import { MARKETING_PAGES, ABOUT_PATH } from '../../content/marketing';

/**
 * NavBharatAI's public product pages, server-rendered (SEO audit 2026-10-18). See lib/marketingPages.ts.
 * Every path is declared in lib/spaFallback.ts (via MARKETING_PATHS) so the SPA catch-all, which is
 * registered first, defers to these handlers instead of answering with the app shell.
 */
/**
 * ONE VISIT TO NAVBHARATAI'S OWN WEBSITE (SEO verification 2026-10-18, P2-9). Before these pages were
 * server-rendered, /about and /pricing were SPA paths and the SPA catch-all counted them; moving them
 * here silently stopped that. Counted with the SAME call and the same request facts as the catch-all
 * in server.ts, so the number keeps its meaning. noteWebsiteVisit never throws and never delays a page.
 */
function countVisit(req: Request): void {
  noteWebsiteVisit({
    path: req.path,
    ip: req.ip || '',
    userAgent: String(req.headers['user-agent'] ?? ''),
    headers: req.headers as Record<string, unknown>,
    nowMs: Date.now(),
  });
}

export function registerMarketingRoutes(app: Express): void {
  for (const page of MARKETING_PAGES) {
    app.get(page.path, (req: Request, res: Response) => {
      countVisit(req);
      res.set('Cache-Control', 'public, max-age=600');
      useStaticPageCsp(res);
      res.type('html').send(renderMarketingPage(page, siteOrigin()));
    });
  }
  app.get(ABOUT_PATH, async (req: Request, res: Response) => {
    countVisit(req);
    // NEVER throws and never waits more than ABOUT_READ_TIMEOUT_MS: a slow or unreachable store
    // degrades to the last good overrides, or to the full shipped page (lib/siteAbout.ts).
    const overrides = await readAboutOverridesForPage();
    res.set('Cache-Control', 'public, max-age=600');
    useStaticPageCsp(res);
    res.type('html').send(renderAboutPage(siteOrigin(), overrides));
  });
}
