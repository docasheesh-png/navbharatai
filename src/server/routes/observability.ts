// P2.1 — Observability endpoints: recent distributed traces + live metrics.
//
// Read-only and non-secret. Gated by the admin password (same scheme as /api/agentv3/diag)
// because traces can include request paths/attributes. Never exposes credentials.

import type { Express, Request, Response } from 'express';
import { tracer } from '../observability/Tracer';
import { errorTracker } from '../observability/ErrorTracker';
import { getProviderStats } from '../AI/Router/AIRouter';
import { doraMetrics } from '../lib/DoraMetrics';

function adminOk(req: Request): boolean {
  return !!process.env.ADMIN_PASSWORD && req.query.admin === process.env.ADMIN_PASSWORD;
}

export function registerObservabilityRoutes(app: Express): void {
  // Recent traces (span trees), newest first. ?limit=N (default 50, max 200).
  app.get('/api/observability/traces', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json({ traces: tracer.recentTraces(limit) });
  });

  // Live metrics: span aggregates (count / error rate / avg / p95 per span name) +
  // per-provider circuit/latency stats. Real numbers from the running process.
  app.get('/api/observability/metrics', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    res.json({
      spans: tracer.spanStats(),
      providers: getProviderStats(),
      generatedAt: Date.now(),
    });
  });

  // P2.2 — recent captured errors (server + client) and a grouped summary. The same
  // errors are also in Cloud Error Reporting; this is the in-app admin view.
  app.get('/api/observability/errors', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({ errors: errorTracker.recent(limit), summary: errorTracker.summary() });
  });

  // P-DEPLOY.1 — DORA metrics (deployment frequency, change lead time, change failure rate,
  // MTTR + overall tier) over a window. ?days=N (default 30, max 365).
  app.get('/api/observability/dora', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    res.json(doraMetrics.summary(days * 86_400_000));
  });
}
