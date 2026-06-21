import { describe, it, expect } from 'vitest';
import { RootCauseAnalyzer } from '../src/server/AppMakerLab/repair/RootCauseAnalyzer';

describe('RootCauseAnalyzer.analyze', () => {
  const analyzer = new RootCauseAnalyzer();

  it('classifies "cannot find module" as IMPORT', () => {
    const rc = analyzer.analyze(new Error('Cannot find module axios'), []);
    expect(rc.category).toBe('IMPORT');
    expect(rc.confidence).toBeGreaterThan(0.9);
  });

  it('classifies "tsconfig" errors as CONFIG', () => {
    const rc = analyzer.analyze(new Error('tsconfig.json: invalid option'), []);
    expect(rc.category).toBe('CONFIG');
  });

  it('classifies type-related errors as TYPE', () => {
    const rc = analyzer.analyze(new Error('Type string is not assignable to number'), []);
    expect(rc.category).toBe('TYPE');
  });

  it('classifies build errors as BUILD', () => {
    const rc = analyzer.analyze(new Error('Build step failed'), []);
    expect(rc.category).toBe('BUILD');
  });

  it('classifies deployment errors as DEPLOYMENT', () => {
    const rc = analyzer.analyze(new Error('Deployment failed on cloud run'), []);
    expect(rc.category).toBe('DEPLOYMENT');
  });

  it('classifies architecture errors as ARCHITECTURE', () => {
    const rc = analyzer.analyze(new Error('circular architecture violation'), []);
    expect(rc.category).toBe('ARCHITECTURE');
  });

  it('falls back to RUNTIME for unrecognised errors', () => {
    const rc = analyzer.analyze(new Error('Something totally unexpected'), []);
    expect(rc.category).toBe('RUNTIME');
    expect(rc.confidence).toBe(0.5);
  });

  it('includes the error message in evidence', () => {
    const rc = analyzer.analyze(new Error('Cannot find module foo'), []);
    expect(rc.evidence[0]).toContain('cannot find module');
  });
});
