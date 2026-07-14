import { describe, it, expect } from 'vitest';
import { analyzeQueryOptimizer, queryOptimizerSummary } from './queryOptimizerAnalysis';

const S = (content: string, path = 'src/db.ts') => [{ path, content }];

describe('analyzeQueryOptimizer — select-star', () => {
  it('flags SELECT * in a raw SQL string', async () => {
    const issues = await analyzeQueryOptimizer(S('const q = "SELECT * FROM users WHERE id = $1";'));
    expect(issues.some((i) => i.kind === 'select-star')).toBe(true);
  });
  it('flags SELECT * in a template literal', async () => {
    const issues = await analyzeQueryOptimizer(S('const q = `select *\nfrom orders`;'));
    expect(issues.some((i) => i.kind === 'select-star')).toBe(true);
  });
  it('does NOT flag an explicit column list', async () => {
    const issues = await analyzeQueryOptimizer(S('const q = "SELECT id, name FROM users";'));
    expect(issues.filter((i) => i.kind === 'select-star')).toEqual([]);
  });
});

describe('analyzeQueryOptimizer — unbounded read', () => {
  it('flags findMany() with no bounding options', async () => {
    const issues = await analyzeQueryOptimizer(S('async function f(){ return await db.user.findMany(); }'));
    expect(issues.some((i) => i.kind === 'unbounded-read')).toBe(true);
  });
  it('does NOT flag findMany({ where }) / findMany({ take })', async () => {
    const a = await analyzeQueryOptimizer(S('async function f(){ return await db.user.findMany({ where: { active: true } }); }'));
    const b = await analyzeQueryOptimizer(S('async function f(){ return await db.user.findMany({ take: 20 }); }'));
    expect(a.filter((i) => i.kind === 'unbounded-read')).toEqual([]);
    expect(b.filter((i) => i.kind === 'unbounded-read')).toEqual([]);
  });
});

describe('analyzeQueryOptimizer — whole-table mutation', () => {
  it('flags deleteMany() and updateMany() with no where (or empty where)', async () => {
    const a = await analyzeQueryOptimizer(S('async function f(){ await db.user.deleteMany(); }'));
    const b = await analyzeQueryOptimizer(S('async function f(){ await db.user.updateMany({ where: {}, data: { x: 1 } }); }'));
    expect(a.some((i) => i.kind === 'missing-where-mutation')).toBe(true);
    expect(b.some((i) => i.kind === 'missing-where-mutation')).toBe(true);
  });
  it('does NOT flag a scoped deleteMany({ where: {...} })', async () => {
    const issues = await analyzeQueryOptimizer(S('async function f(){ await db.user.deleteMany({ where: { id: 5 } }); }'));
    expect(issues.filter((i) => i.kind === 'missing-where-mutation')).toEqual([]);
  });
});

describe('analyzeQueryOptimizer — safety', () => {
  it('ignores test files and never throws on empty', async () => {
    expect(await analyzeQueryOptimizer([{ path: 'src/db.test.ts', content: 'db.user.findMany();' }])).toEqual([]);
    expect(await analyzeQueryOptimizer([])).toEqual([]);
  });
  it('summary is empty when clean, lists issues otherwise', async () => {
    expect(queryOptimizerSummary([])).toBe('');
    const issues = await analyzeQueryOptimizer(S('async function f(){ await db.user.deleteMany(); }'));
    expect(queryOptimizerSummary(issues)).toContain('Performance —');
  });
});
