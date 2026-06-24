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

  it('flags a new Promise(async …) executor (errors are swallowed) but not the sync form', () => {
    expect(scanAsyncPatterns('a.ts', 'return new Promise(async (resolve) => { resolve(await f()); });')[0])
      .toMatchObject({ kind: 'new-promise-async', line: 1 });
    expect(scanAsyncPatterns('a.ts', 'const p = new Promise<string>(async (resolve, reject) => {});')[0]?.kind)
      .toBe('new-promise-async');
    // Safe: a normal (synchronous) executor is not flagged.
    expect(scanAsyncPatterns('a.ts', 'const p = new Promise((resolve) => setTimeout(resolve, 10));')).toEqual([]);
  });

  it('flags useEffect(async …) (the effect returns a Promise; cleanup never runs)', () => {
    expect(scanAsyncPatterns('App.tsx', 'useEffect(async () => { await load(); }, []);')[0])
      .toMatchObject({ kind: 'async-useeffect', line: 1 });
    // Safe: the correct pattern — a sync effect that calls an inner async function.
    expect(scanAsyncPatterns('App.tsx', 'useEffect(() => { void load(); }, []);')).toEqual([]);
  });

  it('flags filter/find/some/every/sort with an async callback (always-wrong predicate) but not .map', () => {
    expect(scanAsyncPatterns('a.ts', 'const open = items.filter(async (x) => await isOpen(x));')[0])
      .toMatchObject({ kind: 'async-array-predicate', line: 1 });
    expect(scanAsyncPatterns('a.ts', 'const hit = list.find(async (x) => await match(x));')[0]?.kind)
      .toBe('async-array-predicate');
    expect(scanAsyncPatterns('a.ts', 'arr.sort(async (a, b) => await cmp(a, b));')[0]?.kind)
      .toBe('async-array-predicate');
    // .map(async …) is correct when awaited via Promise.all — not flagged here.
    expect(scanAsyncPatterns('a.ts', 'await Promise.all(items.map(async (x) => save(x)));').some((i) => i.kind === 'async-array-predicate')).toBe(false);
    // a synchronous predicate is fine.
    expect(scanAsyncPatterns('a.ts', 'items.filter((x) => x.open);')).toEqual([]);
  });

  it('ignores comments and non-code files', () => {
    expect(scanAsyncPatterns('a.ts', '// items.forEach(async (x) => await f(x))')).toEqual([]);
    expect(scanAsyncPatterns('README.md', 'items.forEach(async (x) => await f(x))')).toEqual([]);
    expect(scanAsyncPatterns('a.ts', '// new Promise(async (r) => r())')).toEqual([]);
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
