// PUBLIC legal pages — /privacy and /terms.
//
// WHY THESE EXIST AS SERVER ROUTES: the documents were already written and already readable inside
// the app (Settings → Legal & Trust). What was missing was a URL. Meta will not take an app Live
// without a Privacy Policy URL, and Google Play requires one for the Data safety declaration — and
// both are opened by reviewers and automated checkers, some of which do not run JavaScript. Handing
// them an in-app screen reachable only after sign-in, through a menu, is not a URL anyone can check.
//
// So these are rendered on the SERVER and arrive as complete HTML in the first response:
//   • no JavaScript needed        • no sign-in needed        • no app shell to boot
//
// The CONTENT is not duplicated. It is the same source of truth the in-app pages use
// (src/content/legal), so the policy can never say one thing in the app and another on the web —
// which is exactly the kind of drift that turns a legal page into a liability.

import type { Express, Request, Response } from 'express';
import { renderLegalPageHtml } from '../lib/legalMarkdown';
import { ACCOUNT_DELETION, ACCOUNT_DELETION_TITLE, ACCOUNT_DELETION_UPDATED } from '../../content/legal/accountDeletion';
import { PUBLIC_LEGAL_ROUTES, DELETE_ACCOUNT_PATH, LEGAL_PATH_ALIASES } from '../lib/legalPaths';

// Re-exported so existing importers (and the tests that pin these paths) keep one import site.
export { PUBLIC_LEGAL_ROUTES, DELETE_ACCOUNT_PATH, LEGAL_PATH_ALIASES } from '../lib/legalPaths';

export function registerLegalRoutes(app: Express): void {
  // Aliases first: a permanent redirect to the canonical path, which the handlers below serve.
  for (const [alias, canonical] of Object.entries(LEGAL_PATH_ALIASES)) {
    app.get(alias, (_req: Request, res: Response) => {
      res.redirect(301, canonical);
    });
  }

  app.get(DELETE_ACCOUNT_PATH, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=600');
    res.type('html').send(renderLegalPageHtml({
      title: ACCOUNT_DELETION_TITLE,
      updated: ACCOUNT_DELETION_UPDATED,
      body: ACCOUNT_DELETION,
    }));
  });

  for (const [path, docId] of Object.entries(PUBLIC_LEGAL_ROUTES)) {
    app.get(path, async (_req: Request, res: Response) => {
      try {
        // Dynamic import for the same reason the client lazy-loads it: the five document bodies are
        // ~45 KB of text that nothing else needs in memory until somebody asks for one.
        const registry = await import('../../content/legal');
        const doc = registry.legalDocById(docId);
        if (!doc) {
          // A missing id is a wiring bug on our side, not the reader's fault — say so plainly and
          // give them somewhere to go, rather than a bare 404.
          res.status(500).type('text/plain').send(
            'This document could not be loaded. Please email info@navbharatai.com and we will send it to you.',
          );
          return;
        }
        // A legal page must be current: a stale cached copy could show a reader terms that no longer
        // apply. Ten minutes is enough to absorb a crawl, short enough that an update is visible fast.
        res.set('Cache-Control', 'public, max-age=600');
        res.type('html').send(renderLegalPageHtml({ title: doc.title, updated: doc.updated, body: doc.body }));
      } catch {
        res.status(500).type('text/plain').send(
          'This document could not be loaded. Please email info@navbharatai.com and we will send it to you.',
        );
      }
    });
  }
}
