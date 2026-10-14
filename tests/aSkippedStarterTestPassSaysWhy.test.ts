/**
 * A PASS ADVERTISED AS RUNNING BY DEFAULT SAYS WHY WHEN IT SKIPS — autopsy 9c612cdb (Q-994).
 *
 * The real case: a green React app built on the platform's default vite-react starter. The readiness gate
 * said "No tests at all"; the end-to-end scaffold wrote its suite and said so; the P-AI.7 starter unit-test
 * pass wrote NOTHING and said nothing — because that starter declares no test runner, so since #3331 the
 * pass cannot write on an ordinary build at all. Meanwhile `AppKnowledgeBase.ts` told every AI that each
 * build gets "a starter test skeleton" BY DEFAULT.
 *
 * Two halves of one class, both locked here: (1) the skip is recorded with its reason, derived from the
 * same facts the pass decided on; (2) the knowledge base says what actually lands, judged against the REAL
 * default starter rather than a paraphrase of it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TemplateRegistry } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/TemplateRegistry';
import { testSkeletonsCanRun } from '../src/server/AgentV3/TestGenerationAgent';
import { STARTER_TESTS_NEED_VITEST, starterTestsSkipReason, starterTestsSkippedNote, STARTER_TESTS_NO_PACKAGE_JSON, STARTER_TESTS_PACKAGE_JSON_UNREADABLE } from '../src/server/AgentV3/starterTestsSkip';
import { PROCESS_ONLY_CODES, isAppFinding } from '../src/server/AgentV3/BuildDiagnostics';
import { codeOnly, enclosingBlock, sectionUntil } from './helpers/sourceSlice';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
/** The package.json the default starter really writes — the one report 9c612cdb's app was built on. */
const starterPackageJson = (): string => {
  const files = new TemplateRegistry().getProvider('vite-react').getFiles([]) as Record<string, string>;
  const pkg = files['package.json'];
  expect(typeof pkg, 'the default starter writes a package.json').toBe('string');
  return pkg;
};
const withVitest = JSON.stringify({ name: 'x', devDependencies: { vitest: '^5.0.3', vite: '^8.0.0' } });

describe('the skip reason — derived from the facts the pass decided on', () => {
  it('🔒 THE REPORT\'S CASE: the default starter declares no vitest, so the reason names it', () => {
    const pkg = starterPackageJson();
    expect(testSkeletonsCanRun(pkg)).toBe(false);
    const reason = starterTestsSkipReason({ packageJson: pkg, skeletonsSafe: false, planned: 0, written: 0 });
    expect(reason).toBe(STARTER_TESTS_NEED_VITEST);
    expect(reason).toBe('vitest is not declared in package.json');
    expect(starterTestsSkippedNote(reason as string)).toBe('No starter unit tests were added — vitest is not declared in package.json.');
  });

  it('says nothing when the pass wrote at least one test', () => {
    expect(starterTestsSkipReason({ packageJson: withVitest, skeletonsSafe: true, planned: 2, written: 2 })).toBeNull();
    expect(starterTestsSkipReason({ packageJson: withVitest, skeletonsSafe: true, planned: 3, written: 1 })).toBeNull();
  });

  it('names the FIRST thing that stopped it, in the pass\'s own order', () => {
    // 🔴 THESE TWO LINES USED TO PIN THE DEFECT Q-1032 NAMES, and that is why they changed.
    //
    // They asserted that a project with NO package.json, and one whose package.json is not JSON, are
    // both reported as "vitest is not declared in package.json" — a sentence about a file that does
    // not exist, or about a declaration nobody could read. A false reason is worse than a vague one:
    // it is actionable in the WRONG direction, sending a reader to add a dependency to nothing.
    // `testSkeletonsCanRun` collapses all three worlds into one `false`; the reason now tells them
    // apart, because the fixes differ.
    expect(starterTestsSkipReason({ packageJson: null, skeletonsSafe: false, planned: 0, written: 0 })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ packageJson: undefined, skeletonsSafe: false, planned: 0, written: 0 })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ packageJson: '   ', skeletonsSafe: false, planned: 0, written: 0 })).toBe(STARTER_TESTS_NO_PACKAGE_JSON);
    expect(starterTestsSkipReason({ packageJson: '{ not json', skeletonsSafe: false, planned: 0, written: 0 })).toBe(STARTER_TESTS_PACKAGE_JSON_UNREADABLE);
    // A readable package.json that simply declares no runner keeps the original sentence, which was
    // always true of exactly this case.
    expect(starterTestsSkipReason({ packageJson: '{"name":"app"}', skeletonsSafe: false, planned: 0, written: 0 })).toBe(STARTER_TESTS_NEED_VITEST);
    // No two of the three say the same thing, or telling them apart would be decoration.
    expect(new Set([STARTER_TESTS_NO_PACKAGE_JSON, STARTER_TESTS_PACKAGE_JSON_UNREADABLE, STARTER_TESTS_NEED_VITEST]).size).toBe(3);
    // And none of them names a file the project does not have.
    expect(STARTER_TESTS_NO_PACKAGE_JSON).not.toMatch(/not declared in package\.json/);
    expect(starterTestsSkipReason({ packageJson: withVitest, skeletonsSafe: false, planned: 0, written: 0 })).toMatch(/production build/);
    expect(starterTestsSkipReason({ packageJson: withVitest, skeletonsSafe: true, planned: 0, written: 0 })).toMatch(/exports a function/);
    expect(starterTestsSkipReason({ packageJson: withVitest, skeletonsSafe: true, planned: 2, written: 0 })).toBe('none of the 2 planned test file(s) could be written');
  });

  it('the code is our own process, never a finding against the app', () => {
    expect(PROCESS_ONLY_CODES.has('STARTER_TESTS_SKIPPED')).toBe(true);
    expect(isAppFinding({ phase: 'build', code: 'STARTER_TESTS_SKIPPED' })).toBe(false);
  });
});

describe('🔒 WIRING — the starter-test pass records its skip, as the end-to-end scaffold does', () => {
  const route = codeOnly(read('src/server/routes/agentv3.ts'));
  const pass = sectionUntil(route, "await runInPass('starter-tests'", "await runInPass('production-defaults'");

  it('the pass is found (a guard that cannot find its code proves nothing)', () => {
    expect(pass.length).toBeGreaterThan(200);
  });

  it('records STARTER_TESTS_SKIPPED from starterTestsSkipReason, at info severity, inside the pass', () => {
    expect(pass).toContain('starterTestsSkipReason({ packageJson: pkgForTests, skeletonsSafe, planned: plan.length, written: scaffolded.length })');
    const rec = enclosingBlock(pass, "code: 'STARTER_TESTS_SKIPPED'");
    expect(rec).toContain("severity: 'info'");
    expect(rec).toContain('starterTestsSkippedNote(');
  });

  it('the sibling pass still records its own skip (the class has two members)', () => {
    expect(route).toContain("code: 'E2E_SCAFFOLD_SKIPPED'");
  });
});

describe('🔒 THE KNOWLEDGE BASE SAYS WHAT LANDS — checked against the real default starter', () => {
  const kb = read('src/server/AppContext/AppKnowledgeBase.ts');
  const quality = kb.split('\n').find((l) => l.includes('QUALITY DEFAULTS (U-2')) ?? '';

  it('the quality-defaults line is found', () => {
    expect(quality.length).toBeGreaterThan(100);
  });

  it('while the default starter cannot run a unit-test skeleton, no line promises one by default', () => {
    // The fact the claim must answer to: the starter every ordinary build starts from.
    expect(testSkeletonsCanRun(starterPackageJson())).toBe(false);
    expect(/plus a starter test skeleton/i.test(kb), 'the knowledge base still promises a starter test skeleton on every build').toBe(false);
    // The corrected line names the condition under which unit tests DO land, and that the e2e suite is not run.
    expect(quality).toMatch(/ONLY where the project already declares vitest/);
    expect(quality).toMatch(/NOT run during the build/);
  });
});
