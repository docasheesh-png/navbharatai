import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { readApiProviderDirectory } from '../lib/apiProviderDirectory';
import { ApiProviderAccountInputError, readApiProviderAccounts, writeApiProviderAccount } from '../lib/apiProviderAccounts';

/**
 * Admin → Money → API Providers. One read: every outside API, whether its key is set (names only), what it is
 * used for, its billing link, the login the admin recorded for it, and the live balance where the provider has
 * a balance API. Read-only except the admin's own login note. Rate-limited because each read calls up to three
 * providers.
 */
export function registerApiProvidersAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many balance checks. Please wait one minute.' } });
  const writes = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many changes. Please wait one minute.' } });
  app.get('/api/admin/api-providers', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const directory = await readApiProviderDirectory();
      // The saved logins are a separate read: if it fails, the balances still show and the page says the
      // logins could not be loaded — never an empty "no login recorded" that is not true.
      let accounts: Record<string, string> | null = null;
      try { accounts = await readApiProviderAccounts(); } catch { accounts = null; }
      const rows = directory.rows.map((r) => ({ ...r, accountEmail: accounts ? accounts[r.id] ?? null : null }));
      audit('ADMIN_API_PROVIDERS_READ', { admin: adminUsername(), result: `${directory.counts.low} low, ${directory.counts.empty} empty, ${directory.counts.failed} failed` });
      res.json({ ...directory, rows, accountsAvailable: accounts !== null });
    } catch {
      audit('ADMIN_API_PROVIDERS_READ_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'The provider list is unavailable right now. No balance is confirmed.' });
    }
  });
  app.post('/api/admin/api-providers/:id/account', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body: unknown = req.body;
    // Strict one-key allowlist: the body is { accountEmail } and nothing else (≤ 254 characters, checked below).
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'accountEmail')) {
      res.status(400).json({ error: 'Send { "accountEmail": "…" } and nothing else.' }); return;
    }
    try {
      const saved = await writeApiProviderAccount(req.params.id, (body as Record<string, unknown>).accountEmail);
      // The provider is audited, not the email: the audit log is wider than this page.
      audit('ADMIN_API_PROVIDER_ACCOUNT_SET', { admin: adminUsername(), provider: req.params.id, result: saved ? 'set' : 'cleared' });
      res.json({ id: req.params.id, accountEmail: saved });
    } catch (e) {
      if (e instanceof ApiProviderAccountInputError) { res.status(400).json({ error: e.message }); return; }
      audit('ADMIN_API_PROVIDER_ACCOUNT_SET_FAILED', { admin: adminUsername(), provider: String(req.params.id).slice(0, 40), result: 'unavailable' });
      res.status(503).json({ error: 'The login could not be saved. Nothing was changed.' });
    }
  });
}
