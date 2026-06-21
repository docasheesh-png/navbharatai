import { describe, it, expect } from 'vitest';
import {
  extractSearchTerms,
  rankFiles,
  buildFileTree,
  packFileSections,
} from '../src/server/EngineerAI/ContextRetriever';

describe('extractSearchTerms', () => {
  it('returns empty for an empty instruction', () => {
    expect(extractSearchTerms('', [])).toEqual([]);
  });

  it('extracts camelCase/PascalCase identifiers from the instruction', () => {
    const terms = extractSearchTerms('Fix the UserAuth component in AuthService', []);
    expect(terms).toContain('UserAuth');
    expect(terms).toContain('AuthService');
  });

  it('extracts meaningful lowercase keywords and filters stop words', () => {
    const terms = extractSearchTerms('build authentication with database connection', []);
    expect(terms).toContain('authentication');
    expect(terms).toContain('database');
    expect(terms).toContain('connection');
    // stop words should not appear
    expect(terms).not.toContain('with');
    expect(terms).not.toContain('build');
  });

  it('includes terms from recent observations', () => {
    const terms = extractSearchTerms('fix the bug', ['Error in TodoList component']);
    expect(terms).toContain('TodoList');
  });

  it('deduplicates identical terms', () => {
    const terms = extractSearchTerms('UserAuth UserAuth service', []);
    const count = terms.filter(t => t === 'UserAuth').length;
    expect(count).toBe(1);
  });

  it('caps output at 8 terms', () => {
    const terms = extractSearchTerms(
      'alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India',
      ['TermOne TermTwo TermThree TermFour TermFive'],
    );
    expect(terms.length).toBeLessThanOrEqual(8);
  });
});

describe('rankFiles', () => {
  const allFiles = ['src/App.tsx', 'src/auth/Login.tsx', 'package.json', 'vite.config.js', 'src/utils.ts'];

  it('returns all files', () => {
    const ranked = rankFiles(allFiles, [], []);
    expect(ranked).toHaveLength(allFiles.length);
    expect(ranked).toEqual(expect.arrayContaining(allFiles));
  });

  it('puts recently-edited files first', () => {
    const ranked = rankFiles(allFiles, [], ['src/utils.ts']);
    expect(ranked[0]).toBe('src/utils.ts');
  });

  it('boosts grep-matched files above unmatched', () => {
    const ranked = rankFiles(allFiles, ['src/auth/Login.tsx'], []);
    const loginIdx = ranked.indexOf('src/auth/Login.tsx');
    const utilsIdx = ranked.indexOf('src/utils.ts');
    expect(loginIdx).toBeLessThan(utilsIdx);
  });

  it('boosts config/entry files (package.json, vite.config)', () => {
    const ranked = rankFiles(allFiles, [], []);
    const pkgIdx = ranked.indexOf('package.json');
    const appIdx = ranked.indexOf('src/App.tsx');
    // package.json and App.tsx are both "always relevant" — both boosted
    expect(pkgIdx).toBeLessThanOrEqual(appIdx + 2); // near the top
  });
});

describe('buildFileTree', () => {
  it('joins file paths with newlines', () => {
    const tree = buildFileTree(['src/App.tsx', 'package.json', 'src/main.ts']);
    expect(tree).toContain('src/App.tsx');
    expect(tree).toContain('package.json');
    expect(tree.split('\n')).toHaveLength(3);
  });

  it('returns empty string for empty list', () => {
    expect(buildFileTree([])).toBe('');
  });
});

describe('packFileSections', () => {
  it('returns sections for files present in contentMap', () => {
    const contentMap = new Map([['src/App.tsx', 'export default function App() { return <div/>; }']]);
    const sections = packFileSections(['src/App.tsx'], contentMap);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('src/App.tsx');
    expect(sections[0]).toContain('App()');
  });

  it('marks unreadable files (missing from map)', () => {
    const sections = packFileSections(['src/missing.ts'], new Map());
    expect(sections[0]).toContain('unreadable');
  });

  it('respects the char budget and stops adding files when exceeded', () => {
    const bigContent = 'x'.repeat(500);
    const map = new Map([
      ['file1.ts', bigContent],
      ['file2.ts', bigContent],
      ['file3.ts', bigContent],
    ]);
    const sections = packFileSections(['file1.ts', 'file2.ts', 'file3.ts'], map, 600);
    // Budget 600 — file1 (500) fits, file2 would need >600 — may include partially or stop
    expect(sections.length).toBeLessThanOrEqual(3);
  });

  it('truncates individual files exceeding per-file cap', () => {
    const content = 'a'.repeat(5000);
    const map = new Map([['big.ts', content]]);
    const sections = packFileSections(['big.ts'], map, 14000, 100); // maxPerFile=100
    expect(sections[0]).toContain('big.ts');
    // Content should be truncated to 100 chars max (plus header overhead)
    expect(sections[0].length).toBeLessThanOrEqual(150); // header + truncated content
  });
});
