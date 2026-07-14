import { describe, it, expect } from 'vitest';
import { analyzeQueryPatterns, queryPatternSummary } from './queryPatternAnalysis';

const src = (content: string, path = 'src/api/orders.ts') => [{ path, content }];

describe('analyzeQueryPatterns — N+1 detection', () => {
  it('flags an awaited query inside a for-of loop', async () => {
    const issues = await analyzeQueryPatterns(src(
      `async function load(ids: string[]) {\n  const out = [];\n  for (const id of ids) {\n    const c = await db.customer.findUnique({ where: { id } });\n    out.push(c);\n  }\n  return out;\n}`));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: 'n-plus-one', method: 'findUnique', file: 'src/api/orders.ts' });
    expect(issues[0].detail).toContain('N+1');
  });

  it('flags an awaited query inside an array .map(async …) callback', async () => {
    const issues = await analyzeQueryPatterns(src(
      `async function enrich(orders) {\n  return Promise.all(orders.map(async (o) => {\n    const cust = await prisma.customer.findMany({ where: { id: o.customerId } });\n    return { ...o, cust };\n  }));\n}`));
    expect(issues).toHaveLength(1);
    expect(issues[0].method).toBe('findMany');
  });

  it('flags a raw driver query in a while loop', async () => {
    const issues = await analyzeQueryPatterns(src(
      `async function drain(q) {\n  let row;\n  while ((row = q.pop())) {\n    await pool.query('UPDATE t SET x=1 WHERE id=$1', [row.id]);\n  }\n}`));
    expect(issues).toHaveLength(1);
    expect(issues[0].method).toBe('query');
  });

  it('does NOT flag a query OUTSIDE any loop (the correct, batched shape)', async () => {
    const issues = await analyzeQueryPatterns(src(
      `async function load(ids: string[]) {\n  const all = await db.customer.findMany({ where: { id: { in: ids } } });\n  return all;\n}`));
    expect(issues).toEqual([]);
  });

  it('does NOT flag a non-query method called in a loop (e.g. array.push)', async () => {
    const issues = await analyzeQueryPatterns(src(
      `function f(xs) {\n  const out = [];\n  for (const x of xs) { out.push(x * 2); }\n  return out;\n}`));
    expect(issues).toEqual([]);
  });

  it('does NOT flag a query in a nested function defined in a loop but not itself iterated', async () => {
    // The await is inside a FunctionDeclaration boundary → climbing stops, not attributed to the outer loop.
    const issues = await analyzeQueryPatterns(src(
      `function build(items) {\n  for (const i of items) {\n    async function handler() { return await db.thing.find(); }\n    register(handler);\n  }\n}`));
    expect(issues).toEqual([]);
  });

  it('skips test files and de-dupes; summary reports the count or is empty when clean', async () => {
    expect(await analyzeQueryPatterns(src(`for (const x of xs) { await db.q.find(); }`, 'src/x.test.ts'))).toEqual([]);
    expect(queryPatternSummary([])).toBe('');
    const issues = await analyzeQueryPatterns(src(`async function f(xs){ for (const x of xs){ await db.a.findMany(); } }`));
    expect(queryPatternSummary(issues)).toContain('N+1 query pattern');
  });

  it('never throws on malformed input', async () => {
    // @ts-expect-error malformed
    expect(await analyzeQueryPatterns(null)).toEqual([]);
    expect(await analyzeQueryPatterns([{ path: 'src/a.ts', content: 'const <<< =' }])).toEqual([]);
  });
});
