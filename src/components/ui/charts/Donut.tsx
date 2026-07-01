// P-DESIGN.4 — Donut chart (dependency-free SVG). Renders value slices as a stroke-dasharray ring
// with an optional centre label. Layout math comes from chartGeometry.donutSegments (pure, tested).

import React from 'react';
import { donutSegments } from './chartGeometry';

export interface DonutSlice {
  value: number;
  color: string;
  label?: string;
}

export interface DonutProps {
  slices: DonutSlice[];
  /** Diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  thickness?: number;
  /** Centre content (e.g. a percentage). */
  center?: React.ReactNode;
  className?: string;
}

const CIRC = 100; // normalised circumference (viewBox is scaled to match)

export function Donut({ slices, size = 96, thickness = 12, center, className }: DonutProps) {
  const radius = CIRC / (2 * Math.PI);
  const segs = donutSegments(slices.map((s) => s.value), CIRC);
  const view = radius * 2 + thickness;
  const c = view / 2;
  return (
    <div className={className} style={{ position: 'relative', width: size, height: size }}>
      <svg viewBox={`0 0 ${view} ${view}`} width={size} height={size} role="img" aria-label="Donut chart">
        <circle cx={c} cy={c} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} />
        {segs.map((seg, i) => (
          seg.length > 0 ? (
            <circle
              key={i}
              cx={c}
              cy={c}
              r={radius}
              fill="none"
              stroke={slices[i]?.color || '#6366f1'}
              strokeWidth={thickness}
              strokeDasharray={`${seg.length} ${CIRC - seg.length}`}
              strokeDashoffset={seg.offset}
              transform={`rotate(-90 ${c} ${c})`}
              strokeLinecap="butt"
            />
          ) : null
        ))}
      </svg>
      {center != null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {center}
        </div>
      )}
    </div>
  );
}

export default Donut;
