// GA-12 (roadmap Tier 2) — run the project's OWN ESLint + Prettier as verification engines, not just a
// custom naming check. ESLint catches a whole class of real bugs tsc does NOT (unused vars, exhaustive-deps
// / react-hooks violations, no-undef, promise misuse); Prettier catches unformatted code. Completes the
// verify quartet: run_tests (B4) + typecheck (B6) + lint (this).
//
// PURE: detection reads the file tree + package.json; parsing reads a command's raw output. The
// ToolDispatcher `lint` tool runs each detected linter via the sandbox actuator. Never invents a pass.

export type LintTool = 'eslint' | 'prettier';

export interface LintPlan {
  tool: LintTool;
  command: string;
  reason: string;
}

export interface LintOutcome {
  tool: LintTool;
  command: string;
  exitCode: number;
  ok: boolean;
  /** Error count (blocks); null when unparseable. Warnings are reported but do not fail `ok`. */
  errorCount: number | null;
  warningCount: number | null;
  firstIssues: string[];
  summary: string;
}

function deps(packageJsonRaw: string | undefined): Record<string, string> {
  if (!packageJsonRaw) return {};
  try {
    const pkg = JSON.parse(packageJsonRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

/** Detect which linters the project is set up for. Pure. Returns [] when none are configured. */
export function detectLinters(files: string[], packageJsonRaw?: string): LintPlan[] {
  const has = (re: RegExp) => files.some(f => re.test(f));
  const d = deps(packageJsonRaw);
  const plans: LintPlan[] = [];

  const hasEslintConfig =
    has(/(^|\/)\.eslintrc(\.(c?js|json|ya?ml))?$/) || has(/(^|\/)eslint\.config\.[cm]?js$/) || 'eslint' in d;
  if (hasEslintConfig) {
    // JSON format so the outcome is parseable regardless of the project's console formatter.
    plans.push({ tool: 'eslint', command: 'npx --no-install eslint . -f json', reason: 'ESLint config/dependency detected.' });
  }

  const hasPrettierConfig =
    has(/(^|\/)\.prettierrc(\.(c?js|json|ya?ml|toml))?$/) || has(/(^|\/)prettier\.config\.[cm]?js$/) || 'prettier' in d;
  if (hasPrettierConfig) {
    plans.push({ tool: 'prettier', command: 'npx --no-install prettier --check .', reason: 'Prettier config/dependency detected.' });
  }

  return plans;
}

function parseEslintJson(stdout: string): { errors: number; warnings: number; issues: string[] } | null {
  const start = stdout.indexOf('[');
  if (start < 0) return null;
  let arr: unknown;
  try { arr = JSON.parse(stdout.slice(start)); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  let errors = 0, warnings = 0;
  const issues: string[] = [];
  for (const f of arr as Array<{ filePath?: string; messages?: Array<{ ruleId?: string; severity?: number; message?: string; line?: number }> }>) {
    for (const m of f.messages ?? []) {
      if (m.severity === 2) errors++; else warnings++;
      if (issues.length < 8 && m.severity === 2) {
        const rel = (f.filePath ?? '').split('/').slice(-2).join('/');
        issues.push(`${rel}:${m.line ?? '?'} ${m.ruleId ?? ''} ${m.message ?? ''}`.trim());
      }
    }
  }
  return { errors, warnings, issues };
}

/** Interpret a linter's output into an honest outcome. Pure. Exit code is the fallback for ok. */
export function parseLintOutcome(plan: LintPlan, exitCode: number, stdout: string, stderr: string): LintOutcome {
  if (plan.tool === 'eslint') {
    const parsed = parseEslintJson(stdout);
    if (parsed) {
      const ok = parsed.errors === 0;
      return {
        tool: 'eslint', command: plan.command, exitCode, ok,
        errorCount: parsed.errors, warningCount: parsed.warnings, firstIssues: parsed.issues,
        summary: `eslint: ${ok ? 'OK' : `FAIL (${parsed.errors} error${parsed.errors === 1 ? '' : 's'})`}` +
          (parsed.warnings ? `, ${parsed.warnings} warning${parsed.warnings === 1 ? '' : 's'}` : ''),
      };
    }
    // Unparseable (e.g. eslint not installed / config error) → exit code decides, honestly.
    return {
      tool: 'eslint', command: plan.command, exitCode, ok: exitCode === 0,
      errorCount: null, warningCount: null,
      firstIssues: (stderr || stdout).split('\n').map(s => s.trim()).filter(Boolean).slice(0, 5),
      summary: `eslint: ${exitCode === 0 ? 'OK' : 'FAIL (could not parse output — see errors)'}`,
    };
  }
  // prettier --check: exit 0 = all formatted; non-zero → the "[warn] <file>" lines list what to format.
  const unformatted = `${stdout}\n${stderr}`
    .split('\n')
    .map(l => l.replace(/^\[warn\]\s*/i, '').trim())
    .filter(l => l && !/^Checking formatting|^All matched files|Code style issues/i.test(l));
  const ok = exitCode === 0;
  return {
    tool: 'prettier', command: plan.command, exitCode, ok,
    errorCount: ok ? 0 : unformatted.length || null, warningCount: 0,
    firstIssues: ok ? [] : unformatted.slice(0, 8),
    summary: `prettier: ${ok ? 'OK (all formatted)' : `FAIL (${unformatted.length || 'some'} file(s) need formatting — run prettier --write)`}`,
  };
}
