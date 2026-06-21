import { describe, it, expect } from 'vitest';
import { isFullStackTask } from '../src/server/pro/ProOrchestrator';

describe('isFullStackTask', () => {
  it('returns false for a simple React-only prompt', () => {
    expect(isFullStackTask('Build a React todo app')).toBe(false);
    expect(isFullStackTask('a landing page with Tailwind')).toBe(false);
    expect(isFullStackTask('build a counter component')).toBe(false);
  });

  it('returns true for explicit "full-stack" keyword', () => {
    expect(isFullStackTask('Build a full-stack app')).toBe(true);
    expect(isFullStackTask('fullstack task manager with authentication')).toBe(true);
  });

  it('returns true for backend+frontend pattern', () => {
    expect(isFullStackTask('React frontend and Node.js backend')).toBe(true);
    expect(isFullStackTask('backend API with a React client')).toBe(true);
    expect(isFullStackTask('Vue UI connected to an Express server')).toBe(true);
  });

  it('returns true for frontend+backend pattern (reversed order)', () => {
    expect(isFullStackTask('Node.js server with React frontend')).toBe(true);
    expect(isFullStackTask('Django API paired with a Vue UI')).toBe(true);
  });

  it('returns true for named framework pairs (React + Express)', () => {
    expect(isFullStackTask('Build with React and Express')).toBe(true);
    expect(isFullStackTask('Next.js app with Fastapi backend')).toBe(true);
    expect(isFullStackTask('Svelte with Rails backend')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isFullStackTask('REACT FRONTEND with NODE BACKEND')).toBe(true);
    expect(isFullStackTask('Full-Stack CRM system')).toBe(true);
  });

  it('returns false for a single-framework prompt without backend context', () => {
    expect(isFullStackTask('Build a React dashboard with charts and routing')).toBe(false);
    expect(isFullStackTask('Vue 3 SPA with Vuex')).toBe(false);
  });
});
