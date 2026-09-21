// The route that serves the checkout hand-off page. See lib/checkoutHandoff.ts for WHY it exists.

import type { Express, Request, Response } from 'express';
import { CHECKOUT_HANDOFF_PATH, checkoutHandoffHtml } from '../lib/checkoutHandoff';

export function registerCheckoutHandoffRoute(app: Express): void {
  app.get(CHECKOUT_HANDOFF_PATH, (_req: Request, res: Response) => {
    // NEVER cached. The page is a redirector for one payment session; a cached copy that outlives its
    // session would send somebody to a dead checkout, and the page is tiny enough that caching buys
    // nothing anyway.
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.type('html').send(checkoutHandoffHtml());
  });
}
