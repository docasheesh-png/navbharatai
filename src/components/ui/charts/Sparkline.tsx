// P-DESIGN.4 — Sparkline / line chart (dependency-free SVG). Thin renderer over chartGeometry.linePoints.

import { linePoints } from './chartGeometry';

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill the area under the line with a faint tint. */
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function Sparkline({ values, width = 240, height = 48, color = '#22d3ee', strokeWidth = 2, fill = false, className, ariaLabel = 'Trend line' }: SparklineProps) {
  const pts = linePoints(values, { width, height });
  if (!pts) return null;
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} preserveAspectRatio="none" role="img" aria-label={ariaLabel} style={{ width: '100%' }}>
      {fill && <polygon points={areaPts} fill={color} fillOpacity={0.12} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default Sparkline;
