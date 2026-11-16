import type { Express, Request, Response } from 'express';
import { noteWebsiteVisit } from '../lib/ownAudience';
import { siteOrigin } from '../lib/siteIndex';
import { useStaticPageCsp } from '../lib/securityHeaders';
import { USE_CASE_INDEX_PATH, useCaseBySlug } from '../lib/useCaseCatalog';
import { renderUseCaseIndex, renderUseCaseMissing, renderUseCasePage } from '../lib/useCasePages';

function countVisit(req: Request): void {
  noteWebsiteVisit({
    path: req.path,
    ip: req.ip || '',
    userAgent: String(req.headers['user-agent'] ?? ''),
    headers: req.headers as Record<string, unknown>,
    nowMs: Date.now(),
  });
}

/** Curated public app ideas. Not a directory of users' apps. */
export function registerUseCaseRoutes(app: Express): void {
  app.get(USE_CASE_INDEX_PATH, (req: Request, res: Response) => {
    countVisit(req);
    res.set('Cache-Control', 'public, max-age=600');
    useStaticPageCsp(res);
    res.type('html').send(renderUseCaseIndex(siteOrigin()));
  });

  app.get('/app/:slug', (req: Request, res: Response) => {
    const page = useCaseBySlug(String(req.params.slug || ''));
    res.set('Cache-Control', page ? 'public, max-age=600' : 'no-store');
    useStaticPageCsp(res);
    if (!page) {
      res.status(404).type('html').send(renderUseCaseMissing(siteOrigin()));
      return;
    }
    countVisit(req);
    res.type('html').send(renderUseCasePage(page, siteOrigin()));
  });

  app.get('/api/use-cases/:slug', (req: Request, res: Response) => {
    const page = useCaseBySlug(String(req.params.slug || ''));
    if (!page) {
      res.status(404).json({ error: 'That app idea is not on the list.' });
      return;
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ slug: page.slug, title: page.title, prompt: page.prompt });
  });
}
