import { describe, it, expect } from 'vitest';
import { classifyBuildOutcome, buildOutcomeLabel, isBuildFailure, type BuildOutcome } from './BuildOutcome';

describe('classifyBuildOutcome', () => {
  it('no files → BUILD_FAILED', () => {
    expect(classifyBuildOutcome({ filesWritten: 0 })).toBe('BUILD_FAILED');
    expect(classifyBuildOutcome({ filesWritten: 0, typecheckOk: true })).toBe('BUILD_FAILED');
  });

  it('type errors → TYPECHECK_FAILED (takes precedence over everything but no-files)', () => {
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: false })).toBe('TYPECHECK_FAILED');
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: false, previewOk: true })).toBe('TYPECHECK_FAILED');
  });

  it('tsc clean but production build failed → BUILD_FAILED', () => {
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: true, prodBuildOk: false })).toBe('BUILD_FAILED');
  });

  it('compiles, preview up, but runtime errored → RUNTIME_FAILED', () => {
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: true, previewOk: true, runtimeOk: false })).toBe('RUNTIME_FAILED');
  });

  it('compiles but preview never came up → PREVIEW_FAILED (NOT a build failure)', () => {
    const o = classifyBuildOutcome({ filesWritten: 5, typecheckOk: true, previewOk: false });
    expect(o).toBe('PREVIEW_FAILED');
    expect(isBuildFailure(o)).toBe(false); // app is built — ship with warning, do not fall back
  });

  it('compiles + live verified → BUILD_SUCCESS', () => {
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: true, previewOk: true })).toBe('BUILD_SUCCESS');
    expect(classifyBuildOutcome({ filesWritten: 5, prodBuildOk: true, runtimeOk: true })).toBe('BUILD_SUCCESS');
  });

  it('compiles but live not verified (preview/runtime not run) → BUILD_PARTIAL', () => {
    expect(classifyBuildOutcome({ filesWritten: 5, typecheckOk: true })).toBe('BUILD_PARTIAL');
  });

  it('files written but nothing verified at all → BUILD_PARTIAL', () => {
    expect(classifyBuildOutcome({ filesWritten: 5 })).toBe('BUILD_PARTIAL');
  });

  it('isBuildFailure marks only the real build failures', () => {
    const failures: BuildOutcome[] = ['TYPECHECK_FAILED', 'BUILD_FAILED'];
    const notFailures: BuildOutcome[] = ['BUILD_SUCCESS', 'BUILD_PARTIAL', 'PREVIEW_FAILED', 'RUNTIME_FAILED'];
    for (const o of failures) expect(isBuildFailure(o)).toBe(true);
    for (const o of notFailures) expect(isBuildFailure(o)).toBe(false);
  });

  it('every outcome has a human label', () => {
    const all: BuildOutcome[] = ['BUILD_SUCCESS', 'BUILD_PARTIAL', 'TYPECHECK_FAILED', 'BUILD_FAILED', 'PREVIEW_FAILED', 'RUNTIME_FAILED'];
    for (const o of all) expect(buildOutcomeLabel(o).length).toBeGreaterThan(0);
  });
});
