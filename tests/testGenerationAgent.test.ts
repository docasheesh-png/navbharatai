import { describe, it, expect } from 'vitest';
import {
  isTestableSource,
  extractExportedFunctions,
  testPathFor,
  moduleSpecifierFor,
  planAutoTests,
} from '../src/server/AgentV3/TestGenerationAgent';

/** P-AI.7 — automatic post-build test scaffolding (pure core). */

describe('isTestableSource', () => {
  it('accepts real source modules', () => {
    expect(isTestableSource('src/lib/auth.ts')).toBe(true);
    expect(isTestableSource('./src/hooks/useThing.tsx')).toBe(true);
  });
  it('rejects tests, types, configs, and entry/aggregator files', () => {
    expect(isTestableSource('src/lib/auth.test.ts')).toBe(false);
    expect(isTestableSource('src/lib/auth.spec.tsx')).toBe(false);
    expect(isTestableSource('src/types.ts')).toBe(false);
    expect(isTestableSource('src/index.ts')).toBe(false);
    expect(isTestableSource('vite.config.ts')).toBe(false);
    expect(isTestableSource('src/env.d.ts')).toBe(false);
    expect(isTestableSource('src/styles.css')).toBe(false);
  });
});

describe('extractExportedFunctions', () => {
  it('extracts function declarations and arrow consts with params and async', () => {
    const src = `
      export function add(a: number, b: number) { return a + b; }
      export async function load(id: string) { return id; }
      export const greet = (name: string): string => 'hi ' + name;
      export const fetchIt = async (url: string) => url;
      const internal = () => 1; // not exported
      export const NOTAFN = 42; // not a function
    `;
    const fns = extractExportedFunctions(src);
    const byName = Object.fromEntries(fns.map((f) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual(['add', 'fetchIt', 'greet', 'load']);
    expect(byName.add.params).toEqual(['a', 'b']);
    expect(byName.load.async).toBe(true);
    expect(byName.greet.async).toBe(false);
    expect(byName.fetchIt.async).toBe(true);
  });
  it('returns [] for empty / non-exporting source', () => {
    expect(extractExportedFunctions('')).toEqual([]);
    expect(extractExportedFunctions('const x = 1;')).toEqual([]);
  });
});

describe('testPathFor / moduleSpecifierFor', () => {
  it('derives the conventional test path and same-dir import', () => {
    expect(testPathFor('src/lib/auth.ts')).toBe('src/lib/auth.test.ts');
    expect(testPathFor('./src/ui/Button.tsx')).toBe('src/ui/Button.test.tsx');
    expect(moduleSpecifierFor('src/lib/auth.ts')).toBe('./auth');
    expect(moduleSpecifierFor('src/ui/Button.tsx')).toBe('./Button');
  });
});

describe('planAutoTests', () => {
  const files = [
    { path: 'src/lib/math.ts', content: 'export function add(a,b){return a+b;}\nexport function sub(a,b){return a-b;}' },
    { path: 'src/lib/util.ts', content: 'export function once(){return 1;}' },
    { path: 'src/app.ts', content: "import { add } from './lib/math';\nadd(1,2); add(3,4); once();" },
    { path: 'src/types.ts', content: 'export type T = number;' }, // skipped (entry/type)
  ];

  it('ranks most-used exports first and renders runnable skeletons', () => {
    const plan = planAutoTests(files, { limit: 2 });
    expect(plan).toHaveLength(2);
    // math.add is referenced more than util.once → math ranks first.
    expect(plan[0].sourcePath).toBe('src/lib/math.ts');
    expect(plan[0].testPath).toBe('src/lib/math.test.ts');
    expect(plan[0].modulePath).toBe('./math');
    expect(plan[0].content).toContain("import { add, sub } from './math'");
    // Phase 4.4 contract: the written assertion is true by construction, and the real behaviour is
    // PENDING rather than a TODO comment inside a test that already claims to pass.
    expect(plan[0].content).toContain("expect(typeof add).toBe('function');");
    expect(plan[0].content).toContain("it.todo('add — assert real behaviour with real arguments');");
    // The scaffold must never invent arguments — that is what made these suites ship red.
    expect(plan[0].content).not.toContain('undefined');
  });

  it('does not scaffold a test that already exists', () => {
    const plan = planAutoTests(
      [...files, { path: 'src/lib/math.test.ts', content: 'existing' }],
      { limit: 5 },
    );
    expect(plan.find((p) => p.sourcePath === 'src/lib/math.ts')).toBeUndefined();
  });

  it('respects existingPaths and tolerates empty input', () => {
    const plan = planAutoTests(files, { existingPaths: ['src/lib/math.test.ts', './src/lib/util.test.ts'], limit: 5 });
    expect(plan).toHaveLength(0);
    expect(planAutoTests([], {})).toEqual([]);
  });
});
