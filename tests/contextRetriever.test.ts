import { describe, it, expect } from 'vitest';
import { extractSearchTerms, rankFiles, buildFileTree, packFileSections } from '../src/server/EngineerAI/ContextRetriever';

describe('extractSearchTerms', () => {
  it('returns empty array for empty instruction and observations', () => {
    expect(extractSearchTerms('', [])).toEqual([]);
  });

  it('extracts capitalized identifiers like component names', () => {
    const terms = extractSearchTerms('fix the UserProfile component', []);
    expect(terms).toContain('UserProfile');
  });

  it('filters stop words', () => {
    const terms = extractSearchTerms('please make the button work', []);
    // "please", "make", "the" are stop words; "button" is 6 chars
    expect(terms).toContain('button');
    expect(terms).not.toContain('please');
    expect(terms).not.toContain('make');
  });

  it('returns at most 8 terms', () => {
    const instruction = 'AuthService LoginForm RegisterForm DashboardPage ProfilePage SettingsPage NotificationsPage PaymentPage';
    const terms = extractSearchTerms(instruction, []);
    expect(terms.length).toBeLessThanOrEqual(8);
  });
});

describe('rankFiles', () => {
  const all = ['App.tsx', 'main.tsx', 'utils.ts', 'auth.ts'];

  it('places recently edited files first', () => {
    const ranked = rankFiles(all, [], ['auth.ts']);
    expect(ranked[0]).toBe('auth.ts');
  });

  it('places grep-matched files high', () => {
    const ranked = rankFiles(all, ['utils.ts'], []);
    expect(ranked.indexOf('utils.ts')).toBeLessThan(ranked.indexOf('auth.ts'));
  });

  it('boosts entry/config files like App.tsx', () => {
    const ranked = rankFiles(all, [], []);
    // App.tsx and main.tsx should get boost
    const appIdx = ranked.indexOf('App.tsx');
    const utilsIdx = ranked.indexOf('utils.ts');
    expect(appIdx).toBeLessThan(utilsIdx);
  });
});

describe('buildFileTree', () => {
  it('joins files with newlines', () => {
    const tree = buildFileTree(['a.ts', 'b.tsx', 'c.js']);
    expect(tree).toBe('a.ts\nb.tsx\nc.js');
  });

  it('returns empty string for empty array', () => {
    expect(buildFileTree([])).toBe('');
  });
});

describe('packFileSections', () => {
  it('returns sections for each file in the content map', () => {
    const files = ['a.ts', 'b.ts'];
    const map = new Map([['a.ts', 'export const x = 1;'], ['b.ts', 'export const y = 2;']]);
    const sections = packFileSections(files, map);
    expect(sections.length).toBe(2);
  });

  it('marks unreadable files', () => {
    const files = ['missing.ts'];
    const map = new Map<string, string>();
    const sections = packFileSections(files, map);
    expect(sections[0]).toContain('unreadable');
  });

  it('respects budget cap', () => {
    const files = ['big.ts'];
    const map = new Map([['big.ts', 'x'.repeat(10_000)]]);
    const sections = packFileSections(files, map, 500);
    expect(sections[0].length).toBeLessThanOrEqual(600); // header + capped content
  });
});
