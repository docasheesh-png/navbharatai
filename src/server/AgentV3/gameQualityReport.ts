// Game quality, scored only from evidence. An unmeasured dimension is never a pass.
// A critical defect outranks the number. PURE.

export const QUALITY_DIMENSIONS = [
  'functional-gameplay', 'controls', 'visual', 'performance', 'physics',
  'animation', 'audio', 'mobile', 'progression', 'requirement-coverage',
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

export type DimensionMark =
  | { status: 'measured'; score: number }
  | { status: 'not-verified' };

export type QualityBand = 'excellent' | 'good' | 'conditional' | 'incomplete';

export interface QualityReport {
  dimensions: Record<QualityDimension, DimensionMark>;
  /** Mean of measured scores, 0–100. Null when nothing was measured. */
  overall: number | null;
  measured: number;
  unverified: QualityDimension[];
  criticalDefects: readonly string[];
  band: QualityBand;
  /** True only when every dimension was measured, none is a critical defect, and the band is at least conditional. */
  canRelease: boolean;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function gameQualityReport(
  marks: Partial<Record<QualityDimension, DimensionMark>>,
  criticalDefects: readonly string[] = [],
): QualityReport {
  const dimensions = {} as Record<QualityDimension, DimensionMark>;
  const unverified: QualityDimension[] = [];
  const scores: number[] = [];
  for (const id of QUALITY_DIMENSIONS) {
    const mark = marks[id] ?? { status: 'not-verified' as const };
    if (mark.status === 'measured') {
      const score = clampScore(mark.score);
      dimensions[id] = { status: 'measured', score };
      scores.push(score);
    } else {
      dimensions[id] = { status: 'not-verified' };
      unverified.push(id);
    }
  }
  const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const defects = criticalDefects.filter((d) => d.trim().length > 0);
  let band: QualityBand = 'incomplete';
  if (defects.length === 0 && unverified.length === 0 && overall !== null) {
    if (overall >= 90) band = 'excellent';
    else if (overall >= 80) band = 'good';
    else if (overall >= 75) band = 'conditional';
  }
  return {
    dimensions,
    overall,
    measured: scores.length,
    unverified,
    criticalDefects: defects,
    band,
    canRelease: band !== 'incomplete',
  };
}
