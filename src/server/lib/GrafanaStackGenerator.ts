/**
 * GRAFANA STACK — a monitoring setup the user can actually RUN, not just scrape.
 *
 * WHY THIS EXISTS. NavBharatAI already generated a real Prometheus `/metrics` endpoint for a user's
 * app (MetricsGenerator.ts) and told them to "point Prometheus/Grafana at it". That instruction is
 * true and useless: it hands a non-infrastructure developer raw numbers and a homework assignment.
 * Almost nobody builds the dashboard, so the metrics endpoint sits there unread.
 *
 * This emits the other half — a `monitoring/` folder that starts Prometheus and Grafana with one
 * command and opens on a dashboard that is already populated from their app's own metrics. It is the
 * difference between "your app exposes metrics" and "here is your app's graph".
 *
 * THREE DECISIONS WORTH KEEPING:
 *
 * 1. NO DEFAULT PASSWORD. Grafana's factory login is admin/admin, and a monitoring console shipped
 *    with a known password is a real hole, not a convenience. The compose file requires
 *    GRAFANA_ADMIN_PASSWORD and FAILS with a readable message when it is unset — a refusal to start
 *    is honest; a working console anyone can log into is not.
 *
 * 2. IT REACHES THE APP ON LINUX TOO. `host.docker.internal` resolves on Mac and Windows but not on
 *    plain Linux Docker, which is where most people actually deploy; the `host-gateway` extra_hosts
 *    entry is what stops the whole stack coming up green and scraping nothing.
 *
 * 3. IMAGES ARE UNPINNED ON PURPOSE, AND SAID SO. A pinned tag we cannot verify here could be a tag
 *    that does not exist, and a stack that fails to pull is worse than one that drifts. The README
 *    tells the user to pin before production instead of pretending we chose a version for them.
 */

export interface GrafanaStackOptions {
  /** The port the user's app listens on — what Prometheus scrapes. */
  appPort?: number;
  /** Shown as the dashboard title and the Prometheus job name. */
  appName?: string;
}

export interface GrafanaStackResult {
  files: Record<string, string>;
  instructions: string;
}

const DEFAULT_PORT = 3000;

/** Docker/Prometheus job names allow a narrow character set; an app title does not. Pure. */
export function slugifyAppName(name: string | undefined): string {
  const slug = String(name || 'app').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, 40) || 'app';
}

/** A port we are willing to write into a config file. Anything else falls back to the default. Pure. */
export function safePort(port: number | undefined): number {
  return Number.isFinite(port) && (port as number) > 0 && (port as number) <= 65535
    ? Math.floor(port as number)
    : DEFAULT_PORT;
}

/**
 * Build the `monitoring/` folder: Prometheus config, a provisioned Grafana, and a dashboard already
 * wired to the metrics MetricsGenerator emits. Pure — the caller writes the files.
 */
export function generateGrafanaStack(opts: GrafanaStackOptions = {}): GrafanaStackResult {
  const port = safePort(opts.appPort);
  const job = slugifyAppName(opts.appName);
  const title = (opts.appName || 'App').trim() || 'App';

  const prometheusYml = `# Prometheus — scrapes your app's /metrics endpoint every 15 seconds.
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: '${job}'
    metrics_path: /metrics
    static_configs:
      # host.docker.internal points at YOUR machine from inside the container. If your app runs in
      # docker-compose too, replace this with the service name and port, e.g. 'api:${port}'.
      - targets: ['host.docker.internal:${port}']

  # Prometheus scraping itself — useful for telling "my app is down" apart from "the scraper is down".
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
`;

  const dockerCompose = `# Monitoring stack for ${title} — Prometheus (collects) + Grafana (draws).
#
#   GRAFANA_ADMIN_PASSWORD='choose-a-real-password' docker compose -f monitoring/docker-compose.yml up -d
#
# Then open http://localhost:3001 and log in as 'admin' with that password. The dashboard is already
# there — no import step.
services:
  prometheus:
    image: prom/prometheus:latest
    container_name: ${job}-prometheus
    restart: unless-stopped
    ports:
      - '9090:9090'
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    # Without this, 'host.docker.internal' does not resolve on Linux and the stack comes up green
    # while scraping nothing at all.
    extra_hosts:
      - 'host.docker.internal:host-gateway'

  grafana:
    image: grafana/grafana:latest
    container_name: ${job}-grafana
    restart: unless-stopped
    depends_on:
      - prometheus
    ports:
      # 3001 on the host, because 3000 is usually the app itself.
      - '3001:3000'
    environment:
      # No default password: the stack REFUSES to start rather than exposing a console with the
      # factory admin/admin login.
      - GF_SECURITY_ADMIN_PASSWORD=\${GRAFANA_ADMIN_PASSWORD:?set GRAFANA_ADMIN_PASSWORD before starting}
      - GF_AUTH_ANONYMOUS_ENABLED=false
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana

volumes:
  prometheus-data:
  grafana-data:
`;

  const datasourceYml = `# Auto-provisioned datasource — Grafana finds Prometheus with no clicking.
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false
`;

  const dashboardProviderYml = `# Auto-provisioned dashboards — anything in this folder loads on startup.
apiVersion: 1

providers:
  - name: '${job}-dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
`;

  const dashboard = buildDashboard(title, job);

  const readme = `# Monitoring — ${title}

Prometheus collects the numbers, Grafana draws them. Your app already exposes them at \`/metrics\`.

## Start it

\`\`\`bash
GRAFANA_ADMIN_PASSWORD='choose-a-real-password' docker compose -f monitoring/docker-compose.yml up -d
\`\`\`

- Grafana: <http://localhost:3001> — user \`admin\`, the password you just set
- Prometheus: <http://localhost:9090>

The dashboard "${title} — Overview" is already loaded. There is no import step.

## If the graphs are empty

1. Open <http://localhost:9090/targets>. Your app should be **UP**.
2. If it is DOWN, Prometheus cannot reach your app. Check that the app is running on port **${port}**,
   and that \`metricsMiddleware\` is mounted **before** your routes — without it, requests are never
   counted.
3. If your app runs inside docker-compose as well, replace \`host.docker.internal:${port}\` in
   \`prometheus.yml\` with your service name, e.g. \`api:${port}\`.

## What the dashboard shows

| Panel | What it answers |
|---|---|
| Request rate | How much traffic the app is taking |
| Error rate (5xx) | What share of requests is failing right now |
| Latency p95 / p50 | What a slow user actually experiences, not the average |
| Busiest routes | Which endpoint is carrying the load |
| Memory | Whether memory climbs and never comes back (a leak) |
| Event-loop lag | Whether something is blocking Node's single thread |

## Before production

- **Pin the image versions.** \`docker-compose.yml\` uses \`:latest\` so it always pulls; pin both
  images to a version you have tested before you rely on this.
- **Do not expose \`/metrics\` publicly.** It describes your traffic in detail. Restrict it to your
  monitoring network, or guard the route.
- **Persist and back up** the \`prometheus-data\` volume if you need history to survive a rebuild.
`;

  return {
    files: {
      'monitoring/prometheus.yml': prometheusYml,
      'monitoring/docker-compose.yml': dockerCompose,
      'monitoring/grafana/provisioning/datasources/prometheus.yml': datasourceYml,
      'monitoring/grafana/provisioning/dashboards/dashboards.yml': dashboardProviderYml,
      'monitoring/grafana/dashboards/app-overview.json': dashboard,
      'monitoring/README.md': readme,
    },
    instructions:
      `Added a runnable monitoring stack under monitoring/. Start it with:\n` +
      `  GRAFANA_ADMIN_PASSWORD='choose-a-real-password' docker compose -f monitoring/docker-compose.yml up -d\n` +
      `Grafana opens at http://localhost:3001 (user 'admin') with the "${title} — Overview" dashboard ` +
      `already loaded — request rate, 5xx error rate, latency percentiles, busiest routes, memory and ` +
      `event-loop lag, all from your app's own /metrics. Prometheus scrapes port ${port}; change that ` +
      `target in monitoring/prometheus.yml if your app listens elsewhere. There is deliberately NO ` +
      `default Grafana password — the stack refuses to start until you set one.`,
  };
}

interface PanelSpec {
  title: string;
  description: string;
  targets: Array<{ expr: string; legend: string }>;
  unit: string;
  type: 'timeseries' | 'stat';
  gridPos: { h: number; w: number; x: number; y: number };
  decimals?: number;
}

/** The panels, as PromQL over exactly the metric names MetricsGenerator emits. */
function panelSpecs(job: string): PanelSpec[] {
  const j = `{job="${job}"}`;
  return [
    {
      title: 'Request rate',
      description: 'Requests per second, averaged over 5 minutes.',
      targets: [{ expr: `sum(rate(http_requests_total${j}[5m]))`, legend: 'req/s' }],
      unit: 'reqps', type: 'stat', gridPos: { h: 4, w: 6, x: 0, y: 0 },
    },
    {
      title: 'Error rate (5xx)',
      description: 'Share of requests failing with a server error. Empty means no traffic, not zero errors.',
      targets: [{
        expr: `sum(rate(http_requests_total{job="${job}",status=~"5.."}[5m])) / sum(rate(http_requests_total${j}[5m]))`,
        legend: '5xx share',
      }],
      unit: 'percentunit', type: 'stat', gridPos: { h: 4, w: 6, x: 6, y: 0 }, decimals: 2,
    },
    {
      title: 'Latency p95',
      description: 'What a slow request costs — the average hides exactly this.',
      targets: [{
        expr: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket${j}[5m])) by (le))`,
        legend: 'p95',
      }],
      unit: 's', type: 'stat', gridPos: { h: 4, w: 6, x: 12, y: 0 },
    },
    {
      title: 'Memory',
      description: 'Resident memory. A line that climbs and never comes back down is a leak.',
      targets: [{ expr: `process_resident_memory_bytes${j}`, legend: 'resident' }],
      unit: 'bytes', type: 'stat', gridPos: { h: 4, w: 6, x: 18, y: 0 },
    },
    {
      title: 'Requests over time',
      description: 'Traffic split by response status, so a rise in failures separates from a rise in load.',
      targets: [{ expr: `sum by (status) (rate(http_requests_total${j}[5m]))`, legend: '{{status}}' }],
      unit: 'reqps', type: 'timeseries', gridPos: { h: 8, w: 12, x: 0, y: 4 },
    },
    {
      title: 'Latency percentiles',
      description: 'p50 against p95 — when they separate, some requests are much slower than typical.',
      targets: [
        { expr: `histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket${j}[5m])) by (le))`, legend: 'p50' },
        { expr: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket${j}[5m])) by (le))`, legend: 'p95' },
        { expr: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket${j}[5m])) by (le))`, legend: 'p99' },
      ],
      unit: 's', type: 'timeseries', gridPos: { h: 8, w: 12, x: 12, y: 4 },
    },
    {
      title: 'Busiest routes',
      description: 'The five endpoints carrying the most traffic.',
      targets: [{ expr: `topk(5, sum by (route) (rate(http_requests_total${j}[5m])))`, legend: '{{route}}' }],
      unit: 'reqps', type: 'timeseries', gridPos: { h: 8, w: 12, x: 0, y: 12 },
    },
    {
      title: 'Event-loop lag',
      description: 'How long Node waited to run scheduled work. Sustained lag means something is blocking the single thread.',
      targets: [{ expr: `nodejs_eventloop_lag_seconds${j}`, legend: 'lag' }],
      unit: 's', type: 'timeseries', gridPos: { h: 8, w: 12, x: 12, y: 12 },
    },
  ];
}

/** Serialise the dashboard to the JSON Grafana provisioning expects. Pure. */
function buildDashboard(title: string, job: string): string {
  const panels = panelSpecs(job).map((p, i) => ({
    id: i + 1,
    type: p.type,
    title: p.title,
    description: p.description,
    datasource: { type: 'prometheus', uid: 'prometheus' },
    gridPos: p.gridPos,
    fieldConfig: {
      defaults: {
        unit: p.unit,
        ...(p.decimals != null ? { decimals: p.decimals } : {}),
        color: { mode: 'palette-classic' },
        custom: p.type === 'timeseries'
          ? { lineWidth: 2, fillOpacity: 10, showPoints: 'never' }
          : {},
      },
      overrides: [],
    },
    options: p.type === 'stat'
      ? { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, textMode: 'auto', colorMode: 'value' }
      : { legend: { displayMode: 'list', placement: 'bottom', showLegend: true }, tooltip: { mode: 'multi', sort: 'desc' } },
    targets: p.targets.map((t, ti) => ({
      refId: String.fromCharCode(65 + ti),
      expr: t.expr,
      legendFormat: t.legend,
      datasource: { type: 'prometheus', uid: 'prometheus' },
    })),
  }));

  return JSON.stringify({
    // No `id`, so Grafana treats this as a new dashboard rather than colliding with an existing one.
    uid: `${job}-overview`.slice(0, 40),
    title: `${title} — Overview`,
    description: `Live health for ${title}, from its own /metrics endpoint. Generated by NavBharatAI.`,
    tags: ['navbharatai', job],
    timezone: 'browser',
    schemaVersion: 39,
    version: 1,
    refresh: '30s',
    time: { from: 'now-6h', to: 'now' },
    editable: true,
    panels,
  }, null, 2) + '\n';
}
