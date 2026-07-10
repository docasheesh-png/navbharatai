// GA-3 (roadmap Tier 2) — package.json health check for issues the existing dependency tooling misses.
// DependencyReconciler covers "source imports a package that isn't declared"; DependencyAnalysis covers
// unused + floating versions. NEITHER catches the two most common package.json foot-guns:
//   1. an npm SCRIPT that runs a build tool the project never installed (e.g. "lint": "eslint ." with no
//      eslint dep) — the script dies with "command not found" the moment anyone runs it, and
//   2. the same package declared in BOTH dependencies and devDependencies (ambiguous resolution).
//
// PURE + dependency-free (reads only the package.json text) → fully unit-testable. The ToolDispatcher
// `check_package` tool reports the result. Conservative by design: it only flags a KNOWN build tool whose
// package is genuinely absent, so it never false-positives on a custom/shell command.

export type PackageIssueKind = 'script-tool-missing' | 'dup-dep';

export interface PackageIssue {
  kind: PackageIssueKind;
  detail: string;
}

export interface PackageHealthResult {
  ok: boolean;
  issues: PackageIssue[];
}

// Common script CLIs → the npm package that provides the binary. Only these are checked (high precision).
const TOOL_PACKAGE: Record<string, string> = {
  tsc: 'typescript', vitest: 'vitest', jest: 'jest', mocha: 'mocha', eslint: 'eslint',
  prettier: 'prettier', vite: 'vite', next: 'next', nuxt: 'nuxt', ng: '@angular/cli',
  svelte: 'svelte', playwright: '@playwright/test', cypress: 'cypress', tailwindcss: 'tailwindcss',
  postcss: 'postcss', tsx: 'tsx', 'ts-node': 'ts-node', nodemon: 'nodemon', webpack: 'webpack',
  'webpack-cli': 'webpack-cli', rollup: 'rollup', esbuild: 'esbuild', storybook: 'storybook',
  concurrently: 'concurrently', rimraf: 'rimraf', 'cross-env': 'cross-env', turbo: 'turbo',
  astro: 'astro', remix: '@remix-run/dev', gatsby: 'gatsby', parcel: 'parcel', biome: '@biomejs/biome',
};

// Wrapper commands to skip so we reach the REAL tool (e.g. `npx eslint`, `cross-env NODE_ENV=x vite`).
const WRAPPERS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bun', 'cross-env', 'concurrently', 'run-p', 'run-s', 'npm-run-all', 'dotenv', 'env']);
// Shell builtins / runtimes that are always available — never flagged.
const ALWAYS_OK = new Set(['node', 'echo', 'cd', 'rm', 'mkdir', 'cp', 'mv', 'cat', 'true', 'false', 'set', 'export', 'wait', 'sh', 'bash', 'test', 'touch', 'ls', 'git', 'python', 'python3', 'pip', 'go', 'mvn', 'gradle', './gradlew', 'cargo', 'make', 'docker']);

/** First real command token of a shell fragment, skipping wrapper prefixes + their flags/env-assignments. */
function leadingTool(fragment: string): string | null {
  const tokens = fragment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    let t = tokens[i];
    if (t.includes('=')) { i++; continue; } // FOO=bar env assignment
    if (t.startsWith('-')) { i++; continue; } // a flag (e.g. `npm-run-all -p`)
    if (WRAPPERS.has(t)) { i++; continue; } // skip wrapper, look at the next token
    // strip a leading path (./node_modules/.bin/eslint → eslint), keep ./gradlew as-is
    if (t.includes('/') && t !== './gradlew') t = t.split('/').pop() || t;
    return t;
  }
  return null;
}

/** Analyse a package.json string for script-tool and duplicate-dependency problems. Pure. */
export function analyzePackageHealth(pkgRaw: string): PackageHealthResult {
  let pkg: {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return { ok: false, issues: [{ kind: 'dup-dep', detail: 'package.json is not valid JSON.' }] };
  }

  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  const declared = new Set([...Object.keys(deps), ...Object.keys(devDeps)]);
  const issues: PackageIssue[] = [];

  // 1. Duplicate declarations.
  for (const name of Object.keys(deps)) {
    if (name in devDeps) issues.push({ kind: 'dup-dep', detail: `"${name}" is in both dependencies and devDependencies — keep it in one.` });
  }

  // 2. Scripts that call a known build tool whose package isn't declared.
  const flagged = new Set<string>();
  for (const [scriptName, cmd] of Object.entries(pkg.scripts ?? {})) {
    for (const fragment of cmd.split(/&&|\|\||[|;]/)) {
      const tool = leadingTool(fragment);
      if (!tool || ALWAYS_OK.has(tool)) continue;
      const required = TOOL_PACKAGE[tool];
      if (!required) continue; // unknown/custom command — stay conservative, don't flag
      if (!declared.has(required) && !flagged.has(`${scriptName}:${required}`)) {
        flagged.add(`${scriptName}:${required}`);
        issues.push({
          kind: 'script-tool-missing',
          detail: `script "${scriptName}" runs \`${tool}\` but "${required}" is not in dependencies — the script will fail with "command not found". Add ${required}.`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/** One-line human summary. Pure. */
export function packageHealthSummary(r: PackageHealthResult): string {
  if (r.ok) return 'package.json health: OK — no duplicate deps, and every script tool is installed.';
  return `package.json health: ${r.issues.length} issue(s):\n` + r.issues.map(i => `  • ${i.detail}`).join('\n');
}
