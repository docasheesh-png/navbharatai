// P-PME.4 — Build Time Estimate endpoint.
//
// Stateless: given a blueprint's complexity (and optional historical builds), return a build
// duration estimate + ETA so the build UI can show a real "Estimated: ~2 min" instead of an
// open-ended spinner. Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { estimateBuildTime, type Complexity, type HistoricalBuild } from '../lib/BuildTimeEstimator';

const MAX_HISTORY = 500;

function num(v: any, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function toComplexity(input: any): Complexity {
  return {
    moduleCount: num(input?.moduleCount),
    featureCount: num(input?.featureCount),
    ...(typeof input?.avgTokensPerModule === 'number' ? { avgTokensPerModule: num(input.avgTokensPerModule) } : {}),
  };
}

export function registerBuildEstimateRoutes(app: Express): void {
  // POST /api/build-estimate — body { complexity: {moduleCount,featureCount,avgTokensPerModule?}, history?, startMs? }
  app.post('/api/build-estimate', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!body.complexity || typeof body.complexity !== 'object') {
      res.status(400).json({ error: 'provide { complexity: { moduleCount, featureCount, avgTokensPerModule? }, history?, startMs? }' });
      return;
    }
    const complexity = toComplexity(body.complexity);
    const history: HistoricalBuild[] = Array.isArray(body.history)
      ? body.history
          .filter((h: any) => h && h.complexity && typeof h.durationMs === 'number')
          .slice(0, MAX_HISTORY)
          .map((h: any) => ({ complexity: toComplexity(h.complexity), durationMs: num(h.durationMs) }))
      : [];
    const estimate = estimateBuildTime(complexity, history);
    const startMs = typeof body.startMs === 'number' ? body.startMs : null;
    res.json({ estimate, ...(startMs != null ? { finishMs: startMs + estimate.estimateMs } : {}) });
  });
}
