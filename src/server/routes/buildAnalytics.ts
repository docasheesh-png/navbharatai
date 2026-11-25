import type { Express, NextFunction, Request, Response } from 'express';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { BuildJobManager } from '../AppMakerLab/jobs/BuildJobManager';
import { aggregateBuildAnalytics } from '../AppMakerLab/jobs/BuildAnalytics';
import { summarizeSlo } from '../AppMakerLab/intelligence/BuildSLATracker';
import { computeReliabilityMetrics } from '../QualityEvaluationEngine/QAMetricsCollector';
import { analyzeBuildOptimizations } from '../AppMakerLab/AIBuildOptimizer';

/**
 * P-BRE.8 — Build analytics endpoint.
 *
 * GET /api/analytics/builds?limit=100
 *   → pipeline health over the last N build jobs: success/failure rate, avg + p95 duration,
 *     status breakdown, and the top failure signatures. Real data from the job store; honest
 *     zeros when no builds have run yet (never fabricated).
 */
/**
 * Signed-in only (security audit 2026-11-21). These are platform-wide build counts and timings — no person in
 * them — but they are the business's own numbers and were open to anyone on the internet. Every screen that
 * shows them (App Analytics, Project Insights) is behind sign-in and now sends its token.
 */
async function requireSignedIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (await verifyFirebaseToken(req)) { next(); return; }
  res.status(401).json({ error: 'Please sign in to see build analytics.' });
}

export function registerBuildAnalyticsRoutes(app: Express): void {
  app.get('/api/analytics/builds', requireSignedIn, async (req: Request, res: Response) => {
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
  app.get('/api/analytics/slo', requireSignedIn, async (req: Request, res: Response) => {
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
  app.get('/api/analytics/reliability', requireSignedIn, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const jobs = await BuildJobManager.listRecent(limit);
      res.json({ ...computeReliabilityMetrics(jobs), window: limit, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[BUILD_RELIABILITY] failed:', err);
      res.status(500).json({ error: 'Failed to compute reliability metrics.' });
    }
  });

  // P-BRE.11 — AI build optimizer: prioritized, deterministic optimization suggestions from the real
  // aggregated build telemetry. Empty until 10+ builds have run (never over-fits a tiny sample).
  app.get('/api/analytics/build-optimizer', requireSignedIn, async (req: Request, res: Response) => {
    try {
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const jobs = await BuildJobManager.listRecent(limit);
      const analytics = aggregateBuildAnalytics(jobs);
      res.json({ suggestions: analyzeBuildOptimizations(analytics), window: limit, generatedAt: new Date().toISOString() });
    } catch (err) {
      console.error('[BUILD_OPTIMIZER] failed:', err);
      res.status(500).json({ error: 'Failed to compute build optimizations.' });
    }
  });
}
