// AgentV3 — Developer Experience: project hygiene (Section I #22 v1).
//
// Real projects need basic hygiene files or they bite the user later: a .gitignore
// (or node_modules / .env / secrets get committed), a tsconfig.json when the code is
// TypeScript, and a lockfile (or installs aren't reproducible). This PURE,
// deterministic analyser checks the REAL file list for those essentials.
//
// High-precision: only checks JS/TS projects, each rule is a clear yes/no on a file's
// existence, so a well-set-up repo is never nagged.

export type HygieneLevel = 'high' | 'medium' | 'low';

export interface HygieneFinding {
  level: HygieneLevel;
  message: string;
}

export interface HygieneReport {
  /** Whether the project looked like a JS/TS app worth checking. */
  assessed: boolean;
  findings: HygieneFinding[];
}

const base = (p: string): string => p.split('/').pop() || p;

/**
 * Report missing project-hygiene files. PURE & deterministic. `files` is the real
 * file list; `hasPackageJson` is whether a package.json exists.
 */
export function analyzeProjectHygiene(files: string[], hasPackageJson: boolean): HygieneReport {
  const list = Array.isArray(files) ? files : [];
  const names = list.map(base);
  const usesTs = list.some((f) => /\.tsx?$/.test(f));

  // Not a JS/TS project → nothing to assess here.
  if (!hasPackageJson && !usesTs) return { assessed: false, findings: [] };

  const hasGitignore = names.includes('.gitignore');
  const hasTsconfig = names.includes('tsconfig.json');
  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
  const hasLockfile = names.some((n) => lockfiles.includes(n));

  const findings: HygieneFinding[] = [];

  if (!hasGitignore) {
    findings.push({
      level: 'medium',
      message: 'No .gitignore — without it node_modules, build output and .env secrets can get committed. Add one.',
    });
  }
  if (usesTs && !hasTsconfig) {
    findings.push({
      level: 'medium',
      message: 'TypeScript files but no tsconfig.json — add one so the compiler options are explicit and consistent.',
    });
  }
  if (hasPackageJson && !hasLockfile) {
    findings.push({
      level: 'low',
      message: 'No lockfile (package-lock.json / yarn.lock / pnpm-lock.yaml) — installs are not reproducible across machines.',
    });
  }

  return { assessed: true, findings };
}

/** A short, honest project-hygiene block for the `evaluate` output. */
export function projectHygieneSummary(report: HygieneReport): string {
  if (!report.assessed) return 'Project hygiene: — (not a JS/TS project to assess).';
  if (report.findings.length === 0) return 'Project hygiene: ✓ .gitignore, tsconfig and a lockfile are present.';
  const order: Record<HygieneLevel, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...report.findings].sort((a, b) => order[a.level] - order[b.level]);
  const head = `Project hygiene — ${report.findings.length} missing file(s):`;
  return [head, ...sorted.map((f) => `  ⚠ ${f.message}`)].join('\n');
}
