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
    // Q-141 — a pipeline asking this endpoint is the ONLY evidence that a freeze reaches the pipeline
    // at all, so it is recorded. Deliberately not awaited: the pipeline is waiting on the answer, and
    // the record is worth nothing if it costs the answer a round trip.
    void releaseGateStore.noteChecked(sha);
    res.json({
      allowed: decision.allowed,
      reason: decision.reason,
      frozen: config.frozen,
      approvalRequired: config.approvalRequired,
    });
  });
}
