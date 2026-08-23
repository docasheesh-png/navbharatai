/**
 * MONITOR — pure formatting + shaping for the admin's observability home.
 *
 * Everything a panel needs to DECIDE (what a number means, what to call it, whether we actually know
 * it) lives here as pure functions, so it is unit-tested without a DOM. The component stays a thin
 * renderer. The recurring rule across this file: a value we do not have is `null` and renders as
 * "—", never as 0 — a zero drawn where there is no measurement is a fake reading.
 */

export interface MonitorPoint {
  t: number;
  observed: boolean;
  builds: number;
  buildsOk: number;
  buildsFailed: number;
  buildMs: number;
  previewOk: number;
  aiRequests: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  sandboxSeconds: number;
}

export const RANGE_OPTIONS = [
  { hours: 1, label: 'Last 1 hour' },
  { hours: 6, label: 'Last 6 hours' },
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
] as const;

export type RangeHours = (typeof RANGE_OPTIONS)[number]['hours'];

/** Clock label for a bucket. Longer windows need the date, or every tick reads the same. */
export function timeLabel(ms: number, windowHours: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (windowHours > 24) return `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
  return `${hh}:${mm}`;
}

/** A duration a non-technical reader can act on: "4.2s", "3m 10s", "1h 4m". */
export function humanDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** A percentage, or "—" when the rate is unknown. Never renders an unknown as 0%. */
export function percent(rate: number | null | undefined, digits = 0): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Compact token counts — 12,400 reads worse than 12.4K on a stat tile. */
export function compactNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Rupees from micro-dollars at the live rate. Returns null when the rate is unknown — the White-Label
 *  Law's honesty half: an invented conversion is an invented bill. */
export function microUsdToInr(microUsd: number | null | undefined, usdInr: number | null | undefined): number | null {
  if (microUsd == null || !Number.isFinite(microUsd)) return null;
  if (usdInr == null || !Number.isFinite(usdInr) || usdInr <= 0) return null;
  return (microUsd / 1_000_000) * usdInr;
}

export function formatInr(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export type SeriesKey = 'builds' | 'cost' | 'tokens' | 'latency';

/**
 * Pull one plottable series out of the points.
 *
 * `latency` is the one that needs care: average build time is only defined for buckets that HAD a
 * build, so an empty bucket contributes 0 — which would drag a latency line toward zero and make a
 * quiet hour look fast. Empty buckets are carried at the previous known value instead, and the very
 * first ones (before any build exists) stay 0 because there is genuinely nothing to carry.
 */
export function extractSeries(points: MonitorPoint[], key: SeriesKey): number[] {
  const pts = points || [];
  if (key === 'builds') return pts.map((p) => p.builds || 0);
  if (key === 'cost') return pts.map((p) => (p.costMicroUsd || 0) / 1_000_000);
  if (key === 'tokens') return pts.map((p) => (p.inputTokens || 0) + (p.outputTokens || 0));
  let carried = 0;
  return pts.map((p) => {
    if ((p.builds || 0) > 0) {
      carried = (p.buildMs || 0) / (p.builds || 1);
      return carried;
    }
    return carried;
  });
}

export interface MonitorTotals {
  /** Real E2B VM seconds the window's builds held — our infrastructure cost, not a user charge. */
  sandboxSeconds: number;
  builds: number;
  buildsOk: number;
  buildsFailed: number;
  successRate: number | null;
  previewRate: number | null;
  avgBuildMs: number | null;
  tokens: number;
  costUsd: number;
  costMicroUsd: number;
  /** True when at least one bucket in the window was genuinely written. */
  anyActivity: boolean;
}

/** Total a window up, keeping "we have no measurement" distinct from "the measurement is zero". */
export function totalsFor(points: MonitorPoint[]): MonitorTotals {
  const pts = points || [];
  let builds = 0, buildsOk = 0, buildsFailed = 0, previewOk = 0, buildMs = 0, tokens = 0, costMicroUsd = 0;
  let sandboxSeconds = 0;
  let observed = false;
  for (const p of pts) {
    sandboxSeconds += p.sandboxSeconds || 0;
    builds += p.builds || 0;
    buildsOk += p.buildsOk || 0;
    buildsFailed += p.buildsFailed || 0;
    previewOk += p.previewOk || 0;
    buildMs += p.buildMs || 0;
    tokens += (p.inputTokens || 0) + (p.outputTokens || 0);
    costMicroUsd += p.costMicroUsd || 0;
    if (p.observed) observed = true;
  }
  return {
    sandboxSeconds,
    builds,
    buildsOk,
    buildsFailed,
    successRate: builds > 0 ? buildsOk / builds : null,
    previewRate: builds > 0 ? previewOk / builds : null,
    avgBuildMs: builds > 0 ? buildMs / builds : null,
    tokens,
    costUsd: costMicroUsd / 1_000_000,
    costMicroUsd,
    anyActivity: observed,
  };
}

export type FeedState = 'loading' | 'unavailable' | 'idle' | 'live';

/**
 * What the page should SAY about its own data feed.
 *
 * This is the honesty gate of the whole screen. A dashboard whose backend is down looks exactly like
 * a dashboard reporting a calm night — both are flat and green — so the two must never be allowed to
 * render the same way. `unavailable` means we could not read the store and the charts must be
 * suppressed; `idle` means the store answered and nothing happened.
 */
export function feedState(opts: {
  loading: boolean;
  error: string | null;
  available: boolean | undefined;
  hasData: boolean | undefined;
}): FeedState {
  if (opts.loading) return 'loading';
  if (opts.error || opts.available === false) return 'unavailable';
  return opts.hasData ? 'live' : 'idle';
}

export function feedMessage(state: FeedState, windowLabel: string): string {
  switch (state) {
    case 'loading': return 'Reading live telemetry…';
    case 'unavailable':
      return 'Live telemetry could not be read right now, so no chart is drawn. This says nothing about whether the platform is healthy — it means we cannot see. Charts return on their own once the store is reachable.';
    case 'idle': return `Telemetry is live and nothing has been recorded in the ${windowLabel.toLowerCase()}. That is a real zero, not a missing reading.`;
    default: return '';
  }
}

export interface ProviderRow {
  name: string;
  requests: number;
  tokens: number;
  costUsd: number;
  share: number;
}

/** Providers sorted by spend, with each one's share of it. ADMIN-ONLY — provider names must never
 *  reach a user surface (the White-Label Law, §3 allows exactly this: admin diagnostics). */
export function providerRows(providers: Record<string, { requests?: number; inputTokens?: number; outputTokens?: number; costMicroUsd?: number }> | null | undefined): ProviderRow[] {
  const entries = Object.entries(providers || {});
  const rows = entries.map(([name, p]) => ({
    name,
    requests: p?.requests || 0,
    tokens: (p?.inputTokens || 0) + (p?.outputTokens || 0),
    costUsd: (p?.costMicroUsd || 0) / 1_000_000,
    share: 0,
  }));
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  // Fall back to token share when nothing has a measured cost, so the split is still meaningful.
  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  for (const r of rows) {
    r.share = totalCost > 0 ? r.costUsd / totalCost : totalTokens > 0 ? r.tokens / totalTokens : 0;
  }
  return rows.sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

/** Colour a build-success rate by what it means operationally, not by taste. */
export function rateTone(rate: number | null | undefined): 'good' | 'warn' | 'bad' | 'unknown' {
  if (rate == null || !Number.isFinite(rate)) return 'unknown';
  if (rate >= 0.9) return 'good';
  if (rate >= 0.7) return 'warn';
  return 'bad';
}

/** Bytes as a human size. Unknown stays "—" rather than becoming 0 B. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/**
 * The one-line verdict on server load, in words the admin can act on.
 *
 * Deliberately says what it MEANS rather than repeating the number: "the server is keeping up" is
 * actionable, "p99 event loop delay 32ms" is not — and the numbers are right there beside it anyway.
 */
export function serverLoadHeadline(level: 'ok' | 'warn' | 'critical' | undefined, reason: string | undefined): string {
  if (!level) return 'Server load could not be read on this request.';
  if (level === 'ok') return 'This server is keeping up comfortably.';
  const because = reason ? ` — ${reason}` : '';
  return level === 'critical'
    ? `This server is struggling${because}.`
    : `This server is under pressure${because}.`;
}
