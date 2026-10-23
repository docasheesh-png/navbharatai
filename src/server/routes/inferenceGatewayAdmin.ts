import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { GatewayAdminSetup, GatewaySetupError } from '../AI/InferenceGateway/adminSetup';
import { getServerDb } from '../lib/serverDb';
import { parseEnvFlag } from '../lib/envFlag';
import { adminUsername } from '../lib/adminAuth';
import { audit } from '../lib/audit';

function service(): GatewayAdminSetup {
  const db = getServerDb(); if (!db) throw new Error('Gateway review store unavailable');
  return new GatewayAdminSetup(db, { now: Date.now, environment: () => process.env,
    deploymentEnabled: () => parseEnvFlag(process.env.INFERENCE_GATEWAY_ENABLED) === true });
}
function failure(error: unknown): { status: number; error: string; result: string } {
  const code = error instanceof GatewaySetupError ? error.code : '';
  if (code === 'invalid-review') return { status: 400, error: 'Review is incomplete, contradictory, expired, or outside eligible Free capability scopes. No changes were saved.', result: 'invalid-review' };
  if (code === 'conflict' || code === 'preview-changed') return { status: 409, error: 'The reviewed configuration changed. Refresh, check the saved revision and preview again before submitting.', result: 'conflict' };
  if (code === 'credential-unavailable') return { status: 409, error: 'The selected server credential generation is unavailable. No credentials can be entered or created here.', result: 'credential-unavailable' };
  return { status: 503, error: 'The review operation could not be confirmed. Refresh the saved status before retrying the same operation.', result: 'unconfirmed' };
}
/** Shared MFA-backed admin middleware is first on EVERY route. No provider calls. */
export function registerInferenceGatewayAdminRoutes(app: Express, verifyAdminToken: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
  const writes = rateLimit({ windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/api/admin/inference-gateway/setup', verifyAdminToken, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await service().status()); }
    catch { res.status(503).json({ error: 'Saved gateway review status is unavailable. No provider readiness or free balance has been confirmed.' }); }
  });
  app.post('/api/admin/inference-gateway/setup/preview', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await service().preview(req.body)); }
    catch (error) { const f = failure(error); res.status(f.status).json({ error: f.error }); }
  });
  app.post('/api/admin/inference-gateway/setup/review', verifyAdminToken, writes, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 2 || !Object.hasOwn(b, 'submission') || !Object.hasOwn(b, 'previewBinding')) {
      res.status(400).json({ error: 'Submit only the reviewed form and its preview binding. Credentials and arbitrary documents are not accepted.' }); return;
    }
    const actor = adminUsername();
    try {
      const result = await service().submit(b.submission, b.previewBinding, actor);
      audit('ADMIN_INFERENCE_GATEWAY_REVIEW', { admin: actor, result: 'ok', operationId: result.operationId, catalogRevision: result.catalogRevision });
      res.json(result);
    } catch (error) {
      const f = failure(error);
      // Never log submitted fields or raw errors, including rejected credentials.
      audit('ADMIN_INFERENCE_GATEWAY_REVIEW_FAILED', { admin: actor, result: f.result });
      res.status(f.status).json({ error: f.error });
    }
  });
}
