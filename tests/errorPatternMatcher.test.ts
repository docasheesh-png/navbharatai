import { describe, it, expect } from 'vitest';
import { matchErrorPatterns, hintForInstruction } from '../src/server/project/ErrorPatternMatcher';

describe('matchErrorPatterns', () => {
  it('returns empty array for unrecognized error text', () => {
    expect(matchErrorPatterns('everything is fine')).toEqual([]);
  });

  it('returns a hint for "Cannot find module" error', () => {
    const hints = matchErrorPatterns('Cannot find module "axios"');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toBeTruthy();
  });

  it('returns a hint for ERESOLVE peer dependency error', () => {
    const hints = matchErrorPatterns('npm ERR! ERESOLVE peer dep conflict');
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]).toContain('legacy-peer-deps');
  });

  it('returns a hint for unclosed JSX', () => {
    const hints = matchErrorPatterns('Expected corresponding JSX closing tag');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('returns a hint for TypeScript type mismatch', () => {
    const hints = matchErrorPatterns("Type 'string' is not assignable to type 'number'");
    expect(hints.length).toBeGreaterThan(0);
  });

  it('returns a hint for React Hooks rules violation', () => {
    const hints = matchErrorPatterns('React Hook cannot be called conditionally');
    expect(hints.length).toBeGreaterThan(0);
  });
});

describe('hintForInstruction', () => {
  it('returns empty array for generic instruction', () => {
    expect(hintForInstruction('build something')).toEqual([]);
  });

  it('returns a hint for "tailwind" keyword', () => {
    const hints = hintForInstruction('build an app with tailwindcss');
    expect(hints.length).toBeGreaterThan(0);
  });

  it('returns empty array for empty string', () => {
    expect(hintForInstruction('')).toEqual([]);
  });
});
