import type { Express, Request, Response } from 'express';
import { doc, setDoc } from 'firebase/firestore';
import { getDb } from '../lib/db';
import { buildRateLimiter } from '../lib/authMiddleware';
import {
  cloudflareConfigured,
  createCustomHostname,
  getCustomHostname,
  fallbackOrigin,
} from '../lib/cloudflare';

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
  app.post('/api/domains/connect', buildRateLimiter(), async (req: Request, res: Response) => {
    const host = normalizeDomain(req.body?.domain);
    const userId = typeof req.body?.userId === 'string' ? req.body.userId : null;
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
      res.status(500).json({ error: err?.message || 'Failed to start domain connection.' });
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
      res.status(500).json({ error: err?.message || 'Failed to check domain status.' });
    }
  });
}
