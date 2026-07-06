// P-PME.12 — Requirement Traceability Matrix (requirement → generated file → test).
//
// RequirementIntelligenceEngine parses requirements and FilePlanningEngine maps them to files, but
// nothing linked the full chain: "requirement #3 → authService.ts → auth.test.ts". Without that link
// you cannot answer "is every requirement implemented AND tested?", or "which generated file has no
// test?", or "which requirement was silently dropped?".
//
// This is a PURE, deterministic, dependency-free engine (no I/O) so it is fully unit-testable. The
// caller supplies the three signal sets it already computes during a build (the requirements, the
// generated source files each tagged with the requirement ids it satisfies, and the generated tests
// each optionally declaring which source paths it covers). The engine derives the matrix + coverage
// gaps. Test↔file linking uses an explicit `covers` list when present, else a filename convention
// (`auth.test.ts` / `auth.spec.ts` ↔ `auth.ts`) — both deterministic.

export interface TraceRequirement {
  /** Stable requirement id (e.g. "R3"). */
  id: string;
  /** Human-readable requirement text (optional — kept for the readable matrix). */
  text?: string;
}

export interface TraceFile {
  /** Generated source file path. */
  path: string;
  /** Ids of the requirements this file helps satisfy (from FilePlanningEngine). */
  requirementIds?: string[];
}

export interface TraceTest {
  /** Generated test file path. */
  path: string;
  /** Source paths this test explicitly covers (optional — else matched by filename convention). */
  covers?: string[];
}

export interface TraceabilityInput {
  requirements: TraceRequirement[];
  files: TraceFile[];
  tests?: TraceTest[];
}

export interface TracedFile {
  path: string;
  /** Test file paths that cover this source file. */
  tests: string[];
  tested: boolean;
}

export interface TracedRequirement {
  id: string;
  text?: string;
  files: TracedFile[];
  fileCount: number;
  testedFileCount: number;
  /** Has at least one generated file. */
  implemented: boolean;
  /** Implemented AND every one of its files has at least one covering test. */
  fullyTested: boolean;
}

export interface TraceabilitySummary {
  totalRequirements: number;
  implementedRequirements: number;
  fullyTestedRequirements: number;
  /** Requirement ids with no generated file — silently-dropped requirements. */
  unimplementedRequirements: string[];
  /** Source file paths with no covering test. */
  untestedFiles: string[];
  /** Test file paths that cover none of the known source files — orphan tests. */
  orphanTests: string[];
  /** fullyTested / total × 100, rounded. 0 when there are no requirements. */
  coveragePct: number;
}

export interface TraceabilityMatrix {
  requirements: TracedRequirement[];
  summary: TraceabilitySummary;
  /** Optional workspace id the matrix was computed for. */
  workspaceId?: string;
  /** Schema tag for the downloadable artifact. */
  schema: 'navbharatai.traceability/1';
}

/** Basename minus its final extension. `src/a/auth.ts` → `auth`, `x.test.tsx` → `x.test`. */
function basenameNoExt(path: string): string {
  const base = String(path || '').split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The source stem a test file targets by convention: strip a trailing `.test`/`.spec` + extension. */
function testStem(path: string): string {
  return basenameNoExt(path).replace(/\.(test|spec)$/i, '');
}

/** True when `test` covers `filePath` — explicit `covers` match, else filename convention. Pure. */
export function testCoversFile(test: TraceTest, filePath: string): boolean {
  if (!filePath) return false;
  const covers = Array.isArray(test.covers) ? test.covers : [];
  if (covers.some((c) => String(c) === filePath)) return true;
  const stem = testStem(test.path);
  return !!stem && stem === basenameNoExt(filePath);
}

/**
 * Build the requirement → file → test traceability matrix + coverage summary. Pure & deterministic.
 * Malformed/blank entries are ignored defensively; file paths are deduped within a requirement.
 */
export function buildTraceabilityMatrix(input: TraceabilityInput, workspaceId?: string): TraceabilityMatrix {
  const requirements = (input?.requirements ?? []).filter((r) => r && typeof r.id === 'string' && r.id);
  const files = (input?.files ?? []).filter((f) => f && typeof f.path === 'string' && f.path);
  const tests = (input?.tests ?? []).filter((t) => t && typeof t.path === 'string' && t.path);

  // Which tests cover each known source file (computed once).
  const testsForFile = new Map<string, string[]>();
  for (const f of files) {
    const covering = tests.filter((t) => testCoversFile(t, f.path)).map((t) => t.path);
    testsForFile.set(f.path, Array.from(new Set(covering)));
  }

  const traced: TracedRequirement[] = requirements.map((req) => {
    const seen = new Set<string>();
    const reqFiles: TracedFile[] = [];
    for (const f of files) {
      const ids = Array.isArray(f.requirementIds) ? f.requirementIds.map(String) : [];
      if (!ids.includes(req.id) || seen.has(f.path)) continue;
      seen.add(f.path);
      const covering = testsForFile.get(f.path) ?? [];
      reqFiles.push({ path: f.path, tests: covering, tested: covering.length > 0 });
    }
    const testedFileCount = reqFiles.filter((f) => f.tested).length;
    const implemented = reqFiles.length > 0;
    return {
      id: req.id,
      text: req.text,
      files: reqFiles,
      fileCount: reqFiles.length,
      testedFileCount,
      implemented,
      fullyTested: implemented && testedFileCount === reqFiles.length,
    };
  });

  const untestedFiles = files
    .filter((f) => (testsForFile.get(f.path) ?? []).length === 0)
    .map((f) => f.path);
  const orphanTests = tests
    .filter((t) => !files.some((f) => testCoversFile(t, f.path)))
    .map((t) => t.path)
    .filter((p, i, a) => a.indexOf(p) === i);

  const fullyTestedRequirements = traced.filter((r) => r.fullyTested).length;
  const summary: TraceabilitySummary = {
    totalRequirements: traced.length,
    implementedRequirements: traced.filter((r) => r.implemented).length,
    fullyTestedRequirements,
    unimplementedRequirements: traced.filter((r) => !r.implemented).map((r) => r.id),
    untestedFiles: Array.from(new Set(untestedFiles)),
    orphanTests,
    coveragePct: traced.length ? Math.round((fullyTestedRequirements / traced.length) * 100) : 0,
  };

  return { requirements: traced, summary, workspaceId, schema: 'navbharatai.traceability/1' };
}
