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

export interface PackageManagerInfo {
  manager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  /** The root lockfile that identified it. */
  lockfile: string;
  /** The install + run commands for this manager (npm is the platform default assumption). */
  installCmd: string;
  runCmd: string;
}

const MANAGER_COMMANDS: Record<PackageManagerInfo['manager'], { install: string; run: string }> = {
  npm: { install: 'npm install', run: 'npm run' },
  yarn: { install: 'yarn install', run: 'yarn' },
  pnpm: { install: 'pnpm install', run: 'pnpm run' },
  bun: { install: 'bun install', run: 'bun run' },
};

/**
 * GA-3 (remaining) / P-PIPE-runtime — detect the project's package manager from its ROOT lockfile so the
 * agent uses the RIGHT install/run commands instead of assuming npm (the roadmap's "npm is hard-coded"
 * gap). Only the project root is considered (a nested package's lockfile doesn't define the whole build),
 * and only when a SINGLE manager is present there — an ambiguous root (multiple managers) returns null and
 * is left to `analyzeLockfiles` to flag as a conflict rather than guessed. Pure. Exported for tests.
 */
export function detectPackageManager(files: ReadonlyArray<string>): PackageManagerInfo | null {
  const rootManagers = new Map<string, string>(); // manager → the lockfile name that identified it
  for (const path of files || []) {
    if (typeof path !== 'string' || dirOf(path) !== '') continue; // root-level lockfiles only
    const base = baseOf(path);
    const manager = LOCKFILE_MANAGER[base];
    if (manager && !rootManagers.has(manager)) rootManagers.set(manager, base);
  }
  if (rootManagers.size !== 1) return null; // none, or ambiguous (conflict handled by analyzeLockfiles)
  const [[manager, lockfile]] = [...rootManagers.entries()] as Array<[PackageManagerInfo['manager'], string]>;
  const cmds = MANAGER_COMMANDS[manager];
  return { manager, lockfile, installCmd: cmds.install, runCmd: cmds.run };
}

/**
 * Advisory line naming the detected package manager + its commands — surfaced ONLY when it is NOT npm
 * (npm is the platform default, so there is nothing to correct). Empty string otherwise. Pure.
 */
export function packageManagerSummary(info: PackageManagerInfo | null): string {
  if (!info || info.manager === 'npm') return '';
  return (
    `Package manager: this project uses ${info.manager} (${info.lockfile}) — install with ` +
    `\`${info.installCmd}\` and run scripts with \`${info.runCmd}\`, NOT npm (its lockfile is authoritative).`
  );
}

/** A concise, honest lockfile-consistency line for the evaluate report. Pure. */
export function lockfileSummary(issues: LockfileIssue[]): string {
  if (!issues || issues.length === 0) {
    return 'Lockfile check: ✓ No conflicting package-manager lockfiles.';
  }
  const head = `Lockfile check: ${issues.length} directory(ies) with conflicting lockfiles:`;
  return [head, ...issues.map((i) => `  - [${i.severity}] ${i.detail}`)].join('\n');
}
