// T2.8 (roadmap 2026-07-19) — Prometheus metrics generator (Tier-2, observability).
//
// The audit's DevOps ❌ included "Metrics" (structured logging already exists via generate_observability,
// but there was no metrics endpoint). This emits a real Prometheus setup on prom-client:
//   • server/lib/metrics.ts — a registry with default process metrics + an HTTP request counter and a
//     duration histogram, and a middleware that records count + latency per request,
//   • server/routes/metrics.routes.ts — GET /metrics in the Prometheus text format for a scraper.
// PURE builder → the caller writes the files. Real, complete code — no stubs (the real-features rule).

import { generateGrafanaStack, type GrafanaStackOptions } from './GrafanaStackGenerator';

export interface MetricsOptions extends GrafanaStackOptions {
  /**
   * Also emit the runnable monitoring/ stack (Prometheus + a provisioned Grafana dashboard).
   *
   * Default TRUE, because "here is a /metrics endpoint, now go build a dashboard" is homework most
   * people never do — the endpoint then sits there unread and the feature is real in name only.
   */
  includeGrafanaStack?: boolean;
}

export interface MetricsResult {
  files: Record<string, string>;
  dependencies: Array<{ name: string; version: string }>;
  instructions: string;
}

/** Generate a Prometheus metrics integration (registry + request middleware + /metrics route) and,
 *  by default, the runnable Grafana stack that turns it into an actual dashboard. Pure. */
export function generateMetrics(opts: MetricsOptions = {}): MetricsResult {
  const libFile = `import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

// A dedicated registry with the standard process/Node metrics (event-loop lag, heap, GC, …).
export const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

// Record a count + latency for every request. Mount early: app.use(metricsMiddleware).
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const stop = httpDuration.startTimer();
  res.on('finish', () => {
    // Use the matched route pattern (not the raw path) so /users/123 and /users/456 share one label set
    // and the metric cardinality stays bounded.
    const route = (req.route?.path as string) ?? req.path ?? 'unknown';
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    stop(labels);
  });
  next();
}
`;

  const routeFile = `import { Router } from 'express';
import { register } from '../lib/metrics';

// GET /metrics — the Prometheus scrape endpoint (text exposition format). In production, restrict it to
// your monitoring network or guard it (e.g. requireRole('admin')).
const router = Router();

router.get('/', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

export default router;
`;

  const wantsStack = opts.includeGrafanaStack !== false;
  const stack = wantsStack ? generateGrafanaStack(opts) : null;

  return {
    files: {
      'server/lib/metrics.ts': libFile,
      'server/routes/metrics.routes.ts': routeFile,
      ...(stack ? stack.files : {}),
    },
    dependencies: [{ name: 'prom-client', version: '^15' }],
    instructions:
      'Wired Prometheus metrics (prom-client). Mount the middleware early and expose the endpoint:\n' +
      "  app.use(metricsMiddleware); // from server/lib/metrics.ts\n" +
      "  app.use('/metrics', metricsRouter); // from server/routes/metrics.routes.ts\n" +
      'It reports default process metrics plus http_requests_total and http_request_duration_seconds ' +
      '(labelled by method/route/status). Restrict /metrics to your monitoring network in production.' +
      (stack ? `\n\n${stack.instructions}` : ''),
  };
}
