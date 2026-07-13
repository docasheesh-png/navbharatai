// GA-3 / P-PIPE-runtime (roadmap Tier 2) — lockfile consistency: flag a directory that carries lockfiles
// for TWO OR MORE DIFFERENT package managers (e.g. package-lock.json + yarn.lock in the same folder).
// npm, yarn, pnpm and bun each read their OWN lockfile and ignore the others, so the resolved dependency
// tree differs by whichever manager runs — the classic "works on my machine, breaks in CI" split where a
// transitive version silently changes between environments. Deterministic (filename presence only) and
// zero-false-positive: a single lockfile is fine, and per-package lockfiles at DIFFERENT directories in a
// monorepo are legitimate — only ≥2 DISTINCT managers in the SAME directory are ambiguous. ADVISORY (never
// blocks a build — an inconsistent lockfile is a hygiene risk, not a compile failure). Pure; exported for tests.

export interface LockfileIssue {
  kind: 'multiple-lockfiles';
  severity: 'medium';
  detail: string;
}

/** Lockfile basename → the package manager that owns it. npm has two historical names (both npm). */
const LOCKFILE_MANAGER: Record<string, string> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
};

/** Directory part of a workspace-relative path ('' for a root-level file). */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Basename of a workspace-relative path. */
function baseOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * Flag each directory that holds lockfiles for two or more DIFFERENT package managers. One issue per
 * directory, listing the conflicting files + their managers. Deterministic + conservative. Pure.
 */
export function analyzeLockfiles(files: ReadonlyArray<string>): LockfileIssue[] {
  // dir → manager → set of the actual lockfile names seen (so we can name them and count distinct managers).
  const byDir = new Map<string, Map<string, Set<string>>>();
  for (const path of files || []) {
    if (typeof path !== 'string') continue;
    const manager = LOCKFILE_MANAGER[baseOf(path)];
    if (!manager) continue;
    const dir = dirOf(path);
    let managers = byDir.get(dir);
    if (!managers) { managers = new Map(); byDir.set(dir, managers); }
    let names = managers.get(manager);
    if (!names) { names = new Set(); managers.set(manager, names); }
    names.add(baseOf(path));
  }

  const issues: LockfileIssue[] = [];
  for (const [dir, managers] of byDir) {
    if (managers.size < 2) continue; // one manager (even with two npm filenames) is not a conflict
    const parts = [...managers.entries()]
      .map(([mgr, names]) => `${[...names].sort().join(' + ')} (${mgr})`)
      .sort();
    const where = dir ? `'${dir}/'` : 'the project root';
    issues.push({
      kind: 'multiple-lockfiles',
      severity: 'medium',
      detail:
        `${where} has lockfiles for ${managers.size} different package managers: ${parts.join(', ')}. ` +
        `Each manager reads only its own lockfile, so installs resolve differently across environments ` +
        `(dev vs CI). Keep ONE lockfile and delete the others.`,
    });
  }
  return issues;
}

/** A concise, honest lockfile-consistency line for the evaluate report. Pure. */
export function lockfileSummary(issues: LockfileIssue[]): string {
  if (!issues || issues.length === 0) {
    return 'Lockfile check: ✓ No conflicting package-manager lockfiles.';
  }
  const head = `Lockfile check: ${issues.length} directory(ies) with conflicting lockfiles:`;
  return [head, ...issues.map((i) => `  - [${i.severity}] ${i.detail}`)].join('\n');
}
