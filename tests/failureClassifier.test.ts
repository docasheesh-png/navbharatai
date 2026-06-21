import { describe, it, expect } from 'vitest';
import { FailureClassifier } from '../src/server/AppMakerLab/autorepair/FailureClassifier';
import { FailureClassification } from '../src/server/AppMakerLab/autorepair/AutoRepairTypes';

describe('FailureClassifier.classify', () => {
  it('classifies "cannot find module" as DEPENDENCY_ERROR', () => {
    expect(FailureClassifier.classify('Error: Cannot find module \'react\'')).toBe(FailureClassification.DEPENDENCY_ERROR);
  });

  it('classifies "module not found" as DEPENDENCY_ERROR', () => {
    expect(FailureClassifier.classify('Module not found: Error: Can\'t resolve \'axios\'')).toBe(FailureClassification.DEPENDENCY_ERROR);
  });

  it('classifies TS2304 as TYPESCRIPT_ERROR', () => {
    expect(FailureClassifier.classify('src/App.tsx(5,10): error TS2304: Cannot find name \'Foo\'')).toBe(FailureClassification.TYPESCRIPT_ERROR);
  });

  it('classifies "cannot find name" as TYPESCRIPT_ERROR', () => {
    expect(FailureClassifier.classify('Cannot find name \'useState\'')).toBe(FailureClassification.TYPESCRIPT_ERROR);
  });

  it('classifies npm missing script as MISSING_SCRIPT', () => {
    expect(FailureClassifier.classify('npm ERR! Missing script: "start"')).toBe(FailureClassification.MISSING_SCRIPT);
  });

  it('classifies lint errors as LINT_ERROR', () => {
    expect(FailureClassifier.classify('ESLint found lint errors in src/')).toBe(FailureClassification.LINT_ERROR);
  });

  it('classifies build failures as BUILD_ERROR', () => {
    expect(FailureClassifier.classify('Build failed with 3 errors')).toBe(FailureClassification.BUILD_ERROR);
  });

  it('classifies security issues as SECURITY_VIOLATION', () => {
    expect(FailureClassifier.classify('Security: exposed private key in source')).toBe(FailureClassification.SECURITY_VIOLATION);
  });

  it('classifies circular imports as ARCHITECTURE_VIOLATION', () => {
    expect(FailureClassifier.classify('Circular dependency detected in module graph')).toBe(FailureClassification.ARCHITECTURE_VIOLATION);
  });

  it('classifies env issues as MISSING_ENVIRONMENT_VARIABLE', () => {
    expect(FailureClassifier.classify('Missing env variable: DATABASE_URL')).toBe(FailureClassification.MISSING_ENVIRONMENT_VARIABLE);
  });

  it('classifies preview startup failures as PREVIEW_STARTUP_FAILURE', () => {
    expect(FailureClassifier.classify('Preview startup failed on port 5173')).toBe(FailureClassification.PREVIEW_STARTUP_FAILURE);
  });

  it('classifies unrecognised errors as UNKNOWN', () => {
    expect(FailureClassifier.classify('Something totally unexpected happened')).toBe(FailureClassification.UNKNOWN);
  });

  it('is case-insensitive (uppercase input)', () => {
    expect(FailureClassifier.classify('CANNOT FIND MODULE foo')).toBe(FailureClassification.DEPENDENCY_ERROR);
  });
});
