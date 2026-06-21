import { describe, it, expect } from 'vitest';
import { isComplexTask, thinkingBudgetFor } from '../src/server/pro/ProComplexity';

describe('isComplexTask', () => {
  it('returns false for a simple, generic prompt', () => {
    expect(isComplexTask('Build a todo app')).toBe(false);
    expect(isComplexTask('a simple landing page')).toBe(false);
    expect(isComplexTask('counter component in React')).toBe(false);
  });

  it('returns true for a full-stack prompt', () => {
    expect(isComplexTask('Build a fullstack app with React frontend and Node.js backend')).toBe(true);
  });

  it('returns true for prompts with authentication', () => {
    expect(isComplexTask('Build a SaaS dashboard with OAuth authentication and RBAC')).toBe(true);
  });

  it('returns true for real-time + payment signals', () => {
    expect(isComplexTask('Build a marketplace with Stripe payment and real-time websocket chat')).toBe(true);
  });

  it('returns true for "like Uber/Airbnb" style prompts', () => {
    expect(isComplexTask('Build an app like Uber for food delivery')).toBe(true);
    expect(isComplexTask('create something like Airbnb for pet sitters')).toBe(true);
  });

  it('returns true for multi-tenant enterprise prompts', () => {
    expect(isComplexTask('production-ready multi-tenant SaaS CRM')).toBe(true);
  });

  it('returns true for microservices/architecture prompts', () => {
    expect(isComplexTask('design a microservice architecture with CQRS and event sourcing')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isComplexTask('FULL-STACK APP WITH JWT AUTH')).toBe(true);
    expect(isComplexTask('fullstack dashboard')).toBe(true);
  });
});

describe('thinkingBudgetFor', () => {
  it('returns a higher budget for complex tasks', () => {
    const complexBudget = thinkingBudgetFor('Build a full-stack SaaS with OAuth and Stripe');
    const simpleBudget = thinkingBudgetFor('a simple counter');
    expect(complexBudget).toBeGreaterThan(simpleBudget);
  });

  it('returns 8000 for a simple prompt', () => {
    expect(thinkingBudgetFor('Build a todo app')).toBe(8_000);
  });

  it('returns 16000 for a complex prompt', () => {
    expect(thinkingBudgetFor('Build a production-ready full-stack SaaS CRM with OAuth')).toBe(16_000);
  });
});
