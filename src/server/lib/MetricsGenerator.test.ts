import { describe, it, expect } from 'vitest';
import { generateMetrics } from './MetricsGenerator';

describe('generateMetrics', () => {
  it('emits a metrics lib + a /metrics route, and declares prom-client', () => {
    const out = generateMetrics();
    expect(Object.keys(out.files)).toContain('server/lib/metrics.ts');
    expect(Object.keys(out.files)).toContain('server/routes/metrics.routes.ts');
    expect(out.dependencies).toEqual([{ name: 'prom-client', version: '^15' }]);
  });

  it('ships the runnable Grafana stack BY DEFAULT — an unread /metrics endpoint is homework, not a feature', () => {
    const files = Object.keys(generateMetrics().files);
    expect(files).toContain('monitoring/docker-compose.yml');
    expect(files).toContain('monitoring/grafana/dashboards/app-overview.json');
    expect(files).toContain('monitoring/README.md');
  });

  it('can emit the endpoint alone when the caller does not want the stack', () => {
    const files = Object.keys(generateMetrics({ includeGrafanaStack: false }).files).sort();
    expect(files).toEqual(['server/lib/metrics.ts', 'server/routes/metrics.routes.ts']);
  });

  it('passes the app port and name through to the Prometheus target and the dashboard title', () => {
    const out = generateMetrics({ appPort: 8080, appName: 'Chai Shop' });
    expect(out.files['monitoring/prometheus.yml']).toContain('host.docker.internal:8080');
    expect(out.files['monitoring/grafana/dashboards/app-overview.json']).toContain('Chai Shop — Overview');
  });

  it('tells the user how to start it, not just that metrics exist', () => {
    expect(generateMetrics().instructions).toContain('docker compose -f monitoring/docker-compose.yml up -d');
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
