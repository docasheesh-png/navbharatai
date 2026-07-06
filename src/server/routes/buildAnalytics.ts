import type { Express, Request, Response } from 'express';
import { BuildJobManager } from '../AppMakerLab/jobs/BuildJobManager';
import { aggregateBuildAnalytics } from '../AppMakerLab/jobs/BuildAnalytics';
import { summarizeSlo } from '../AppMakerLab/intelligence/BuildSLATracker';
import { computeReliabilityMetrics } from '../QualityEvaluationEngine/QAMetricsCollector';

/**
 * P-BRE.8 — Build analytics endpoint.
 *
 * GET /api/analytics/builds?limit=100
 *   → pipeline health over the last N build jobs: success/failure rate, avg + p95 duration,
 *     status breakdown, and the top failure signatures. Real data from the job store; honest
 *     zeros when no builds have run yet (never fabricated).
 */
export function registerBuildAnalyticsRoutes(app: Express): void {
  app.get('/api/analytics/builds', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const jobs = await BuildJobManager.listRecent(limit);
      res.json({ ...aggregateBuildAnalytics(jobs), window: limit, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[BUILD_ANALYTICS] failed:', err);
      res.status(500).json({ error: 'Failed to compute build analytics.' });
    }
  });

  // P-PME.11 — build-time SLO compliance (violation rate + p95 per complexity tier). Honest zeros
  // until builds have run; never fabricated.
  app.get('/api/analytics/slo', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const jobs = await BuildJobManager.listRecent(limit);
      res.json({ ...summarizeSlo(jobs), window: limit, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[BUILD_SLO] failed:', err);
      res.status(500).json({ error: 'Failed to compute SLO compliance.' });
    }
  });

  // P-TQA.13 — MTTD/MTTR reliability from real build-job history (failure→recovery). Honest zeros
  // until failures have occurred; unresolved failures never invent a repair time.
  app.get('/api/analytics/reliability', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const jobs = await BuildJobManager.listRecent(limit);
      res.json({ ...computeReliabilityMetrics(jobs), window: limit, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[BUILD_RELIABILITY] failed:', err);
      res.status(500).json({ error: 'Failed to compute reliability metrics.' });
    }
  });
}
