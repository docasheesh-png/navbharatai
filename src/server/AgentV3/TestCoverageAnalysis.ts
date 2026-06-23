// AgentV3 — Testing Intelligence: test-coverage gaps (Phase 6 v1).
//
// Phase 6 (Testing & Autonomous Loops) needs the agent to actually verify its
// work, not assume it. This PURE, deterministic analyser reads the project graph
// and reports which source modules/components have NO test — an honest "what is
// untested" signal folded into the `evaluate` tool. The agent (or the qa
// sub-agent) can then write the missing tests and re-evaluate, closing the
// plan → build → TEST → validate loop instead of declaring "done" on faith.
//
// Conservative by design (same ethos as PlanIntelligence): coverage is credited
// generously (co-located test files AND anything a test file imports count), so a
// project with real tests is never nagged; only clear gaps are surfaced.
//
// Pure over the graph — no sandbox/file reads — so it is fully unit-testable and
// can never break `evaluate`.

import type { ProjectGraph } from './WorkspaceMemory';

export type TestCoverageLevel = 'high' | 'medium' | 'low';

export interface TestCoverageFinding {
  level: TestCoverageLevel;
  message: string;
}

export interface TestCoverageReport {
  /** Testable source modules (code files minus tests, entrypoints, config, types). */
  sourceFiles: number;
  /** Test/spec files seen in the graph. */
  testFiles: number;
  /** Source modules judged covered by a test. */
  coveredFiles: number;
  /** Source modules with no detected test. */
  uncoveredFiles: string[];
  /** Component symbols whose declaring file is uncovered. */
  untestedComponents: string[];
  /** Covered / testable source modules, 0..1 (0 when there are none). */
  coverageRatio: number;
  findings: TestCoverageFinding[];
}

const TEST_RE = /\.(test|spec)\.[jt]sx?$/;
const CODE_RE = /\.[jt]sx?$/;
// Entrypoints, config and type-declaration files are not meaningfully unit-
// testable on their own, so their lack of a test is not a real coverage gap.
const NON_UNIT_RE =
  /(?:^|\/)(?:main|index)\.[jt]sx?$|\.d\.ts$|(?:^|\/)[^/]*\.config\.[jt]s$|(?:^|\/)(?:setupTests|test-setup|vite-env)\b/i;

function lastSegment(p: string): string {
  return p.split('/').pop() || p;
}
function sourceBase(file: string): string {
  return lastSegment(file).replace(CODE_RE, '');
}
function testBase(file: string): string {
  return lastSegment(file).replace(TEST_RE, '');
}
function specBase(spec: string): string {
  return lastSegment(spec).replace(CODE_RE, '');
}

/**
 * Report test-coverage gaps from the project graph. PURE & deterministic.
 * Returns an all-zero report with no findings for an empty/absent graph.
 */
export function analyzeTestCoverage(graph: ProjectGraph): TestCoverageReport {
  const files = Array.isArray(graph?.files) ? graph.files : [];
  const imports = (graph && graph.imports) || {};
  const symbols = Array.isArray(graph?.symbols) ? graph.symbols : [];

  const testFilesList = files.filter((f) => TEST_RE.test(f));
  const sourceFilesList = files.filter(
    (f) => CODE_RE.test(f) && !TEST_RE.test(f) && !NON_UNIT_RE.test(f),
  );

  // What the tests reach: same-base (co-located) test files, plus the base name
  // of anything a test file imports. Credited generously to avoid false nags.
  const covered = new Set<string>();
  for (const t of testFilesList) {
    covered.add(testBase(t));
    for (const spec of imports[t] || []) covered.add(specBase(spec));
  }

  const uncoveredFiles = sourceFilesList.filter((f) => !covered.has(sourceBase(f)));
  const coveredFiles = sourceFilesList.length - uncoveredFiles.length;
  const coverageRatio = sourceFilesList.length === 0 ? 0 : coveredFiles / sourceFilesList.length;

  const uncoveredSet = new Set(uncoveredFiles);
  const untestedComponents = Array.from(
    new Set(
      symbols
        .filter((s) => s && s.kind === 'component' && s.file && uncoveredSet.has(s.file))
        .map((s) => s.name),
    ),
  );

  const findings: TestCoverageFinding[] = [];
  if (sourceFilesList.length >= 3 && testFilesList.length === 0) {
    findings.push({
      level: 'high',
      message: `No tests at all — ${sourceFilesList.length} source modules and 0 test files. Add tests so the build can be verified, not assumed.`,
    });
  } else if (untestedComponents.length > 0) {
    const sample = untestedComponents.slice(0, 3).join(', ');
    findings.push({
      level: 'medium',
      message: `${untestedComponents.length} component(s) have no test (e.g. ${sample}) — add at least a render/smoke test.`,
    });
  }
  if (testFilesList.length > 0 && sourceFilesList.length >= 4 && coverageRatio < 0.5) {
    findings.push({
      level: 'low',
      message: `Test coverage looks thin — about ${Math.round(coverageRatio * 100)}% of modules have a test.`,
    });
  }

  return {
    sourceFiles: sourceFilesList.length,
    testFiles: testFilesList.length,
    coveredFiles,
    uncoveredFiles,
    untestedComponents,
    coverageRatio,
    findings,
  };
}

/** A short, honest test-coverage block for the `evaluate` output. */
export function testCoverageSummary(report: TestCoverageReport): string {
  const { sourceFiles, testFiles, findings } = report;
  if (findings.length === 0) {
    if (sourceFiles === 0) return 'Test coverage: — (no source modules indexed yet).';
    return `Test coverage: ✓ ${testFiles} test file(s) across ${sourceFiles} module(s) — no obvious coverage gaps.`;
  }
  const order: Record<TestCoverageLevel, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);
  const head = `Test coverage — ${findings.length} gap${findings.length === 1 ? '' : 's'} (${testFiles} test file(s), ${sourceFiles} module(s)):`;
  const body = sorted.map((f) => `  ⚠ ${f.message}`);
  return [head, ...body].join('\n');
}
