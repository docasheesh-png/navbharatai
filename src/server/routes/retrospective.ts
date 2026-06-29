// P-PME.5 — Build Retrospective endpoint.
//
// Stateless: turn a failed build into a structured retrospective, and surface the most relevant
// past-failure warnings for a new build. Pure compute, no secrets, no persistence.

import type { Express, Request, Response } from 'express';
import { buildRetrospective, relevantWarnings, type FailedBuildInput, type Retrospective } from '../lib/BuildRetrospectiveEngine';

const MAX = 1000;

export function registerRetrospectiveRoutes(app: Express): void {
  // POST /api/retrospective — body: a failed-build record → a structured retrospective.
  app.post('/api/retrospective', (req: Request, res: Response) => {
    const body = req.body || {};
    if (typeof body !== 'object' || (!body.framework && !body.intent && !body.finalError && !Array.isArray(body.attempts))) {
      res.status(400).json({ error: 'provide { framework?, intent?, attempts?, finalError?, timeSpentMs? }' });
      return;
    }
    const input: FailedBuildInput = {
      framework: typeof body.framework === 'string' ? body.framework.slice(0, 100) : undefined,
      intent: typeof body.intent === 'string' ? body.intent.slice(0, 500) : undefined,
      attempts: Array.isArray(body.attempts)
        ? body.attempts.filter((a: any) => a && typeof a.strategy === 'string').slice(0, MAX)
        : undefined,
      finalError: typeof body.finalError === 'string' ? body.finalError.slice(0, 4000) : undefined,
      timeSpentMs: typeof body.timeSpentMs === 'number' ? body.timeSpentMs : undefined,
    };
    res.json({ retrospective: buildRetrospective(input) });
  });

  // POST /api/retrospective/warnings — body { history: Retrospective[], query: {framework?,intent?}, topN? }
  app.post('/api/retrospective/warnings', (req: Request, res: Response) => {
    const body = req.body || {};
    if (!Array.isArray(body.history)) {
      res.status(400).json({ error: 'provide { history: Retrospective[], query: { framework?, intent? }, topN? }' });
      return;
    }
    const history = body.history.slice(0, MAX) as Retrospective[];
    const query = body.query && typeof body.query === 'object' ? body.query : {};
    const topN = typeof body.topN === 'number' ? Math.min(20, Math.max(1, body.topN)) : 3;
    res.json({ warnings: relevantWarnings(history, query, topN) });
  });
}
