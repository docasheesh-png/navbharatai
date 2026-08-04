import type { Express, Request, Response } from 'express';
// ADMIN-SDK binding (bypasses security rules) — see serverDb.ts. Writes custom_domains (server-only).
import { doc, setDoc, getServerDb as getDb } from '../lib/serverDb';
import { buildRateLimiter, verifyFirebaseToken, enforceNotBanned } from '../lib/authMiddleware';
import {
  cloudflareConfigured,
  createCustomHostname,
  getCustomHostname,
  fallbackOrigin,
} from '../lib/cloudflare';
import { sendSafeError } from '../lib/httpError';

/**
 * Custom-domain routes (Cloudflare for SaaS).
 *  - POST /api/domains/connect  — start connecting a user's domain: creates the
 *    Cloudflare custom hostname and returns the exact DNS records to add.
 *  - GET  /api/domains/status   — poll verification + SSL status for a domain.
 *
 * Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID. When unset, returns an
 * honest 503 (never pretends a domain is connected).
 */

function normalizeDomain(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

export function registerDomainsRoutes(app: Express): void {
  app.post('/api/domains/connect', buildRateLimiter(), enforceNotBanned(), async (req: Request, res: Response) => {
    // SECURITY: provisioning a Cloudflare custom hostname spends NavBharatAI's zone quota and writes an
    // ownership mapping, so it MUST be authenticated. Derive the owner from the verified Firebase token —
    // never a spoofable req.body.userId (which also let an anonymous caller provision on our zone).
    const userId = await verifyFirebaseToken(req);
    if (!userId) {
      res.status(401).json({ error: 'Please sign in to connect a custom domain.' });
      return;
    }
    const host = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Enter a valid domain like myshop.com (no https://, no slashes).' });
      return;
    }
    if (!cloudflareConfigured()) {
      res.status(503).json({ error: 'Custom-domain hosting is not configured on the server yet. Please try again later.' });
      return;
    }
    try {
      const ch = await createCustomHostname(host);
      // Persist the mapping so the serving layer can route this domain → the user's site.
      try {
        const db = getDb() as any;
        if (db) {
          await setDoc(
            doc(db, 'custom_domains', host.replace(/[^a-z0-9.-]/g, '_')),
            { domain: host, userId, hostnameId: ch.id, status: ch.status, updatedAt: Date.now() },
            { merge: true },
          );
        }
      } catch { /* mapping is best-effort; provisioning already succeeded */ }
      res.json({ ...ch, fallbackOrigin: fallbackOrigin() });
    } catch (err: any) {
      sendSafeError(res, 500, 'Failed to start domain connection. Please try again.', err, 'domain connect');
    }
  });

  app.get('/api/domains/status', async (req: Request, res: Response) => {
    const host = normalizeDomain(req.query?.domain);
    if (!DOMAIN_RE.test(host)) {
      res.status(400).json({ error: 'Invalid domain.' });
      return;
    }
    if (!cloudflareConfigured()) {
      res.status(503).json({ error: 'Custom-domain hosting is not configured yet.' });
      return;
    }
    try {
      const ch = await getCustomHostname(host);
      if (!ch) {
        res.status(404).json({ error: 'This domain has not been connected yet.' });
        return;
      }
      res.json({ ...ch, fallbackOrigin: fallbackOrigin() });
    } catch (err: any) {
      sendSafeError(res, 500, 'Failed to check domain status. Please try again.', err, 'domain status');
    }
  });
}
