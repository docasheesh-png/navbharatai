import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { adminUsername } from '../lib/adminAuth';
import { controlLiveModel, liveModelRegistryView, syncLiveModels } from '../AI/LiveRegistry/runtime';
import { exactModelId } from '../AI/LiveRegistry/eligibility';
export function registerLiveModelRegistryRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const writes = rateLimit({ windowMs: 60000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many registry actions. Please wait one minute.' } });
  const reads = rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/api/admin/live-model-registry', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await liveModelRegistryView()); } catch { res.status(503).json({ error: 'Model registry could not be read. No verified-free inference is authorized by an unavailable registry.' }); }
  });
  app.post('/api/admin/live-model-registry/sync', verifyAdminToken, writes, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await syncLiveModels()); } catch { res.status(503).json({ error: 'Catalog sync failed. Previous records are retained, but stale records cannot authorize free inference.' }); }
  });
  app.post('/api/admin/live-model-registry/models/action', verifyAdminToken, writes, async (req, res) => {
    const { modelId, action, registryVersion, reason } = req.body ?? {};
    if (!exactModelId(modelId) || !['disable', 'enable', 'approve-terms'].includes(action) || typeof registryVersion !== 'string' || !/^[a-f0-9-]{36}$/.test(registryVersion) || typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) {
      res.status(400).json({ error: 'Provide a model, valid action, current registry version, and a 10–500 character review reason.' }); return;
    }
    try { await controlLiveModel(modelId, action, adminUsername(), registryVersion, reason.trim()); res.json({ ok: true }); }
    catch (error) {
      if ((error as Error).message === 'REGISTRY_VERSION_CHANGED') { res.status(409).json({ error: 'The catalog changed. Refresh and review the current model before retrying.' }); return; }
      res.status(503).json({ error: 'Action could not be confirmed. Refresh to check the stored state before retrying.' });
    }
  });
}
