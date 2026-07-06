import type { Express, Request, Response } from 'express';
import { releaseGateStore } from '../lib/ReleaseGateStore';
import { evaluateReleaseGate } from '../lib/ReleaseGate';

/**
 * P-DEPLOY.5 — public release-gate status the deploy pipeline checks BEFORE promoting.
 *
 * GET /api/release/gate?sha=<candidate>
 *   → { allowed, reason, frozen, approvalRequired }
 *
 * Read-only + non-sensitive (it exposes only whether a deploy is currently permitted). A CI/deploy step
 * curls this and refuses to promote when `allowed` is false. Defaults OPEN when no gate is configured, so
 * it never accidentally halts a normal deploy.
 */
export function registerReleaseGateRoutes(app: Express): void {
  app.get('/api/release/gate', async (req: Request, res: Response) => {
    const sha = typeof req.query.sha === 'string' ? req.query.sha : undefined;
    const config = await releaseGateStore.get();
    const decision = evaluateReleaseGate(config, Date.now(), sha);
    res.json({
      allowed: decision.allowed,
      reason: decision.reason,
      frozen: config.frozen,
      approvalRequired: config.approvalRequired,
    });
  });
}
