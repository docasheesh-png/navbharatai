// P-DESIGN.4 — Chart geometry (pure). Dependency-free SVG data-viz: all layout math lives here as
// pure functions (numbers in → coordinates out), unit-tested without a DOM, and consumed by the thin
// SVG chart components in this folder. No recharts/chart.js dependency — keeps the app dependency-free.

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

/** Round a max up to a "nice" axis bound (1/2/5 × 10ⁿ). Pure. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const norm = max / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/** Lay out vertical bars in a chart area. gapRatio ∈ [0,1) is the fraction of each slot used as gap. Pure. */
export function barLayout(
  values: number[],
  opts: { width: number; height: number; gapRatio?: number; max?: number },
): BarRect[] {
  const { width, height } = opts;
  const vals = (values || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const n = vals.length;
  if (n === 0 || width <= 0 || height <= 0) return [];
  const gapRatio = Math.min(0.9, Math.max(0, opts.gapRatio ?? 0.3));
  const max = opts.max && opts.max > 0 ? opts.max : niceMax(Math.max(...vals, 1));
  const slot = width / n;
  const barW = slot * (1 - gapRatio);
  return vals.map((value, i) => {
    const h = (value / max) * height;
    return { x: i * slot + (slot - barW) / 2, y: height - h, width: barW, height: h, value };
  });
}

/** Build an SVG polyline `points` string for a line/sparkline over the values. Pure. */
export function linePoints(values: number[], opts: { width: number; height: number; max?: number }): string {
  const { width, height } = opts;
  const vals = (values || []).map((v) => (Number.isFinite(v) ? v : 0));
  const n = vals.length;
  if (n === 0 || width <= 0 || height <= 0) return '';
  const max = opts.max && opts.max > 0 ? opts.max : niceMax(Math.max(...vals, 1));
  const step = n === 1 ? 0 : width / (n - 1);
  return vals
    .map((v, i) => {
      const x = n === 1 ? width / 2 : i * step;
      const y = height - (Math.max(0, v) / max) * height;
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

export interface DonutSegment {
  value: number;
  fraction: number;
  /** stroke-dasharray length for this segment (out of `circumference`). */
  length: number;
  /** stroke-dashoffset that positions this segment after the previous ones. */
  offset: number;
}

/**
 * Split values into donut ring segments using the stroke-dasharray technique (out of a normalised
 * circumference, default 100). Segments are placed head-to-tail; offset is negative-accumulated. Pure.
 */
export function donutSegments(values: number[], circumference = 100): DonutSegment[] {
  const vals = (values || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  return vals.map((value) => {
    const fraction = value / total;
    const length = fraction * circumference;
    const seg: DonutSegment = { value, fraction, length: round(length), offset: round(-acc) || 0 };
    acc += length;
    return seg;
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface StackedBarRect extends BarRect {
  /** Which series this rect belongs to (index into the `series` array). */
  seriesIndex: number;
  /** Which bucket/column it sits in. */
  slotIndex: number;
}

/**
 * Lay out STACKED vertical bars: `series[s][i]` is series `s`'s value in column `i`. Segments are
 * stacked bottom-up in series order, and the axis max is the tallest COLUMN TOTAL — not the tallest
 * single value, which would let a stack overflow the chart area.
 *
 * This is what draws "succeeded vs failed builds per 5 minutes" as one bar per bucket. Pure.
 */
export function stackedBarLayout(
  series: number[][],
  opts: { width: number; height: number; gapRatio?: number; max?: number },
): StackedBarRect[] {
  const { width, height } = opts;
  const rows = (series || []).map((row) => (row || []).map((v) => (Number.isFinite(v) && v > 0 ? v : 0)));
  const columns = rows.reduce((m, row) => Math.max(m, row.length), 0);
  if (rows.length === 0 || columns === 0 || width <= 0 || height <= 0) return [];

  const totals: number[] = [];
  for (let i = 0; i < columns; i++) totals.push(rows.reduce((sum, row) => sum + (row[i] ?? 0), 0));

  const max = opts.max && opts.max > 0 ? opts.max : niceMax(Math.max(...totals, 1));
  const gapRatio = Math.min(0.9, Math.max(0, opts.gapRatio ?? 0.3));
  const slot = width / columns;
  const barW = slot * (1 - gapRatio);

  const out: StackedBarRect[] = [];
  for (let i = 0; i < columns; i++) {
    let stackedHeight = 0;
    for (let s = 0; s < rows.length; s++) {
      const value = rows[s][i] ?? 0;
      if (value <= 0) continue;
      const h = (value / max) * height;
      out.push({
        x: round(i * slot + (slot - barW) / 2),
        y: round(height - stackedHeight - h),
        width: round(barW),
        height: round(h),
        value,
        seriesIndex: s,
        slotIndex: i,
      });
      stackedHeight += h;
    }
  }
  return out;
}

/**
 * Pick evenly spaced label positions along an axis of `count` items, at most `maxTicks` of them —
 * so a 72-bucket chart shows ~6 readable time labels instead of 72 overlapping ones. Pure.
 */
export function axisTickIndices(count: number, maxTicks = 6): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const ticks = Math.max(2, Math.min(maxTicks, count));
  if (count <= ticks) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (ticks - 1);
  const seen = new Set<number>();
  for (let i = 0; i < ticks; i++) seen.add(Math.round(i * step));
  return [...seen].sort((a, b) => a - b);
}
