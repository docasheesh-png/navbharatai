import { describe, it, expect } from 'vitest';
import { RequestAnalyzer } from '../src/server/AI/RequestAnalyzer';

const analyzer = new RequestAnalyzer();

describe('RequestAnalyzer.analyze', () => {
  it('classifies a CRM/management request as full-stack', () => {
    const plan = analyzer.analyze('Build a CRM with customer management');
    expect(plan.projectType).toBe('full-stack-app');
    expect(plan.backendRequired).toBe(true);
    expect(plan.databaseRequired).toBe(true);
    expect(plan.frontendRequired).toBe(true);
  });

  it('classifies a calculator as frontend-only', () => {
    const plan = analyzer.analyze('Build a scientific calculator');
    expect(plan.projectType).toBe('frontend-app');
    expect(plan.backendRequired).toBe(false);
    expect(plan.databaseRequired).toBe(false);
    expect(plan.frontendRequired).toBe(true);
  });

  it('always includes src/App.tsx in the file list', () => {
    const plan = analyzer.analyze('any request');
    expect(plan.files.some(f => f.path === 'src/App.tsx')).toBe(true);
  });

  it('adds server.ts for backend-required projects', () => {
    const plan = analyzer.analyze('Build an inventory management system');
    expect(plan.files.some(f => f.path === 'src/server/server.ts')).toBe(true);
    expect(plan.directories).toContain('src/server');
  });

  it('does not add server directory for frontend-only projects', () => {
    const plan = analyzer.analyze('Build a clock widget');
    expect(plan.directories).not.toContain('src/server');
  });

  it('includes data-persistence and api-routes features for full-stack', () => {
    const plan = analyzer.analyze('Build an ERP system');
    expect(plan.features).toContain('data-persistence');
    expect(plan.features).toContain('api-routes');
  });
});
