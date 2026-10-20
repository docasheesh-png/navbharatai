import type { Express, RequestHandler } from 'express';
import { aiMaintenanceStore, MAINTENANCE_MESSAGE, MAINTENANCE_FAILURE_THRESHOLD, MAINTENANCE_FAILURE_WINDOW_MS } from '../lib/aiMaintenance';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';

export function registerAiMaintenanceRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  app.get('/api/admin/ai-maintenance', verifyAdminToken, async (_req, res) => {
    const state = await aiMaintenanceStore.read();
    res.setHeader('Cache-Control', 'no-store');
    if (state.unavailable) { res.status(503).json({ error: 'Maintenance status could not be read. AI is paused on this server until the setting is available.' }); return; }
    res.json({ ...state, message: MAINTENANCE_MESSAGE, threshold: MAINTENANCE_FAILURE_THRESHOLD, windowSeconds: MAINTENANCE_FAILURE_WINDOW_MS / 1000 });
  });
  app.post('/api/admin/ai-maintenance', verifyAdminToken, async (req, res) => {
    const { enabled, autoEnabled } = req.body ?? {};
    if ((enabled === undefined && autoEnabled === undefined)
      || (enabled !== undefined && typeof enabled !== 'boolean')
      || (autoEnabled !== undefined && typeof autoEnabled !== 'boolean')) {
      res.status(400).json({ error: 'Choose Maintenance on/off or automatic protection on/off.' }); return;
    }
    try {
      const state = await aiMaintenanceStore.set({ ...(enabled === undefined ? {} : { enabled }), ...(autoEnabled === undefined ? {} : { autoEnabled }) });
      audit('ADMIN_AI_MAINTENANCE', { admin: adminUsername(), enabled: state.enabled, autoEnabled: state.autoEnabled });
      res.json({ ...state, message: MAINTENANCE_MESSAGE, threshold: MAINTENANCE_FAILURE_THRESHOLD, windowSeconds: MAINTENANCE_FAILURE_WINDOW_MS / 1000 });
    } catch {
      res.status(503).json({ error: 'Maintenance could not be saved. Refresh to check the current status, then try again.' });
    }
  });
}
