import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { readApiProviderDirectory } from '../lib/apiProviderDirectory';

/**
 * Admin → Money → API Providers. One read: every outside API, whether its key is set (names only), its billing
 * link, and the live balance where the provider has a balance API. Read-only; it spends nothing (the balance
 * endpoints are free account reads). Rate-limited because each read calls up to three providers.
 */
export function registerApiProvidersAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many balance checks. Please wait one minute.' } });
  app.get('/api/admin/api-providers', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const directory = await readApiProviderDirectory();
      audit('ADMIN_API_PROVIDERS_READ', { admin: adminUsername(), result: `${directory.counts.low} low, ${directory.counts.empty} empty, ${directory.counts.failed} failed` });
      res.json(directory);
    } catch {
      audit('ADMIN_API_PROVIDERS_READ_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'The provider list is unavailable right now. No balance is confirmed.' });
    }
  });
}
