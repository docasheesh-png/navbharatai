import { describe, it, expect } from 'vitest';
import { parseQualityThreshold, qualityThreshold, passesQualityGate, formatGateLine, DEFAULT_QUALITY_THRESHOLD } from '../src/server/QualityEvaluationEngine/qualityGate';

/** P-TQA.6 — quality gate: configurable threshold parsing + pass/format logic. */

describe('parseQualityThreshold', () => {
  it('accepts a fraction', () => {
    expect(parseQualityThreshold('0.7')).toBeCloseTo(0.7);
  });
  it('accepts a percentage (>1 → /100)', () => {
    expect(parseQualityThreshold('70')).toBeCloseTo(0.7);
    expect(parseQualityThreshold('90')).toBeCloseTo(0.9);
  });
  it('falls back to the default on junk / empty / out-of-range', () => {
    expect(parseQualityThreshold(undefined)).toBe(DEFAULT_QUALITY_THRESHOLD);
    expect(parseQualityThreshold('')).toBe(DEFAULT_QUALITY_THRESHOLD);
    expect(parseQualityThreshold('abc')).toBe(DEFAULT_QUALITY_THRESHOLD);
    expect(parseQualityThreshold('-5')).toBe(DEFAULT_QUALITY_THRESHOLD);
    expect(parseQualityThreshold('500')).toBe(DEFAULT_QUALITY_THRESHOLD); // 5.0 > 1 → out of range
  });
});

describe('qualityThreshold (env)', () => {
  it('reads QUALITY_GATE_THRESHOLD from a provided env', () => {
    expect(qualityThreshold({ QUALITY_GATE_THRESHOLD: '65' } as any)).toBeCloseTo(0.65);
    expect(qualityThreshold({} as any)).toBe(DEFAULT_QUALITY_THRESHOLD);
  });
});

describe('passesQualityGate / formatGateLine', () => {
  it('passes at or above threshold, fails below', () => {
    expect(passesQualityGate(0.8, 0.7)).toBe(true);
    expect(passesQualityGate(0.7, 0.7)).toBe(true);
    expect(passesQualityGate(0.69, 0.7)).toBe(false);
    expect(passesQualityGate(NaN, 0.7)).toBe(false);
  });
  it('formats an honest gate line', () => {
    expect(formatGateLine(0.74, 0.7)).toBe('Quality Gate: 74/100 ✅ (threshold 70)');
    expect(formatGateLine(0.52, 0.7)).toBe('Quality Gate: 52/100 ❌ (threshold 70)');
  });
});
