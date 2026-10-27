import type { Express, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { comparisonStatus, runComparison, ComparisonUnavailable } from '../lib/deepinfraComparison';
import { readComparisonAction } from '../../lib/deepinfraComparison';
import { adminUsername } from '../lib/adminAuth';
import { audit } from '../lib/audit';
import { sanitizeText } from '../../lib/observability/sanitize';

export function registerDeepinfraComparisonRoutes(app: Express, auth: RequestHandler): void {
  const reads = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
  const runs = rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: 'draft-7', legacyHeaders: false });
  app.get('/api/admin/free-chat-chain/deepinfra-comparison', auth, reads, async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { res.json(await comparisonStatus()); }
    catch { res.status(503).json({ error: 'Comparison status is unavailable. No inference was started.' }); }
  });
  app.post('/api/admin/free-chat-chain/deepinfra-comparison', auth, runs, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const action = readComparisonAction(req.body);
    if (!action) { res.status(400).json({ error: 'Provide a fresh comparison run ID and a 10–500 character reason. Custom prompts, models, keys and endpoints are not accepted.' }); return; }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    const actor = adminUsername(), reason = sanitizeText(action.reason, 500);
    try {
      audit('ADMIN_DEEPINFRA_COMPARISON_STARTED', { admin: actor, runId: action.runId, reason });
      const report = await runComparison(action.runId, actor, controller.signal, action.tariffDigest);
      audit('ADMIN_DEEPINFRA_COMPARISON_FINISHED', { admin: actor, runId: action.runId, completed: report.completed, stopReason: report.stopReason });
      if (!res.destroyed) res.json(report);
    } catch (error) {
      const known = error instanceof ComparisonUnavailable;
      audit('ADMIN_DEEPINFRA_COMPARISON_FAILED', { admin: actor, runId: action.runId, reason: known ? error.reason : 'unavailable' });
      if (!res.destroyed) res.status(known ? error.status : 503).json({ error: known ? error.reason : 'Comparison could not be confirmed. Refresh saved status before retrying.' });
    } finally { res.off('close', disconnected); }
  });
}
