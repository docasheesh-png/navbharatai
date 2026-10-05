// NO TEST LEAVES A TEMP DIRECTORY BEHIND (Q-672, found 2026-10-05 during the #3538 gates).
//
// The suite filled a session's disk mid-gate: about 24 GB in 6,688 directories under `/tmp`. Measured on
// 2026-10-05 with a private TMPDIR, 37 test files left 84 directories per run, because each
// called `mkdtempSync(join(tmpdir(), 'nbai-…-'))` and nothing removed it. (`scripts/serverDepsGate.mjs`
// had the same leak another way: `process.exit()` inside its `try` skipped the `finally` that removed its
// ~13 MB bundle.)
//
// The class: removal was a separate step each file had to remember. The fix is `tests/helpers/tempDir.ts`
// — `makeTempDir(prefix)` creates the directory and owns its removal. This census keeps the class closed:
// every test file that calls `mkdtemp`/`mkdtempSync` under the OS temp dir must either use the helper or
// remove what it made in an `afterAll` / `afterEach` / `onTestFinished` hook or a `finally` block.
//
// Limits, stated: the census sees a `mkdtemp` whose argument mentions `tmpdir()` (that is how every one in
// this repo is written); a directory made inside another test-owned directory is that directory's business.
// It checks that a removal exists in a place that runs, not that it names the same variable.

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { makeTempDir, removeTempDirs } from './helpers/tempDir';

const ROOT = join(__dirname, '..');

const MKDTEMP = new Set(['mkdtemp', 'mkdtempSync']);
const REMOVE = new Set(['rm', 'rmSync', 'rmdir', 'rmdirSync']);
const CLEANUP_HOOKS = new Set(['afterAll', 'afterEach', 'onTestFinished']);

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

/** Why this source leaks a temp directory, or null when it does not. */
export function tempDirLeak(fileName: string, text: string): string | null {
  const src = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let tempMakes = 0;
  let usesHelper = false;
  let removalThatRuns = false;
  // A local wrapper (`function cleanup(dir) { fs.rmSync(dir, …) }`) removes too: collect those names first.
  const removers = new Set(REMOVE);
  const collect = (n: ts.Node): void => {
    const body = ts.isFunctionDeclaration(n) ? n.body
      : ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) ? n.initializer.body
        : undefined;
    const name = ts.isFunctionDeclaration(n) ? n.name?.text : ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) ? n.name.text : undefined;
    if (body && name) {
      let removes = false;
      const look = (c: ts.Node): void => { if (ts.isCallExpression(c) && REMOVE.has(calleeName(c.expression))) removes = true; ts.forEachChild(c, look); };
      look(body);
      if (removes) removers.add(name);
    }
    ts.forEachChild(n, collect);
  };
  collect(src);
  const visit = (n: ts.Node, inCleanup: boolean): void => {
    let cleanup = inCleanup;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && /helpers\/tempDir$/.test(n.moduleSpecifier.text)) usesHelper = true;
    if (ts.isTryStatement(n) && n.finallyBlock) {
      visit(n.tryBlock, inCleanup);
      if (n.catchClause) visit(n.catchClause, inCleanup);
      visit(n.finallyBlock, true);
      return;
    }
    if (ts.isCallExpression(n)) {
      const name = calleeName(n.expression);
      if (CLEANUP_HOOKS.has(name)) cleanup = true;
      if (MKDTEMP.has(name) && n.arguments[0] && /\btmpdir\s*\(/.test(n.arguments[0].getText(src))) tempMakes++;
      if (removers.has(name) && inCleanup) removalThatRuns = true;
    }
    ts.forEachChild(n, (c) => visit(c, cleanup));
  };
  visit(src, false);
  if (tempMakes === 0 || removalThatRuns) return null;
  return usesHelper
    ? `${tempMakes} raw mkdtemp under tmpdir() beside the helper — use makeTempDir() for those too`
    : `${tempMakes} mkdtemp under tmpdir() and no removal in an after-hook or finally — use makeTempDir() from tests/helpers/tempDir`;
}

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) testFiles(p, out);
    else if (/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('the census logic (fixtures)', () => {
  it('🔴 the shape that leaked: mkdtemp under tmpdir() with nothing removing it', () => {
    expect(tempDirLeak('a.test.ts', "it('x', () => { const dir = mkdtempSync(join(tmpdir(), 'nbai-x-')); });")).toMatch(/no removal/);
  });
  it('🔴 a removal that is not in a hook or finally does not count (it is skipped when the test fails first)', () => {
    expect(tempDirLeak('a.test.ts', "it('x', () => { const d = mkdtempSync(join(tmpdir(), 'p-')); expect(1).toBe(1); rmSync(d, { recursive: true }); });")).not.toBeNull();
  });
  it('an afterAll / afterEach / onTestFinished removal is enough', () => {
    expect(tempDirLeak('a.test.ts', "let d; beforeAll(() => { d = mkdtempSync(join(tmpdir(), 'p-')); }); afterAll(() => rmSync(d, { recursive: true, force: true }));")).toBeNull();
    expect(tempDirLeak('a.test.ts', "it('x', () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p-')); onTestFinished(() => fs.rmSync(d, { recursive: true })); });")).toBeNull();
  });
  it('a local wrapper around the removal, called in finally, counts (securityEvaluator.test.ts shape)', () => {
    expect(tempDirLeak('a.test.ts', "function mk() { return fs.mkdtempSync(path.join(os.tmpdir(), 'p-')); }\nfunction cleanup(d) { fs.rmSync(d, { recursive: true }); }\nit('x', () => { const d = mk(); try { use(d); } finally { cleanup(d); } });")).toBeNull();
  });
  it('a finally removal is enough', () => {
    expect(tempDirLeak('a.test.ts', "it('x', async () => { const d = await mkdtemp(join(tmpdir(), 'p-')); try { use(d); } finally { await rm(d, { recursive: true }); } });")).toBeNull();
  });
  it('the helper is the answer; a directory made inside a test-owned directory is not counted', () => {
    expect(tempDirLeak('a.test.ts', "import { makeTempDir } from './helpers/tempDir';\nit('x', () => { makeTempDir('p-'); });")).toBeNull();
    expect(tempDirLeak('a.test.ts', "it('x', () => { mkdtempSync(path.join(root, 'npm-')); });")).toBeNull();
  });
});

describe('the helper really removes what it made', () => {
  it('makeTempDir makes a directory under the OS temp dir and removeTempDirs deletes it', () => {
    const dir = makeTempDir('nbai-helper-selftest-');
    expect(existsSync(dir)).toBe(true);
    removeTempDirs();
    expect(existsSync(dir)).toBe(false);
  });
});

describe('🔒 every test file in the repo', () => {
  it('no test makes a temp directory it does not remove', () => {
    const files = [...testFiles(join(ROOT, 'tests')), ...testFiles(join(ROOT, 'src'))];
    // Proof the scan covered the suite, not an empty folder.
    expect(files.length).toBeGreaterThan(1000);
    const leaks = files.map((f) => {
      const why = tempDirLeak(f, readFileSync(f, 'utf8'));
      return why ? `${relative(ROOT, f)} — ${why}` : null;
    }).filter(Boolean);
    expect(leaks).toEqual([]);
  });
});
