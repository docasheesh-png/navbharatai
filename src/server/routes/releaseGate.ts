import type { Express, Request, Response } from 'express';
import { releaseGateStore } from '../lib/ReleaseGateStore';
import { evaluateReleaseGate } from '../lib/ReleaseGate';
import { pipelineEvidence } from '../lib/releaseGateEnforcement';

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
    //
    // 🔴 BUT ONLY WHEN THE CALL IS ACTUALLY EVIDENCE (fixed 2026-10-11). This route is PUBLIC, so the
    // first version recorded a check on every GET — a browser, an uptime monitor or a crawler then made
    // the admin board say "a deploy pipeline asked this gate". A call with neither the pipeline's header
    // nor a commit SHA is not evidence and is not stored; see `pipelineEvidence`.
    const evidence = pipelineEvidence({ sha, callerHeader: req.get('X-Release-Gate-Caller') });
    if (evidence !== 'none') void releaseGateStore.noteChecked(sha, evidence === 'pipeline');
    res.json({
      allowed: decision.allowed,
      reason: decision.reason,
      frozen: config.frozen,
      approvalRequired: config.approvalRequired,
    });
  });
}
