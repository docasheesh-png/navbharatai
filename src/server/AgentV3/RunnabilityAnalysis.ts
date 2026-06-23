// AgentV3 — Execution Quality: runnability check (Phase 6 v1).
//
// "Preview is EARNED" — a build that compiles can still be impossible to actually
// START or BUILD: no dev/start script, a bundler dependency with no `build` script,
// or a Vite/CRA front-end with no index.html entry. This PURE, deterministic analyser
// reads the project graph + package.json and reports those concrete "it won't run"
// defects so the agent fixes them before claiming the app works.
//
// High-precision: it only assesses Node projects (a package.json + code files) and
// each rule fires only on a clear signal, so a real, runnable app is never nagged.

import type { ProjectGraph } from './WorkspaceMemory';

export type RunLevel = 'high' | 'medium' | 'low';

export interface RunFinding {
  level: RunLevel;
  message: string;
}

export interface RunnabilityReport {
  /** Whether the project could be assessed (a Node manifest + code was present). */
  assessed: boolean;
  findings: RunFinding[];
}

interface Pkg {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function parsePkg(raw?: string | null): Pkg | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? (p as Pkg) : null;
  } catch {
    return null;
  }
}

/**
 * Report concrete "the app can't run/build" defects. PURE & deterministic.
 * `assessed` is false (with no findings) when there is no Node manifest/code to judge.
 */
export function analyzeRunnability(graph: ProjectGraph, packageJson?: string | null): RunnabilityReport {
  const files = Array.isArray(graph?.files) ? graph.files : [];
  const pkg = parsePkg(packageJson);
  const codeFiles = files.filter((f) => /\.(t|j)sx?$/.test(f));

  // Not a Node app (no manifest) or nothing built yet → not assessable here.
  if (!pkg || codeFiles.length === 0) return { assessed: false, findings: [] };

  const scripts = pkg.scripts || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const findings: RunFinding[] = [];

  if (!(scripts.dev || scripts.start || scripts.serve)) {
    findings.push({
      level: 'high',
      message: 'No run script (dev/start/serve) in package.json — there is no defined way to start the app.',
    });
  }

  const hasBundler = ['vite', 'webpack', 'next', 'parcel', '@angular/cli'].some((d) => d in deps);
  if (hasBundler && !scripts.build) {
    findings.push({
      level: 'medium',
      message: 'A bundler is a dependency but there is no "build" script — the app cannot be built for deployment.',
    });
  }

  const usesViteOrCra = 'vite' in deps || 'react-scripts' in deps;
  const hasIndexHtml = files.some((f) => /(^|\/)index\.html$/.test(f));
  if (usesViteOrCra && !hasIndexHtml) {
    findings.push({
      level: 'medium',
      message: 'A Vite/CRA app has no index.html entry — the dev server has nothing to serve.',
    });
  }

  return { assessed: true, findings };
}

/** A short, honest runnability block for the `evaluate` output. */
export function runnabilitySummary(report: RunnabilityReport): string {
  if (!report.assessed) return 'Runnability: — (no Node manifest to assess).';
  if (report.findings.length === 0) return 'Runnability: ✓ the project has a defined way to run and build.';
  const order: Record<RunLevel, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...report.findings].sort((a, b) => order[a.level] - order[b.level]);
  const head = `Runnability — ${report.findings.length} issue(s) that stop the app running/building:`;
  return [head, ...sorted.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
