import type { Express, Request, Response } from 'express';
import { noteWebsiteVisit } from '../lib/ownAudience';
import { renderHowItWorksPage, HOW_IT_WORKS_PATH } from '../lib/howItWorksPage';
import { siteOrigin } from '../lib/siteIndex';
import { useStaticPageCsp } from '../lib/securityHeaders';

export function registerHowItWorksRoute(app: Express): void {
  app.get(HOW_IT_WORKS_PATH, (req: Request, res: Response) => {
    noteWebsiteVisit({
      path: req.path,
      ip: req.ip || '',
      userAgent: String(req.headers['user-agent'] ?? ''),
      headers: req.headers as Record<string, unknown>,
      nowMs: Date.now(),
    });
    res.set('Cache-Control', 'public, max-age=600');
    useStaticPageCsp(res);
    res.type('html').send(renderHowItWorksPage(siteOrigin()));
  });
}
