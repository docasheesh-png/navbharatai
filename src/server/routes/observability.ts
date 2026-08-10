// P2.1 — Observability endpoints: recent distributed traces + live metrics.
//
// Read-only and non-secret. Gated by the admin password (same scheme as /api/agentv3/diag)
// because traces can include request paths/attributes. Never exposes credentials.

import type { Express, Request, Response } from 'express';
import { tracer } from '../observability/Tracer';
import { errorTracker } from '../observability/ErrorTracker';
import { getProviderStats } from '../AI/Router/AIRouter';
import { doraMetrics } from '../lib/DoraMetrics';
import { analyzeSeries, type Point } from '../lib/AnomalyDetector';
import { aggregateProviderLatency, type SpanLike } from '../lib/Percentiles';
import { adminRequestOk } from '../lib/adminAuth';

/**
 * Admin gate — the SHARED one (audit finding #3). This used to be a private copy that compared the
 * admin PASSWORD against `req.query.admin`, which wrote that password into Cloud Run access logs,
 * browser history and every proxy `Referer` on the way. It also used `===` on a secret, had no TTL
 * and no MFA. It now goes through the same timestamped, constant-time, expiring token the admin
 * panel uses — read from the `x-admin-token` header, never from a URL.
 */
const adminOk = (req: Request): boolean => adminRequestOk(req);

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

  // P-MON.2 — anomaly detection + trend/forecast over a metric series. Analyze a provided
  // series: body { series: number[] }  OR  { points: {t,v}[] }. Returns z/EWMA anomalies,
  // the linear trend, and an N-step forecast.
  app.post('/api/observability/anomaly', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const body = req.body || {};
    let points: Point[] = [];
    if (Array.isArray(body.points)) {
      points = body.points.filter((p: any) => p && typeof p.t === 'number' && typeof p.v === 'number');
    } else if (Array.isArray(body.series)) {
      points = body.series.filter((v: any) => typeof v === 'number').map((v: number, i: number) => ({ t: i, v }));
    } else {
      res.status(400).json({ error: 'provide { series: number[] } or { points: {t,v}[] }' });
      return;
    }
    const opts = {
      zThreshold: Number(body.zThreshold) || undefined,
      forecastHorizon: Number(body.forecastHorizon) || undefined,
    };
    res.json(analyzeSeries(points, opts));
  });

  // P-MON.2 — anomaly/trend analysis of LIVE data: the recent per-trace total durations
  // (a real latency series from the P2.1 tracer).
  app.get('/api/observability/anomaly/latency', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const series: Point[] = tracer.recentTraces(200).map((tr) => ({ t: tr.startMs, v: tr.durationMs }));
    res.json({ source: 'trace-latency', sampleCount: series.length, ...analyzeSeries(series) });
  });

  // P-MON.3 — LLM-ops: per-provider inference-latency percentiles (p50/p90/p95/p99) and
  // error rate, aggregated from the REAL `ai.provider.*` spans the AI router records.
  // ?limit=N traces (default 200, max 500).
  app.get('/api/observability/llm', (req: Request, res: Response) => {
    if (!adminOk(req)) { res.status(403).json({ error: 'admin only' }); return; }
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const traces = tracer.recentTraces(limit);
    const spans: SpanLike[] = [];
    for (const tr of traces) {
      for (const s of tr.spans) {
        spans.push({ name: s.name, durationMs: s.durationMs, status: s.status, attributes: s.attributes });
      }
    }
    const providers = aggregateProviderLatency(spans);
    res.json({
      source: 'trace-spans',
      tracesScanned: traces.length,
      providerSampleCount: providers.reduce((a, p) => a + p.latency.count, 0),
      providers,
      generatedAt: Date.now(),
    });
  });
}
