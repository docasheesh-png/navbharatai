import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { audit } from '../lib/audit';
import { adminUsername } from '../lib/adminAuth';
import { runGameAssetLiveCheck, type LiveCheckResult } from '../AgentV3/gameAssets/liveCheck';

/**
 * Admin → AI Engines → Game asset download check (L3 step 1). POST runs the production asset transports once from
 * this server and returns each stage; GET returns this instance's last result. Writes nothing, changes no flag.
 */
export function registerGameAssetsAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const runs = rateLimit({ windowMs: 60_000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many checks. Please wait one minute.' } });
  let last: LiveCheckResult | null = null;
  app.get('/api/admin/game-assets/live-check', verifyAdminToken, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ last });
  });
  app.post('/api/admin/game-assets/live-check', verifyAdminToken, runs, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body: unknown = req.body;
    if (body && (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0)) {
      res.status(400).json({ error: 'This check accepts only an empty JSON object.' }); return;
    }
    try {
      last = await runGameAssetLiveCheck();
      audit('ADMIN_GAME_ASSET_LIVE_CHECK', { admin: adminUsername(), result: last.ok ? 'pass' : `fail: ${last.steps.filter((s) => !s.ok).map((s) => s.name).join(', ')}` });
      res.json({ last });
    } catch {
      res.status(503).json({ error: 'The check could not run. Nothing was changed.' });
    }
  });
}
