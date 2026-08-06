import type { Express, Request, Response } from 'express';
import { buildRateLimiter, verifyFirebaseToken, enforceNotBanned } from '../lib/authMiddleware';
import { sendSafeError } from '../lib/httpError';
import {
  normalizeDomain,
  firebaseCustomDomainsEnabled,
  firebaseHostingConfigured,
  attachCustomDomain,
  customDomainStatusLive,
  customDomainErrorMessage,
  sanitizeDomainErrorDetail,
} from '../lib/firebaseCustomDomain';
import { linkWorkspaceDomain } from '../lib/firebaseDomainLink';

/**
 * Firebase-NATIVE custom-domain routes (Slice 2) — connect a user's own domain directly to their
 * "Host on NavBharatAI" (Firebase Hosting) site:
 *   - POST /api/domains/nbai/connect — attach the domain to the workspace's dedicated Firebase site
 *     and return the EXACT DNS records to add (Firebase issues SSL automatically once they resolve).
 *   - GET  /api/domains/nbai/status  — poll ownership / host / SSL status for a connected domain.
 *
 * Gated by `AGENTV3_FIREBASE_CUSTOM_DOMAINS` (off by default → honest "not enabled" 503). Ownership
 * is STRICT: only the VERIFIED owner of a real `agentv3-<uid>-…` workspace may attach a domain
 * (attaching provisions a real Firebase resource against our project, so it must not be spoofable).
 */

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Strict owner gate: the verified uid must own this real workspace (no anon, no claimed fallback). */
function ownsWorkspace(verifiedUid: string | null, workspaceId: unknown): workspaceId is string {
  return (
    !!verifiedUid &&
    /^[A-Za-z0-9_-]{1,64}$/.test(verifiedUid) &&
    typeof workspaceId === 'string' &&
    workspaceId.startsWith(`agentv3-${verifiedUid}-`)
  );
}

export function registerNbaiDomainsRoutes(app: Express): void {
  app.post('/api/domains/nbai/connect', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled()) {
      res.status(503).json({ error: 'Custom-domain hosting on NavBharatAI is not enabled yet. Please try again later.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    if (!verifiedUid) {
      res.status(401).json({ error: 'Please sign in to connect a custom domain.' });
      return;
    }
    const workspaceId = req.body?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only connect a domain to your own app.' });
      return;
    }
    const host = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Enter a valid domain like myshop.com (no https://, no slashes).' });
      return;
    }
    if (!firebaseHostingConfigured()) {
      res.status(503).json({ error: 'Custom-domain hosting is not configured on the server yet. Please try again later.' });
      return;
    }
    try {
      const status = await attachCustomDomain(workspaceId, host);
      // Persist the link so the deploy path publishes future builds to this workspace's dedicated site.
      await linkWorkspaceDomain({ domain: host, workspaceId, userId: verifiedUid });
      res.json(status);
    } catch (err: any) {
      // HONEST failure (admin 2026-08-02): a permanent problem (server not permitted, domain taken)
      // must NOT tell the user to "try again" — that loops them forever on something a retry can
      // never fix. customDomainErrorMessage classifies it. The SANITIZED real reason rides along for
      // the owner (this route is ownership-checked): every class of this failure looked identical
      // from a screenshot (admin 2026-08-06, mitrify.in) until the cause was allowed to name itself.
      console.error(`[HTTP 500] nbai domain connect: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      res.status(500).json({ error: customDomainErrorMessage(err), detail: sanitizeDomainErrorDetail(err) });
    }
  });

  app.get('/api/domains/nbai/status', async (req: Request, res: Response) => {
    if (!firebaseCustomDomainsEnabled()) {
      res.status(503).json({ error: 'Custom-domain hosting on NavBharatAI is not enabled yet.' });
      return;
    }
    const verifiedUid = await verifyFirebaseToken(req);
    const workspaceId = req.query?.workspaceId;
    if (!ownsWorkspace(verifiedUid, workspaceId)) {
      res.status(403).json({ error: 'You can only view your own app’s domain.' });
      return;
    }
    const host = normalizeDomain(req.query?.domain);
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Invalid domain.' });
      return;
    }
    try {
      const status = await customDomainStatusLive(workspaceId, host);
      if (!status) {
        res.status(404).json({ error: 'This domain has not been connected yet.' });
        return;
      }
      res.json(status);
    } catch (err: any) {
      sendSafeError(res, 500, 'Failed to check domain status. Please try again.', err, 'nbai domain status');
    }
  });
}
