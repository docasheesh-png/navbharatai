// P-DESIGN.4 — Bar chart (dependency-free SVG). Thin renderer over chartGeometry.barLayout (pure).

import { barLayout } from './chartGeometry';

export interface BarChartProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  gapRatio?: number;
  className?: string;
  /** Accessible summary. */
  ariaLabel?: string;
}

export function BarChart({ values, width = 320, height = 120, color = '#6366f1', gapRatio = 0.3, className, ariaLabel = 'Bar chart' }: BarChartProps) {
  const bars = barLayout(values, { width, height, gapRatio });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ width: '100%' }}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} rx={2} fill={color} />
      ))}
    </svg>
  );
}

export default BarChart;
