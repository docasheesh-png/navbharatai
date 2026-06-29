// P-MON.2 — Anomaly Detection + Trend Analysis + Forecasting.
//
// A dependency-free statistical engine over a numeric metric time-series:
//   • z-score anomalies         — points whose deviation from the mean exceeds N stddev
//   • EWMA-deviation anomalies  — points that jump far from the exponentially-weighted
//                                 moving average (catches level shifts a global z-score misses)
//   • linear trend + forecast   — least-squares slope/intercept, projected forward N steps
//
// All functions are PURE and unit-tested. Used by the admin observability endpoint to flag
// anomalies and forecast a metric (latency, error rate, cost, …). No data is fabricated:
// short series honestly return no anomalies / a null forecast.

export interface Point { t: number; v: number }

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Population standard deviation. */
export function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

/** z-score of each value: (v - mean) / stddev. All-zero when stddev is 0 (flat series). */
export function zScores(values: number[]): number[] {
  const m = mean(values);
  const sd = stddev(values);
  if (sd === 0) return values.map(() => 0);
  return values.map((v) => (v - m) / sd);
}

/** Indices whose |z-score| exceeds `threshold` (default 3σ). */
export function detectZAnomalies(values: number[], threshold = 3): number[] {
  const z = zScores(values);
  const out: number[] = [];
  for (let i = 0; i < z.length; i++) if (Math.abs(z[i]) > threshold) out.push(i);
  return out;
}

/** Exponentially-weighted moving average series (alpha in (0,1]; higher = more reactive). */
export function ewma(values: number[], alpha = 0.3): number[] {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : alpha * values[i] + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

/**
 * Anomalies vs. the EWMA: a point is anomalous when |value − ewma_so_far| exceeds
 * `k` × (rolling stddev of the residuals). Catches sudden level shifts. Returns indices.
 */
export function detectEwmaAnomalies(values: number[], alpha = 0.3, k = 3): number[] {
  if (values.length < 4) return [];
  const smoothed = ewma(values, alpha);
  const residuals = values.map((v, i) => v - smoothed[i]);
  const sd = stddev(residuals);
  if (sd === 0) return [];
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) if (Math.abs(residuals[i]) > k * sd) out.push(i);
  return out;
}

/** Least-squares linear trend over points (x = t). Returns slope (per unit t) + intercept. */
export function linearTrend(points: Point[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const sx = points.reduce((a, p) => a + p.t, 0);
  const sy = points.reduce((a, p) => a + p.v, 0);
  const sxx = points.reduce((a, p) => a + p.t * p.t, 0);
  const sxy = points.reduce((a, p) => a + p.t * p.v, 0);
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

/**
 * Forecast the next `horizon` points by projecting the linear trend, stepping t by the
 * median spacing of the input. Returns [] when the trend can't be computed.
 */
export function forecast(points: Point[], horizon: number): Point[] {
  const trend = linearTrend(points);
  if (!trend || horizon <= 0) return [];
  const ts = points.map((p) => p.t).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const lastT = ts[ts.length - 1];
  const out: Point[] = [];
  for (let i = 1; i <= horizon; i++) {
    const t = lastT + i * step;
    out.push({ t, v: trend.slope * t + trend.intercept });
  }
  return out;
}

export interface AnomalyReport {
  count: number;
  zAnomalies: Array<{ index: number; t: number; v: number; z: number }>;
  ewmaAnomalies: Array<{ index: number; t: number; v: number }>;
  trend: { slope: number; intercept: number; direction: 'rising' | 'falling' | 'flat' } | null;
  forecast: Point[];
  stats: { count: number; mean: number; stddev: number; min: number; max: number };
}

/** Full analysis of a metric series. Pure. */
export function analyzeSeries(points: Point[], opts: { zThreshold?: number; ewmaAlpha?: number; ewmaK?: number; forecastHorizon?: number } = {}): AnomalyReport {
  const { zThreshold = 3, ewmaAlpha = 0.3, ewmaK = 3, forecastHorizon = 5 } = opts;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const values = sorted.map((p) => p.v);
  const z = zScores(values);
  const zIdx = detectZAnomalies(values, zThreshold);
  const ewmaIdx = detectEwmaAnomalies(values, ewmaAlpha, ewmaK);
  const trend = linearTrend(sorted);
  return {
    count: values.length,
    zAnomalies: zIdx.map((i) => ({ index: i, t: sorted[i].t, v: sorted[i].v, z: Math.round(z[i] * 1000) / 1000 })),
    ewmaAnomalies: ewmaIdx.map((i) => ({ index: i, t: sorted[i].t, v: sorted[i].v })),
    trend: trend ? { ...trend, direction: trend.slope > 1e-9 ? 'rising' : trend.slope < -1e-9 ? 'falling' : 'flat' } : null,
    forecast: forecast(sorted, forecastHorizon),
    stats: {
      count: values.length,
      mean: Math.round(mean(values) * 1000) / 1000,
      stddev: Math.round(stddev(values) * 1000) / 1000,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    },
  };
}
