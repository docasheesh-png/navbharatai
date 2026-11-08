import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import {
  PROVIDER_FAMILIES, ProviderSwitchConflictError, ProviderSwitchInputError, SYNC_MS, lastSwitchSync, providerHasKey,
  readSwitchState, switchedOffProviders, writeSwitch,
} from '../lib/providerSwitches';

/**
 * Admin → AI Engines → AI provider switches. GET reads the shared state (and what THIS instance is enforcing);
 * POST switches one provider on or off, with a reason, against the revision the admin saw. See providerSwitches.ts
 * for how a switch is enforced.
 */
export function registerProviderSwitchesAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many reads. Please wait one minute.' } });
  const writes = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many changes. Please wait one minute.' } });

  app.get('/api/admin/provider-switches', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const state = await readSwitchState();
      const enforcing = new Set(switchedOffProviders());
      res.json({
        revision: state.revision,
        updatedAt: state.updatedAt,
        syncMs: SYNC_MS,
        thisInstance: { ...lastSwitchSync(), enforcingOff: [...enforcing] },
        providers: PROVIDER_FAMILIES.map((f) => ({ id: f.id, name: f.name, on: !state.off.includes(f.id), hasKey: f.keys.length === 0 ? null : providerHasKey(f.id) })),
        history: [...state.history].reverse().slice(0, 20),
      });
    } catch {
      audit('ADMIN_PROVIDER_SWITCHES_READ_FAILED', { admin: adminUsername(), result: 'unavailable' });
      res.status(503).json({ error: 'The switch state could not be read. Nothing is confirmed on or off.' });
    }
  });

  app.post('/api/admin/provider-switches', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body: unknown = req.body;
    // Strict four-key allowlist: { id, on, reason, expectedRevision }.
    const allowed = new Set(['id', 'on', 'reason', 'expectedRevision']);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !allowed.has(k))) {
      res.status(400).json({ error: 'Send { id, on, reason, expectedRevision } and nothing else.' }); return;
    }
    const b = body as Record<string, unknown>;
    try {
      const state = await writeSwitch({ id: b.id, on: b.on, reason: b.reason, expectedRevision: b.expectedRevision, by: adminUsername() });
      audit('ADMIN_PROVIDER_SWITCH', { admin: adminUsername(), provider: String(b.id), result: b.on ? 'on' : 'off', reason: String(b.reason).slice(0, 300) }, 'warn');
      res.json({ revision: state.revision, off: state.off });
    } catch (e) {
      if (e instanceof ProviderSwitchInputError) { res.status(400).json({ error: e.message }); return; }
      if (e instanceof ProviderSwitchConflictError) { res.status(409).json({ error: e.message }); return; }
      audit('ADMIN_PROVIDER_SWITCH_FAILED', { admin: adminUsername(), provider: String(b.id).slice(0, 40), result: 'unavailable' });
      res.status(503).json({ error: 'The switch could not be saved. Nothing was changed.' });
    }
  });
}
