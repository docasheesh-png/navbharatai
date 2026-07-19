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
import { analyzeUndefinedHooks } from './UndefinedHookAnalysis';
import { analyzeDependencyConstraints } from '../AI/reasoning/ConstraintSolver';
import { isReactFamilyFramework } from './frameworkFamily';

export interface HealthCheckResult {
  id: 'code-confidence' | 'react-hooks' | 'import-export' | 'jsx-resolution' | 'hook-resolution' | 'dependency-constraints';
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

/** Run every workspace build-health check and combine the results. Pure (delegates to pure analyzers).
 *  The React-specific checks (Rules-of-Hooks / JSX-resolution / hook-resolution) are reported as passing
 *  for non-React frameworks — a Vue/Nuxt/Svelte app's `useX` composables are NOT React hooks (ShopSphere
 *  autopsy). Framework defaults to the React family when omitted (historical behaviour). */
export async function analyzeWorkspaceHealth(files: Record<string, string>, framework?: string): Promise<WorkspaceHealthReport> {
  const reactLint = isReactFamilyFramework(framework);
  // Code confidence + dependency constraints are synchronous; the AST analyzers are async.
  const conf = detectHallucinations(files);
  const constraints = analyzeDependencyConstraints(files);
  const [hooks, imports, jsx, undefHooks] = await Promise.all([
    analyzeHooksRules(files),
    analyzeImportExports(files),
    analyzeJsxComponents(files),
    analyzeUndefinedHooks(files),
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
      ok: !reactLint || hooks.ok,
      issues: reactLint ? hooks.violations.length : 0,
      summary: !reactLint ? 'Not a React app — Rules-of-Hooks check skipped.' : hooks.ok ? 'No Rules-of-Hooks violations.' : `${hooks.violations.length} violation(s) that crash React at runtime.`,
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
      ok: !reactLint || jsx.ok,
      issues: reactLint ? jsx.undefinedComponents.length : 0,
      summary: !reactLint ? 'Not a JSX app — component-resolution check skipped.' : jsx.ok ? 'Every JSX component resolves.' : `${jsx.undefinedComponents.length} component(s) used but never imported/defined.`,
    },
    {
      id: 'hook-resolution',
      name: 'Hook Resolution',
      ok: !reactLint || undefHooks.ok,
      issues: reactLint ? undefHooks.undefinedHooks.length : 0,
      summary: !reactLint ? 'Not a React app — hook-resolution check skipped (Vue/Nuxt auto-imports composables).' : undefHooks.ok ? 'Every hook call resolves.' : `${undefHooks.undefinedHooks.length} hook(s) called but never imported/defined.`,
    },
    {
      id: 'dependency-constraints',
      name: 'Dependency Constraints',
      ok: constraints.ok,
      issues: constraints.conflicts.length,
      summary: constraints.ok ? 'No dependency version conflicts.' : `${constraints.conflicts.length} version conflict(s) (e.g. react/react-dom or @types mismatch).`,
    },
  ];

  const totalIssues = checks.reduce((s, c) => s + c.issues, 0);
  // filesScanned: the widest coverage among the AST passes (they scan overlapping subsets by file type).
  const filesScanned = Math.max(hooks.filesScanned, imports.filesScanned, jsx.filesScanned, undefHooks.filesScanned);

  return {
    ok: checks.every((c) => c.ok),
    totalIssues,
    filesScanned,
    checks,
  };
}
