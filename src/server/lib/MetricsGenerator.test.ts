import { describe, it, expect } from 'vitest';
import { generateMetrics } from './MetricsGenerator';

describe('generateMetrics', () => {
  it('emits a metrics lib + a /metrics route, and declares prom-client', () => {
    const out = generateMetrics();
    expect(Object.keys(out.files).sort()).toEqual([
      'server/lib/metrics.ts',
      'server/routes/metrics.routes.ts',
    ]);
    expect(out.dependencies).toEqual([{ name: 'prom-client', version: '^15' }]);
  });

  it('registers default metrics + an http counter and duration histogram, labelled to bound cardinality', () => {
    const lib = generateMetrics().files['server/lib/metrics.ts'];
    expect(lib).toContain('collectDefaultMetrics({ register })');
    expect(lib).toContain("name: 'http_requests_total'");
    expect(lib).toContain("name: 'http_request_duration_seconds'");
    expect(lib).toContain('req.route?.path'); // matched route pattern, not raw path
    expect(lib).toContain('export function metricsMiddleware');
  });

  it('the route exposes the Prometheus text format', () => {
    const route = generateMetrics().files['server/routes/metrics.routes.ts'];
    expect(route).toContain("res.set('Content-Type', register.contentType)");
    expect(route).toContain('await register.metrics()');
  });
});
