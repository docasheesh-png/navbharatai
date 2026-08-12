/**
 * Scaling analysis — "will this app survive real traffic?"
 *
 * Two things are tested with equal weight, because a scanner fails in both directions:
 *   • it must CATCH the three problems that actually kill a growing app, and
 *   • it must stay QUIET on correct code — a scan that cries wolf gets ignored, and an ignored
 *     warning is worth less than no warning at all.
 *
 * The honesty invariant has its own test: this feature must never print an invented capacity number
 * ("handles 8,000 users"), because real capacity depends on the database plan and hosting, which the
 * code cannot see. That is the one claim a user would plan a launch around.
 */

import { describe, it, expect } from 'vitest';
import { analyzeScaling, readSchemaFacts } from '../src/server/AgentV3/ScaleAnalysis';

const app = (files: Record<string, string>) => files;

describe('unbounded queries', () => {
  it('catches a select that reads every row', () => {
    const r = analyzeScaling(app({
      'src/api.ts': "const { data } = await supabase.from('orders').select('*');",
    }));
    expect(r.counts['unbounded-query']).toBe(1);
    expect(r.findings[0].line).toBe(1);
    expect(r.findings[0].severity).toBe('critical');
  });

  it('🔒 stays quiet when the query IS bounded — across every paging style', () => {
    // The bug this prevents: judging one LINE instead of the statement would flag every correctly
    // paginated query in the app, which is most of them.
    const r = analyzeScaling(app({
      'src/a.ts': "await supabase.from('orders').select('*').limit(50);",
      'src/b.ts': "await supabase.from('orders')\n  .select('*')\n  .range(0, 49);",
      'src/c.ts': "await prisma.order.findMany({ take: 20 });",
      'src/d.ts': "await supabase.from('users').select('*').single();",
      'src/e.ts': "await db.collection('x').find({}).limit(10);",
    }));
    expect(r.counts['unbounded-query']).toBe(0);
    expect(r.ok).toBe(true);
  });

  it('does not flag a count — it returns one number, not every row', () => {
    const r = analyzeScaling(app({ 'src/a.ts': "await supabase.from('orders').select('*', { count: 'exact', head: true });" }));
    expect(r.counts['unbounded-query']).toBe(0);
  });

  it('catches a raw SQL select with no limit', () => {
    const r = analyzeScaling(app({ 'src/a.ts': "const rows = await db.query('select id, name from customers');" }));
    expect(r.counts['unbounded-query']).toBe(1);
  });
});

describe('the N+1 — a query inside a loop', () => {
  it('catches a query in a for loop', () => {
    const r = analyzeScaling(app({
      'src/a.ts': `for (const id of ids) {\n  const u = await supabase.from('users').select('*').eq('id', id).single();\n}`,
    }));
    expect(r.counts['query-in-loop']).toBe(1);
  });

  it('catches a query inside .map', () => {
    const r = analyzeScaling(app({
      'src/a.ts': `const rows = await Promise.all(ids.map(async (id) => {\n  return prisma.user.findUnique({ where: { id } });\n}));`,
    }));
    expect(r.counts['query-in-loop']).toBe(1);
  });

  it('🔒 sees past the parentheses of the query itself', () => {
    // The exact original failure: one depth counter for both `(` and `{` ended the loop body at the
    // `)` of `.from('users')` — two tokens in — so every N+1 went undetected while the code looked
    // correct. The `.from('…')` here is what makes this test the real regression case.
    const r = analyzeScaling(app({
      'src/a.ts': `for (const id of ids) {\n  const u = await supabase.from('users').select('*').eq('id', id).single();\n}`,
    }));
    expect(r.counts['query-in-loop']).toBe(1);
  });

  it('catches a C-style for loop, whose head legitimately contains semicolons', () => {
    const r = analyzeScaling(app({
      'src/a.ts': `for (let i = 0; i < ids.length; i++) {\n  await supabase.from('u').select('*').eq('id', ids[i]).single();\n}`,
    }));
    expect(r.counts['query-in-loop']).toBe(1);
  });

  it('🔒 a parallel fan-out is reported as pool pressure, NOT as multiplied latency', () => {
    // Promise.all fires them at once, so the sequential "500 items ≈ 10 s" figure would be a real
    // number attached to the wrong claim.
    const seq = analyzeScaling(app({
      'src/a.ts': `for (const id of ids) { await prisma.user.findUnique({ where: { id } }); }`,
    })).findings.find((f) => f.kind === 'query-in-loop');
    const par = analyzeScaling(app({
      'src/b.ts': `await Promise.all(ids.map(async (id) => prisma.user.findUnique({ where: { id } })));`,
    })).findings.find((f) => f.kind === 'query-in-loop');

    expect(seq?.atScale).toContain('10 s');
    expect(par?.atScale).not.toContain('10 s');
    expect(par?.atScale).toContain('connection per item');
  });

  it('🔒 stays quiet on a loop with no database call', () => {
    const r = analyzeScaling(app({
      'src/a.ts': `for (const x of items) {\n  total += x.price;\n}\nitems.map((x) => x.name);`,
    }));
    expect(r.counts['query-in-loop']).toBe(0);
  });

  it('stays quiet on a synchronous loop — no round-trips to pay for', () => {
    const r = analyzeScaling(app({ 'src/a.ts': `rows.map((r) => r.select);` }));
    expect(r.counts['query-in-loop']).toBe(0);
  });

  it('the fix it suggests is the batched query, not "make the loop faster"', () => {
    const r = analyzeScaling(app({
      'src/a.ts': `for (const id of ids) {\n  await supabase.from('users').select('*').eq('id', id).single();\n}`,
    }));
    expect(r.findings.find((f) => f.kind === 'query-in-loop')?.fix).toContain('.in(');
  });
});

describe('missing indexes', () => {
  const schema = `
create table customers (
  id uuid primary key,
  email text unique,
  city text,
  created_at timestamptz
);
create index customers_created_idx on customers (created_at);
`;

  it('reads what the migrations really declare', () => {
    const facts = readSchemaFacts({ 'migrations/001_init.sql': schema });
    expect(facts.tables.get('customers')).toContain('city');
    expect(facts.indexed.get('customers')).toContain('id');          // primary key
    expect(facts.indexed.get('customers')).toContain('email');       // unique
    expect(facts.indexed.get('customers')).toContain('created_at');  // explicit index
    expect(facts.indexed.get('customers')?.has('city')).toBe(false);
  });

  it('flags a filter on an unindexed column, and names the exact SQL fix', () => {
    const r = analyzeScaling(app({
      'migrations/001_init.sql': schema,
      'src/a.ts': "await supabase.from('customers').select('*').eq('city', c).limit(20);",
    }));
    expect(r.counts['missing-index']).toBe(1);
    expect(r.findings[0].fix).toBe('Add to a migration: create index on customers (city);');
  });

  it('🔒 stays quiet for indexed columns — primary key, unique and explicit index alike', () => {
    const r = analyzeScaling(app({
      'migrations/001_init.sql': schema,
      'src/a.ts':
        "await supabase.from('customers').select('*').eq('id', id).single();\n" +
        "await supabase.from('customers').select('*').eq('email', e).single();\n" +
        "await supabase.from('customers').select('*').order('created_at').limit(10);",
    }));
    expect(r.counts['missing-index']).toBe(0);
  });

  it('🔒 reports NOTHING when no schema was found — it does not guess', () => {
    // Without migrations we cannot know what is indexed. Silence is the honest answer; inventing one
    // would put a confident wrong claim in front of the user.
    const r = analyzeScaling(app({ 'src/a.ts': "await supabase.from('customers').select('*').eq('city', c).limit(5);" }));
    expect(r.counts['missing-index']).toBe(0);
  });

  it('does not guess about a table or column the schema never declared', () => {
    const r = analyzeScaling(app({
      'migrations/001_init.sql': schema,
      'src/a.ts':
        "await supabase.from('unknown_table').select('*').eq('city', c).limit(5);\n" +
        "await supabase.from('customers').select('*').eq('not_a_column', v).limit(5);",
    }));
    expect(r.counts['missing-index']).toBe(0);
  });

  it('🔒 reads a single-line create table — valid SQL a line-shaped regex silently skipped', () => {
    // The original parser required the closing `)` on its own line. A one-line table therefore
    // produced NO schema, and the whole index detector went quiet while appearing to work.
    const facts = readSchemaFacts({ 'm.sql': 'create table t (id uuid primary key, city text);' });
    expect(facts.tables.get('t')).toContain('city');
    expect(facts.indexed.get('t')).toContain('id');
  });

  it('🔒 does not invent columns from commas inside a type or a constraint', () => {
    const facts = readSchemaFacts({
      'm.sql': 'create table t (\n  id uuid,\n  price numeric(10, 2),\n  primary key (id)\n);',
    });
    expect([...(facts.tables.get('t') ?? [])].sort()).toEqual(['id', 'price']);
    expect(facts.indexed.get('t')).toContain('id');
  });

  it('a composite index covers a filter on its FIRST column only', () => {
    const facts = readSchemaFacts({
      'm.sql': 'create table t (a text, b text);\ncreate index t_ab on t (a, b);',
    });
    expect(facts.indexed.get('t')).toContain('a');
    expect(facts.indexed.get('t')?.has('b')).toBe(false);
  });
});

describe('🔒 it never invents a capacity number', () => {
  it('the verdict makes no claim about users or requests per second', () => {
    // The one number a user would plan a launch around is the one we cannot know. If a future edit
    // adds "handles N users", this test is what stops it reaching them.
    const r = analyzeScaling(app({ 'src/a.ts': "await supabase.from('o').select('*');" }));
    expect(r.verdict).not.toMatch(/\d[\d,]*\s*(concurrent\s+)?(users|visitors|requests|rps|req\/s)/i);
    expect(r.verdict).toContain('not a live load test');
  });

  it('says out loud what it did NOT check, in both the clean and the dirty case', () => {
    const clean = analyzeScaling(app({ 'src/a.ts': 'export const x = 1;' }));
    expect(clean.ok).toBe(true);
    expect(clean.verdict).toContain('database plan and hosting');
    const dirty = analyzeScaling(app({ 'src/a.ts': "await supabase.from('o').select('*');" }));
    expect(dirty.verdict).toContain('database plan and hosting');
  });

  it('every finding carries a real growth statement and an actionable fix', () => {
    const r = analyzeScaling(app({
      'migrations/1.sql': 'create table t (id uuid primary key, city text);',
      'src/a.ts':
        "await supabase.from('t').select('*');\n" +
        "for (const id of ids) { await supabase.from('t').select('*').eq('city', id).single(); }",
    }));
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
    for (const f of r.findings) {
      expect(f.atScale.length, f.kind).toBeGreaterThan(40);
      expect(f.fix.length, f.kind).toBeGreaterThan(10);
      expect(f.line, f.kind).toBeGreaterThan(0);
      expect(f.snippet, f.kind).not.toBe('');
    }
  });
});

describe('what it refuses to scan', () => {
  it('skips tests, node_modules and build output — their queries are not the app', () => {
    const r = analyzeScaling(app({
      'tests/a.test.ts': "await supabase.from('o').select('*');",
      'node_modules/pkg/index.js': "await supabase.from('o').select('*');",
      'dist/bundle.js': "await supabase.from('o').select('*');",
      '__tests__/b.ts': "await supabase.from('o').select('*');",
    }));
    expect(r.filesScanned).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it('skips a file too large to be hand-written code', () => {
    const huge = `await supabase.from('o').select('*');\n` + 'x'.repeat(500_000);
    expect(analyzeScaling(app({ 'src/huge.ts': huge })).filesScanned).toBe(0);
  });

  it('handles an empty or junk workspace without throwing', () => {
    expect(analyzeScaling({}).ok).toBe(true);
    expect(analyzeScaling({}).verdict).toContain('No app code to check yet');
    expect(() => analyzeScaling(undefined as never)).not.toThrow();
  });

  it('🔒 terminates on an unbalanced brace instead of scanning to the end of the file', () => {
    // A generated file can be truncated mid-block; a body scan without a ceiling would walk the rest
    // of the file and report the loop as containing every query below it.
    const src = `for (const x of xs) {\n  await supabase.from('a').select('*');\n` + 'const y = 1;\n'.repeat(2000);
    expect(() => analyzeScaling(app({ 'src/a.ts': src }))).not.toThrow();
  });

  it('caps the number of findings so a pathological project cannot produce a huge report', () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) files[`src/f${i}.ts`] = "await supabase.from('o').select('*');";
    const r = analyzeScaling(files);
    expect(r.findings.length).toBeLessThanOrEqual(100);
  });
});
