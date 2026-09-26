/**
 * OUR OWN STARTER TESTS MUST COMPILE (autopsy eed79815, 2026-09-26).
 *
 * The finishing pass wrote three "runnable Vitest skeletons" into a car game. On the next turn
 * `tsc --noEmit` failed on every one — `Cannot find module 'vitest'` (nothing installs it) and
 * `Module './Game' has no exported member 'Game'` (it was a default export, imported as named) — and the
 * model spent steps deleting files it never asked for. The release build was safe (its config excludes
 * tests); the project's own typecheck, which the agent and our gates run, was not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractExportedFunctions, planAutoTests, testSkeletonsCanRun } from '../src/server/AgentV3/TestGenerationAgent';
import { generateUnitTest } from '../src/server/lib/TestSkeletonGenerator';

describe('a default export is imported as a default', () => {
  it('the report\'s Game.tsx gets `import Game from`, never `import { Game }`', () => {
    const fns = extractExportedFunctions('export default function Game() { return null; }');
    expect(fns).toEqual([{ name: 'Game', async: false, params: [], isDefault: true }]);
    const test = generateUnitTest({ modulePath: './Game', functions: fns });
    expect(test).toContain("import Game from './Game';");
    expect(test).not.toContain('{ Game }');
  });

  it('a default plus named exports import both, correctly', () => {
    const src = 'export function step(dt: number) {}\nexport default function Engine() {}\nexport const reset = () => {};';
    const test = generateUnitTest({ modulePath: './engine', functions: extractExportedFunctions(src) });
    expect(test).toContain("import Engine, { step, reset } from './engine';");
  });

  it('named exports alone are unchanged', () => {
    const test = generateUnitTest({ modulePath: './m', functions: extractExportedFunctions('export function a() {}\nexport async function b() {}') });
    expect(test).toContain("import { a, b } from './m';");
  });
});

describe('a skeleton is written only where vitest is declared', () => {
  const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json && vite build' }, ...extra });

  it('the report\'s package.json (no vitest) gets no skeleton', () => {
    expect(testSkeletonsCanRun(pkg({ devDependencies: { vite: '^8.3.0' } }))).toBe(false);
  });

  it('a project that installed vitest does', () => {
    expect(testSkeletonsCanRun(pkg({ devDependencies: { vitest: '^5' } }))).toBe(true);
    expect(testSkeletonsCanRun(pkg({ dependencies: { vitest: '^3' } }))).toBe(true);
  });

  it('no package.json, or a broken one, gets none — the import could not resolve', () => {
    expect(testSkeletonsCanRun(null)).toBe(false);
    expect(testSkeletonsCanRun('{ not json')).toBe(false);
  });

  it('the plan itself still ranks and renders (the gate is at the call site)', () => {
    const plan = planAutoTests([{ path: 'src/Game.tsx', content: 'export default function Game() { return null; }' }]);
    expect(plan[0].content).toContain("import Game from './Game';");
  });

  it('🔒 WIRING: the route asks testSkeletonsCanRun before it plans a skeleton', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    const ask = route.indexOf('const skeletonsSafe = testSkeletonsCanRun(pkgForTests)');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(route.indexOf('const plan = skeletonsSafe ? planAutoTests('));
  });
});
