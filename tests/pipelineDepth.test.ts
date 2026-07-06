import { describe, it, expect } from 'vitest';
import {
  resolvePipelineDepth,
  scaleBuildSeconds,
  MAX_SCALED_BUILD_SECONDS,
  DEEP_TIME_FACTOR,
} from '../src/server/AgentV3/PipelineDepth';

/** P-ARCH+.1 — complexity-adaptive pipeline depth (pure). */

describe('resolvePipelineDepth', () => {
  it('simple prompts (low magnitude) → fast', () => {
    expect(resolvePipelineDepth(1)).toBe('fast');
    expect(resolvePipelineDepth(4)).toBe('fast');
  });
  it('mid magnitude → standard', () => {
    expect(resolvePipelineDepth(5)).toBe('standard');
    expect(resolvePipelineDepth(11)).toBe('standard');
  });
  it('high magnitude → deep', () => {
    expect(resolvePipelineDepth(12)).toBe('deep');
    expect(resolvePipelineDepth(40)).toBe('deep');
  });
  it('power/Only-Opus mode always earns deep, regardless of magnitude', () => {
    expect(resolvePipelineDepth(1, true)).toBe('deep');
    expect(resolvePipelineDepth(40, true)).toBe('deep');
  });
  it('RC-2: a large existing project earns deep even on a tiny edit prompt (magnitude ≤ 4)', () => {
    // The admin case: "retry"/"fix X" on a ~1650-file import → short prompt, but it must get deep time.
    expect(resolvePipelineDepth(1, false, true)).toBe('deep');
    expect(resolvePipelineDepth(0, false, true)).toBe('deep');
    // A small edit on a small project is unchanged (not large → prompt-magnitude decides).
    expect(resolvePipelineDepth(1, false, false)).toBe('fast');
  });
  it('a non-finite magnitude falls back to standard (middle)', () => {
    expect(resolvePipelineDepth(NaN)).toBe('standard');
    expect(resolvePipelineDepth(Infinity)).toBe('standard');
  });
});

describe('scaleBuildSeconds', () => {
  it('only DEEP earns more time; fast/standard are unchanged (never reduced)', () => {
    expect(scaleBuildSeconds(1800, 'fast')).toBe(1800);
    expect(scaleBuildSeconds(1800, 'standard')).toBe(1800);
    expect(scaleBuildSeconds(1800, 'deep')).toBe(Math.round(1800 * DEEP_TIME_FACTOR)); // 2700
  });
  it('preserves 0 (watchdog disabled) exactly for every depth', () => {
    expect(scaleBuildSeconds(0, 'deep')).toBe(0);
    expect(scaleBuildSeconds(0, 'fast')).toBe(0);
  });
  it('bounds a deep build to the absolute ceiling', () => {
    expect(scaleBuildSeconds(3000, 'deep')).toBe(MAX_SCALED_BUILD_SECONDS); // 3000*1.5=4500 → capped 3600
    expect(scaleBuildSeconds(MAX_SCALED_BUILD_SECONDS, 'standard')).toBe(MAX_SCALED_BUILD_SECONDS);
  });
  it('treats negative/invalid base as disabled (returns as-is)', () => {
    expect(scaleBuildSeconds(-5, 'deep')).toBe(-5);
  });
});
