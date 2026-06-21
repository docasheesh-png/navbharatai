import { describe, it, expect } from 'vitest';
import { matchErrorPatterns, hintForInstruction } from '../src/server/project/ErrorPatternMatcher';

describe('matchErrorPatterns', () => {
  it('returns empty array for empty string', () => {
    expect(matchErrorPatterns('')).toEqual([]);
  });

  it('matches Cannot find module errors', () => {
    const hints = matchErrorPatterns("Cannot find module 'axios'");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('package.json');
  });

  it('matches ERESOLVE peer dependency errors', () => {
    const hints = matchErrorPatterns('npm ERESOLVE could not resolve peer dep');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('--legacy-peer-deps');
  });

  it('matches named export errors', () => {
    const hints = matchErrorPatterns("'Button' is not exported from './components'");
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('named export');
  });

  it('matches unclosed JSX tag errors', () => {
    const hints = matchErrorPatterns('Expected corresponding JSX closing tag for <div>');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('closing tag');
  });

  it('matches React is not defined', () => {
    const hints = matchErrorPatterns('ReferenceError: React is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('React');
  });

  it('matches tailwind not found errors', () => {
    const hints = matchErrorPatterns('Error: tailwindcss not found in node_modules');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Tailwind');
  });

  it('matches SyntaxError unexpected token', () => {
    const hints = matchErrorPatterns('SyntaxError: Unexpected token }');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Syntax error');
  });

  it('matches React hooks rules violations', () => {
    const hints = matchErrorPatterns('React Hook "useState" cannot be called conditionally');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('top level');
  });

  it('deduplicates identical hints from multiple matches', () => {
    // Two 'Cannot find module' errors should only produce one hint entry
    const errorText = "Cannot find module 'react'\nCannot find module 'axios'";
    const hints = matchErrorPatterns(errorText);
    const unique = new Set(hints);
    expect(hints.length).toBe(unique.size);
  });

  it('returns empty for unrecognized errors', () => {
    const hints = matchErrorPatterns('Some completely unknown error XYZ123');
    expect(hints).toEqual([]);
  });

  it("matches '@/' path alias not configured errors", () => {
    const hints = matchErrorPatterns("Cannot find module '@/components/Button'");
    expect(hints.length).toBeGreaterThan(0);
    // The @/-specific hint should appear somewhere in the results
    expect(hints.some(h => h.includes('@/'))).toBe(true);
  });

  it('matches Node.js global (process) not defined in browser', () => {
    const hints = matchErrorPatterns('ReferenceError: process is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('process');
  });

  it('matches localStorage not defined (SSR)', () => {
    const hints = matchErrorPatterns('ReferenceError: localStorage is not defined');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('localStorage');
  });

  it('matches PostCSS/Tailwind Unknown at rule error', () => {
    const hints = matchErrorPatterns('Unknown at rule @tailwind');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('postcss.config');
  });
});

describe('hintForInstruction', () => {
  it('returns empty for empty instruction', () => {
    expect(hintForInstruction('')).toEqual([]);
  });

  it('returns tailwind hint for tailwind instructions', () => {
    const hints = hintForInstruction('Build a dashboard with Tailwind CSS');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Tailwind');
  });

  it('returns supabase hint for supabase instructions', () => {
    const hints = hintForInstruction('Create an app with Supabase authentication');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Supabase');
  });

  it('returns react-router hint for routing instructions', () => {
    const hints = hintForInstruction('Build a multi-page app with routing');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Router');
  });

  it('returns zustand hint for state management instructions', () => {
    const hints = hintForInstruction('Add zustand for state management');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('Zustand');
  });

  it('returns no hints for generic instructions', () => {
    const hints = hintForInstruction('Build a simple counter app');
    expect(hints).toEqual([]);
  });

  it('returns multiple hints for multi-technology instructions', () => {
    const hints = hintForInstruction('Build with Tailwind CSS and Supabase auth');
    expect(hints.length).toBeGreaterThanOrEqual(2);
  });

  it('deduplicates identical hints', () => {
    const hints = hintForInstruction('tailwind tailwind css tailwindcss');
    const unique = new Set(hints);
    expect(hints.length).toBe(unique.size);
  });
});
