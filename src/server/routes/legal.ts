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
import { PUBLIC_LEGAL_ROUTES, DELETE_ACCOUNT_PATH, CONTACT_PATH, LEGAL_PATH_ALIASES } from '../lib/legalPaths';
import { grievanceOfficer } from '../lib/grievanceOfficer';
import { grievanceDoc, GRIEVANCE_TITLE, GRIEVANCE_UPDATED } from '../../content/legal/grievance';
import { contactDoc, CONTACT_TITLE, CONTACT_UPDATED } from '../../content/legal/contact';
import { siteOrigin } from '../lib/siteIndex';

// Re-exported so existing importers (and the tests that pin these paths) keep one import site.
export { PUBLIC_LEGAL_ROUTES, DELETE_ACCOUNT_PATH, CONTACT_PATH, LEGAL_PATH_ALIASES } from '../lib/legalPaths';

/**
 * Each public page's OWN search snippet (SEO audit 2026-10-18). Every page used to share one
 * privacy-policy sentence. Plain statements of what the page is — nothing promotional.
 */
export const PUBLIC_PAGE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '/privacy': 'NavBharatAI Privacy Policy: what personal data we collect, why we collect it, who processes it, and your rights.',
  '/terms': 'NavBharatAI Terms of Service: the rules for using NavBharatAI, wallet tokens, purchases, published apps and accounts.',
  '/refund': 'NavBharatAI Refund & Cancellation Policy: when a payment can be refunded, how to ask, and how long it takes.',
  '/grievance': 'NavBharatAI Grievance Redressal: how to make a formal complaint, the officer responsible and the response timelines.',
  '/dpa': 'NavBharatAI Data Processing Agreement for business customers who process personal data through NavBharatAI.',
  '/security': 'NavBharatAI security overview, security policy, incident response summary and vulnerability disclosure policy.',
  [CONTACT_PATH]: 'Contact NavBharatAI by email at info@navbharatai.com for support, refunds, payments, account deletion, complaints and business enquiries.',
  [DELETE_ACCOUNT_PATH]: 'How to delete your NavBharatAI account and data, in the app or by asking us, what is deleted, what is kept and why.',
};

/**
 * The page's canonical address, sent as an HTTP `Link` header (which Google and Bing honour) rather
 * than a `<link>` tag: these pages are contract-tested to load NO linked resource, and a header keeps
 * that true. Without it the 21 alias spellings and any `?utm=` copy competed with the real page.
 */
function setCanonical(res: Response, path: string): void {
  res.set('Link', `<${siteOrigin()}${path}>; rel="canonical"`);
}

export function registerLegalRoutes(app: Express): void {
  // Aliases first: a permanent redirect to the canonical path, which the handlers below serve.
  for (const [alias, canonical] of Object.entries(LEGAL_PATH_ALIASES)) {
    app.get(alias, (_req: Request, res: Response) => {
      res.redirect(301, canonical);
    });
  }

  /**
   * Contact Us. Built with the SAME officer details the /grievance page uses, so the postal address
   * and telephone can never differ between the two pages a regulator reads side by side — and, when
   * nothing is configured, both omit them rather than printing an empty label.
   */
  app.get(CONTACT_PATH, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=600');
    setCanonical(res, CONTACT_PATH);
    res.type('html').send(renderLegalPageHtml({
      title: CONTACT_TITLE,
      updated: CONTACT_UPDATED,
      description: PUBLIC_PAGE_DESCRIPTIONS[CONTACT_PATH],
      url: `${siteOrigin()}${CONTACT_PATH}`,
      body: contactDoc(grievanceOfficer()),
    }));
  });

  app.get(DELETE_ACCOUNT_PATH, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=600');
    setCanonical(res, DELETE_ACCOUNT_PATH);
    res.type('html').send(renderLegalPageHtml({
      title: ACCOUNT_DELETION_TITLE,
      updated: ACCOUNT_DELETION_UPDATED,
      description: PUBLIC_PAGE_DESCRIPTIONS[DELETE_ACCOUNT_PATH],
      url: `${siteOrigin()}${DELETE_ACCOUNT_PATH}`,
      body: ACCOUNT_DELETION,
    }));
  });

  for (const [path, docId] of Object.entries(PUBLIC_LEGAL_ROUTES)) {
    app.get(path, async (_req: Request, res: Response) => {
      setCanonical(res, path);
      try {
        /**
         * The grievance page is built HERE rather than read from the registry, because it is the one
         * document whose contents depend on deployment configuration — the officer's real name and
         * contact. The registry's copy is the unconfigured fallback (see content/legal/index.ts);
         * this is the version an actual reader must get, and the words come from the same pure
         * builder, so the two can differ only in the details they are given.
         */
        if (docId === 'legal_grievance') {
          res.set('Cache-Control', 'public, max-age=600');
          res.type('html').send(renderLegalPageHtml({
            title: GRIEVANCE_TITLE,
            updated: GRIEVANCE_UPDATED,
            description: PUBLIC_PAGE_DESCRIPTIONS[path],
            url: `${siteOrigin()}${path}`,
            body: grievanceDoc(grievanceOfficer()),
          }));
          return;
        }
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
        res.type('html').send(renderLegalPageHtml({ title: doc.title, updated: doc.updated, body: doc.body, description: PUBLIC_PAGE_DESCRIPTIONS[path], url: `${siteOrigin()}${path}` }));
      } catch {
        res.status(500).type('text/plain').send(
          'This document could not be loaded. Please email info@navbharatai.com and we will send it to you.',
        );
      }
    });
  }
}
