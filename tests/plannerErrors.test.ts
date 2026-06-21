import { describe, it, expect } from 'vitest';
import {
  BlueprintValidationError,
  CyclicDependencyError,
  MissingDependencyError,
  DuplicateModuleError,
  SelfDependencyError,
} from '../src/server/AppMakerLab/generator/PlannerErrors';

describe('PlannerErrors', () => {
  it('BlueprintValidationError has correct name', () => {
    const err = new BlueprintValidationError('bad blueprint');
    expect(err.name).toBe('BlueprintValidationError');
    expect(err.message).toBe('bad blueprint');
  });

  it('CyclicDependencyError is an instance of Error', () => {
    const err = new CyclicDependencyError('cycle detected');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CyclicDependencyError');
  });

  it('MissingDependencyError has correct name', () => {
    const err = new MissingDependencyError('dep X missing');
    expect(err.name).toBe('MissingDependencyError');
  });

  it('DuplicateModuleError has correct name', () => {
    const err = new DuplicateModuleError('module A');
    expect(err.name).toBe('DuplicateModuleError');
  });

  it('SelfDependencyError has correct name', () => {
    const err = new SelfDependencyError('module depends on itself');
    expect(err.name).toBe('SelfDependencyError');
  });
});
