import { describe, it, expect } from 'vitest';
import { isComplexTask, thinkingBudgetFor } from '../src/server/pro/ProComplexity';

describe('isComplexTask', () => {
  it('returns false for simple prompt', () => {
    expect(isComplexTask('build a simple todo app')).toBe(false);
  });

  it('returns true for fullstack prompt', () => {
    expect(isComplexTask('build a fullstack web app with auth')).toBe(true);
  });

  it('returns true for microservice with architecture prompt (score 6)', () => {
    expect(isComplexTask('design a microservice architect pattern system')).toBe(true);
  });

  it('returns true for "like uber" prompt', () => {
    expect(isComplexTask('build an app like uber with tracking')).toBe(true);
  });

  it('returns true for multi-tenant SaaS', () => {
    expect(isComplexTask('build a multi-tenant SaaS dashboard')).toBe(true);
  });

  it('returns false for basic calculator', () => {
    expect(isComplexTask('make a calculator')).toBe(false);
  });

  it('returns true for enterprise CRM with payment', () => {
    expect(isComplexTask('enterprise CRM with payment integration and auth')).toBe(true);
  });
});

describe('thinkingBudgetFor', () => {
  it('returns 16000 for complex prompts', () => {
    expect(thinkingBudgetFor('build a fullstack multi-tenant SaaS')).toBe(16_000);
  });

  it('returns 8000 for simple prompts', () => {
    expect(thinkingBudgetFor('make a button')).toBe(8_000);
  });
});
