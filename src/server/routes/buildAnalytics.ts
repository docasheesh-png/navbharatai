import type { Express, Request, Response } from 'express';
import { BuildJobManager } from '../AppMakerLab/jobs/BuildJobManager';
import { aggregateBuildAnalytics } from '../AppMakerLab/jobs/BuildAnalytics';

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
}
