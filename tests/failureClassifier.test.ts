import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../src/server/AppMakerLab/autorepair/FailureClassifier';
import { FailureClassification } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';

describe('FailureClassifier.classify', () => {
  it('classifies "cannot find module" as DEPENDENCY_ERROR', () => {
    expect(FailureClassifier.classify('Cannot find module "axios"')).toBe(FailureClassification.DEPENDENCY_ERROR);
  });

  it('classifies "module not found" as DEPENDENCY_ERROR', () => {
    expect(FailureClassifier.classify('Module not found: Error react')).toBe(FailureClassification.DEPENDENCY_ERROR);
  });

  it('classifies TS2304 as TYPESCRIPT_ERROR', () => {
    expect(FailureClassifier.classify('TS2304: Cannot find name "foo"')).toBe(FailureClassification.TYPESCRIPT_ERROR);
  });

  it('classifies "lint" error as LINT_ERROR', () => {
    expect(FailureClassifier.classify('ESLint: lint check failed')).toBe(FailureClassification.LINT_ERROR);
  });

  it('classifies "circular" as ARCHITECTURE_VIOLATION', () => {
    expect(FailureClassifier.classify('circular dependency detected')).toBe(FailureClassification.ARCHITECTURE_VIOLATION);
  });

  it('classifies missing env var as MISSING_ENVIRONMENT_VARIABLE', () => {
    expect(FailureClassifier.classify('missing env variable DATABASE_URL')).toBe(FailureClassification.MISSING_ENVIRONMENT_VARIABLE);
  });

  it('classifies unknown error as UNKNOWN', () => {
    expect(FailureClassifier.classify('something completely unrecognized')).toBe(FailureClassification.UNKNOWN);
  });
});
