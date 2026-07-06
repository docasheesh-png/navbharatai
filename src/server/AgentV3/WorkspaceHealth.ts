// AgentV3 — Workspace Build-Health aggregator.
//
// One call that runs every workspace-level build-robustness check and returns a single, honest verdict:
// "will this generated app actually build and run?" It composes the existing pure analyzers —
// hallucination/code-confidence, React Rules-of-Hooks, import/export consistency, and JSX component
// resolution — into a combined report so a user (or the build flow) gets the whole picture in one shot,
// instead of running four checks by hand.
//
// HONESTY: every sub-result is the real analyzer's output; nothing is summarized away. `ok` is true only
// when EVERY check passes. Each check reports its own issue count so the caller can see exactly what to fix.

import { detectHallucinations } from './HallucinationDetector';
import { analyzeHooksRules } from './HooksRulesAnalysis';
import { analyzeImportExports } from './ImportExportAnalysis';
import { analyzeJsxComponents } from './JsxComponentAnalysis';

export interface HealthCheckResult {
  id: 'code-confidence' | 'react-hooks' | 'import-export' | 'jsx-resolution';
  name: string;
  ok: boolean;
  /** Number of issues this check found (0 when ok). */
  issues: number;
  /** A short, honest one-line summary of this check's outcome. */
  summary: string;
}

export interface WorkspaceHealthReport {
  ok: boolean;
  totalIssues: number;
  filesScanned: number;
  checks: HealthCheckResult[];
}

/** Run every workspace build-health check and combine the results. Pure (delegates to pure analyzers). */
export async function analyzeWorkspaceHealth(files: Record<string, string>): Promise<WorkspaceHealthReport> {
  // Code confidence is synchronous; the three AST analyzers are async. Run the async ones in parallel.
  const conf = detectHallucinations(files);
  const [hooks, imports, jsx] = await Promise.all([
    analyzeHooksRules(files),
    analyzeImportExports(files),
    analyzeJsxComponents(files),
  ]);

  const confIssues = conf.signals.length;
  const checks: HealthCheckResult[] = [
    {
      id: 'code-confidence',
      name: 'Code Confidence',
      ok: !conf.isLowConfidence,
      issues: confIssues,
      summary: conf.isLowConfidence
        ? `Low confidence (${conf.confidence}%): ${confIssues} signal(s) — hallucinated deps / unresolved imports / stubs.`
        : `Confidence ${conf.confidence}% — no blocking hallucination signals.`,
    },
    {
      id: 'react-hooks',
      name: 'React Rules of Hooks',
      ok: hooks.ok,
      issues: hooks.violations.length,
      summary: hooks.ok ? 'No Rules-of-Hooks violations.' : `${hooks.violations.length} violation(s) that crash React at runtime.`,
    },
    {
      id: 'import-export',
      name: 'Import / Export Consistency',
      ok: imports.ok,
      issues: imports.mismatches.length,
      summary: imports.ok ? 'All imports match their target exports.' : `${imports.mismatches.length} import(s) of names that aren't exported.`,
    },
    {
      id: 'jsx-resolution',
      name: 'JSX Component Resolution',
      ok: jsx.ok,
      issues: jsx.undefinedComponents.length,
      summary: jsx.ok ? 'Every JSX component resolves.' : `${jsx.undefinedComponents.length} component(s) used but never imported/defined.`,
    },
  ];

  const totalIssues = checks.reduce((s, c) => s + c.issues, 0);
  // filesScanned: the widest coverage among the AST passes (they scan overlapping subsets by file type).
  const filesScanned = Math.max(hooks.filesScanned, imports.filesScanned, jsx.filesScanned);

  return {
    ok: checks.every((c) => c.ok),
    totalIssues,
    filesScanned,
    checks,
  };
}
