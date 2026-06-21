import { describe, it, expect } from 'vitest';
import { RequestAnalyzer } from '../src/server/AI/RequestAnalyzer';

describe('RequestAnalyzer', () => {
  it('detects fullstack for CRM request', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('build a CRM management system');
    expect(plan.projectType).toBe('full-stack-app');
    expect(plan.backendRequired).toBe(true);
    expect(plan.databaseRequired).toBe(true);
  });

  it('detects frontend-only for calculator', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('build a calculator');
    expect(plan.projectType).toBe('frontend-app');
    expect(plan.backendRequired).toBe(false);
  });

  it('always includes frontendRequired as true', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('anything');
    expect(plan.frontendRequired).toBe(true);
  });

  it('includes src/server directory for fullstack', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('inventory management erp');
    expect(plan.directories).toContain('src/server');
  });

  it('does not include src/server for frontend-only', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('make a clock widget');
    expect(plan.directories).not.toContain('src/server');
  });

  it('always includes App.tsx in files', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('anything');
    expect(plan.files.some(f => f.path === 'src/App.tsx')).toBe(true);
  });

  it('features always includes Core UI', () => {
    const analyzer = new RequestAnalyzer();
    const plan = analyzer.analyze('anything');
    expect(plan.features).toContain('Core UI');
  });
});
