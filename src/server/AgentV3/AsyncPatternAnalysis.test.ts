import { describe, it, expect } from 'vitest';
import { scanAsyncPatterns, asyncPatternSummary } from './AsyncPatternAnalysis';

describe('scanAsyncPatterns', () => {
  it('flags forEach with an async arrow callback', () => {
    const issues = scanAsyncPatterns('src/sync.ts', 'items.forEach(async (it) => { await save(it); });');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'src/sync.ts', line: 1, kind: 'async-foreach' });
  });

  it('flags forEach with an async function expression and reports the line', () => {
    const src = 'const a = 1;\nconst b = 2;\nlist.forEach(async function (x) { await f(x); });';
    const issues = scanAsyncPatterns('a.ts', src);
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(3);
  });

  it('does NOT flag a synchronous forEach', () => {
    expect(scanAsyncPatterns('a.ts', 'items.forEach((x) => console.log(x));')).toEqual([]);
    expect(scanAsyncPatterns('a.ts', 'items.forEach(handler);')).toEqual([]);
  });

  it('does NOT flag for...of with await or Promise.all(map) (the correct forms)', () => {
    expect(scanAsyncPatterns('a.ts', 'for (const x of items) { await save(x); }')).toEqual([]);
    expect(scanAsyncPatterns('a.ts', 'await Promise.all(items.map(async (x) => save(x)));')).toEqual([]);
  });

  it('ignores comments and non-code files', () => {
    expect(scanAsyncPatterns('a.ts', '// items.forEach(async (x) => await f(x))')).toEqual([]);
    expect(scanAsyncPatterns('README.md', 'items.forEach(async (x) => await f(x))')).toEqual([]);
  });
});

describe('asyncPatternSummary', () => {
  it('renders the clean line and the warning with a fix hint', () => {
    expect(asyncPatternSummary([])).toContain('✓');
    const out = asyncPatternSummary(scanAsyncPatterns('src/sync.ts', 'a.forEach(async (x) => { await f(x); });'));
    expect(out).toContain('src/sync.ts:1');
    expect(out).toContain('Promise.all');
  });
});
