import { describe, it, expect } from 'vitest';
import { RootCauseAnalyzer } from '../src/server/AppMakerLab/repair/RootCauseAnalyzer';

describe('RootCauseAnalyzer', () => {
  const analyzer = new RootCauseAnalyzer();

  it('classifies "Cannot find module" as IMPORT', () => {
    const result = analyzer.analyze(new Error('Cannot find module "axios"'), []);
    expect(result.category).toBe('IMPORT');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('classifies tsconfig errors as CONFIG', () => {
    const result = analyzer.analyze(new Error('tsconfig.json not found'), []);
    expect(result.category).toBe('CONFIG');
  });

  it('classifies type errors as TYPE', () => {
    const result = analyzer.analyze(new Error("Type 'string' is not assignable"), []);
    expect(result.category).toBe('TYPE');
  });

  it('classifies build errors as BUILD', () => {
    const result = analyzer.analyze(new Error('build failed with exit code 1'), []);
    expect(result.category).toBe('BUILD');
  });

  it('classifies deployment errors as DEPLOYMENT', () => {
    const result = analyzer.analyze(new Error('deployment to Cloud Run failed'), []);
    expect(result.category).toBe('DEPLOYMENT');
  });

  it('returns RUNTIME as fallback for unknown errors', () => {
    const result = analyzer.analyze(new Error('something went wrong'), []);
    expect(result.category).toBe('RUNTIME');
    expect(result.confidence).toBe(0.5);
  });
});
