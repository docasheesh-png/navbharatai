import type { Express, Request, Response } from 'express';
import { rateLimiter } from '../lib/authMiddleware';
import { requireAccountForCostlyAi } from '../lib/costlyAiAccess';
import { validateBody, vobject, vstring, vboolean } from '../lib/validate';
import { webFetchUrl } from '../AgentV3/webFetch';
import { extractSiteDesign, buildSiteImportPrompt, normalizeSiteUrl } from '../lib/siteImport';
import { cloneGuardrailsBlock } from './screenshotToPrompt';

/**
 * Website → App — POST /api/site-import/to-prompt (ROADMAP §13, 4.2).
 *
 *   body: { url, style?, framework?, includeJs? }
 *   → { prompt, extracted, url }   the build spec the client hands to NavBharatAI Pro v5.0, plus the
 *                                  structure it was derived from, so the user sees WHAT was read before
 *                                  pressing Build.
 *
 * NO MODEL CALL. The page is fetched once through the SSRF-guarded `webFetchUrl` and read
 * deterministically (`extractSiteDesign`); the builder does the visual half by opening the live page in
 * its own browser. So there is no wallet charge and no allowance burn — a deterministic tool is free by
 * the one-wallet law. It still requires a signed-in account: this is our server fetching an address a
 * visitor typed, and an anonymous, IP-keyed allowance for that is unbounded in total.
 *
 * The design & anti-phishing policy is appended SERVER-SIDE, same as the screenshot path, so the client
 * cannot drop it.
 */
const schema = vobject({
  url: vstring({ min: 1, max: 2048 }),
  style: vstring({ optional: true, max: 40 }),
  framework: vstring({ optional: true, max: 40 }),
  includeJs: vboolean({ optional: true }),
});

// `anon: 0` — sign-in required (see above); 30/hour is generous for a human and tight for a scraper.
const siteImportLimiter = () => rateLimiter({
  name: 'site-import', authed: 30, anon: 0, anonGlobalPerHour: 0, noun: 'website imports',
});

export function registerSiteImportRoutes(app: Express): void {
  app.post('/api/site-import/to-prompt', siteImportLimiter(), validateBody(schema), async (req: Request, res: Response) => {
    const body = req.body as { url?: string; style?: string; framework?: string; includeJs?: boolean };
    const url = normalizeSiteUrl(body.url ?? '');
    if (!url) { res.status(400).json({ error: 'A website address is required.' }); return; }

    const account = await requireAccountForCostlyAi(req, 'Website → App');
    if (!account.ok) { res.status(account.status).json(account.body); return; }

    const fetched = await webFetchUrl(url, { keepHtml: true });
    if (!fetched.ok && !fetched.html) {
      // Honest refusal or failure, in the guard's own words — never a spec invented from nothing.
      res.status(422).json({ error: fetched.reason ?? 'Could not read that website.' });
      return;
    }
    if (!fetched.html) {
      res.status(422).json({ error: 'That address is not a web page (it returned text or data, not HTML). Paste the address of a page you see in your browser.' });
      return;
    }

    const extracted = extractSiteDesign(fetched.html, url);
    const prompt = `${buildSiteImportPrompt(extracted, { style: body.style, framework: body.framework, includeJs: body.includeJs })}\n\n${cloneGuardrailsBlock()}`;
    res.json({ prompt, extracted, url });
  });
}
