import { describe, it, expect } from 'vitest';
import { generateGrafanaStack, slugifyAppName, safePort } from './GrafanaStackGenerator';

describe('GrafanaStackGenerator — inputs are made safe', () => {
  it('slugifies any app name into something a job name and uid can hold', () => {
    expect(slugifyAppName('My Shop!')).toBe('my-shop');
    expect(slugifyAppName('  ')).toBe('app');
    expect(slugifyAppName(undefined)).toBe('app');
    expect(slugifyAppName('x'.repeat(200)).length).toBeLessThanOrEqual(40);
  });

  it('falls back to the default port rather than writing a nonsense target', () => {
    expect(safePort(8080)).toBe(8080);
    expect(safePort(0)).toBe(3000);
    expect(safePort(-1)).toBe(3000);
    expect(safePort(99999)).toBe(3000);
    expect(safePort(undefined)).toBe(3000);
    expect(safePort(NaN)).toBe(3000);
  });
});

describe('GrafanaStackGenerator — a stack that actually runs', () => {
  const out = generateGrafanaStack({ appPort: 4000, appName: 'Chai Shop' });

  it('emits every file the stack needs, and nothing half-wired', () => {
    expect(Object.keys(out.files).sort()).toEqual([
      'monitoring/README.md',
      'monitoring/docker-compose.yml',
      'monitoring/grafana/dashboards/app-overview.json',
      'monitoring/grafana/provisioning/dashboards/dashboards.yml',
      'monitoring/grafana/provisioning/datasources/prometheus.yml',
      'monitoring/prometheus.yml',
    ]);
  });

  it('scrapes the port it was told about', () => {
    expect(out.files['monitoring/prometheus.yml']).toContain("targets: ['host.docker.internal:4000']");
    expect(out.files['monitoring/prometheus.yml']).toContain("job_name: 'chai-shop'");
  });

  it('ships NO default Grafana password — the stack refuses to start without one', () => {
    const compose = out.files['monitoring/docker-compose.yml'];
    expect(compose).toContain('GRAFANA_ADMIN_PASSWORD:?');
    expect(compose).not.toMatch(/GF_SECURITY_ADMIN_PASSWORD=admin/);
    expect(compose).toContain('GF_AUTH_ANONYMOUS_ENABLED=false');
  });

  it('can reach the host on Linux, not just Mac and Windows', () => {
    // Without this line the stack comes up green and scrapes nothing on the platform most people deploy on.
    expect(out.files['monitoring/docker-compose.yml']).toContain('host.docker.internal:host-gateway');
  });

  it('does not put Grafana on the port the app usually occupies', () => {
    expect(out.files['monitoring/docker-compose.yml']).toContain("'3001:3000'");
  });

  it('provisions the datasource and the dashboard folder, so there is no import step', () => {
    expect(out.files['monitoring/grafana/provisioning/datasources/prometheus.yml']).toContain('url: http://prometheus:9090');
    expect(out.files['monitoring/grafana/provisioning/datasources/prometheus.yml']).toContain('uid: prometheus');
    expect(out.files['monitoring/grafana/provisioning/dashboards/dashboards.yml']).toContain('path: /var/lib/grafana/dashboards');
  });
});

describe('GrafanaStackGenerator — the dashboard is real, importable JSON', () => {
  const out = generateGrafanaStack({ appPort: 3000, appName: 'Chai Shop' });
  const dashboard = JSON.parse(out.files['monitoring/grafana/dashboards/app-overview.json']);

  it('parses and carries the fields Grafana provisioning requires', () => {
    expect(dashboard.title).toBe('Chai Shop — Overview');
    expect(dashboard.uid).toBe('chai-shop-overview');
    expect(dashboard.schemaVersion).toBeGreaterThan(0);
    expect(Array.isArray(dashboard.panels)).toBe(true);
    expect(dashboard.panels.length).toBeGreaterThanOrEqual(8);
    // No `id`, or Grafana treats it as an update to whatever dashboard already holds that id.
    expect(dashboard.id).toBeUndefined();
  });

  it('gives every panel a datasource, a query and a place on the grid', () => {
    for (const panel of dashboard.panels) {
      expect(panel.datasource.uid).toBe('prometheus');
      expect(panel.targets.length).toBeGreaterThan(0);
      for (const t of panel.targets) {
        expect(typeof t.expr).toBe('string');
        expect(t.expr.length).toBeGreaterThan(0);
        expect(t.refId).toBeTruthy();
      }
      expect(panel.gridPos.w).toBeGreaterThan(0);
      expect(panel.gridPos.h).toBeGreaterThan(0);
    }
  });

  it('queries the EXACT metric names the generated app exports — a typo here shows an empty graph, not an error', () => {
    const allExpr = dashboard.panels.flatMap((p: any) => p.targets.map((t: any) => t.expr)).join(' ');
    expect(allExpr).toContain('http_requests_total');
    expect(allExpr).toContain('http_request_duration_seconds_bucket');
    expect(allExpr).toContain('process_resident_memory_bytes');
    expect(allExpr).toContain('nodejs_eventloop_lag_seconds');
  });

  it('scopes every query to this app’s job, so a second app on the same Prometheus does not blend in', () => {
    const allExpr = dashboard.panels.flatMap((p: any) => p.targets.map((t: any) => t.expr));
    for (const expr of allExpr) expect(expr).toContain('job="chai-shop"');
  });

  it('computes the error rate as a share of traffic, not a raw count', () => {
    const errorPanel = dashboard.panels.find((p: any) => p.title === 'Error rate (5xx)');
    expect(errorPanel.targets[0].expr).toContain('status=~"5.."');
    expect(errorPanel.targets[0].expr).toContain('/');
    expect(errorPanel.fieldConfig.defaults.unit).toBe('percentunit');
  });
});
