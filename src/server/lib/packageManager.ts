// Single source of truth for JavaScript package-manager detection and the commands to invoke it.
//
// This logic was previously duplicated and had DRIFTED: PreviewRunner/WorkspaceLauncher and
// QualityEvaluationEngine/BuildEvaluator each carried their own fs-based copy (npm/pnpm/yarn, no bun,
// no packageManager field), while the AgentV3 verify tools (testRunner) HARDCODED `npm` — so a
// pnpm/yarn/bun project's tests and scripts ran under the wrong manager. Centralized here as one pure,
// dependency-free, unit-tested module (CLAUDE.md rule 2: fix the class, not the instance).

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** Corepack's `packageManager` field is an explicit, authoritative pin (e.g. "pnpm@9.1.0"). */
const FIELD_MATCHERS: Array<[RegExp, PackageManager]> = [
  [/^pnpm@/, 'pnpm'],
  [/^yarn@/, 'yarn'],
  [/^bun@/, 'bun'],
  [/^npm@/, 'npm'],
];

/**
 * Decide the package manager from the set of present file basenames plus an optional package.json.
 * Pure. Precedence: the explicit `packageManager` field wins; otherwise the lockfile (bun → pnpm →
 * yarn → npm), matching the ecosystem's own resolution order. Defaults to npm when nothing is declared.
 */
export function detectPackageManager(files: string[], packageJsonRaw?: string): PackageManager {
  if (packageJsonRaw) {
    try {
      const field = (JSON.parse(packageJsonRaw) as { packageManager?: unknown }).packageManager;
      if (typeof field === 'string') {
        for (const [re, pm] of FIELD_MATCHERS) if (re.test(field.trim())) return pm;
      }
    } catch { /* malformed package.json — fall through to lockfile detection */ }
  }
  const has = (name: string) => files.some((f) => f === name || f.endsWith('/' + name));
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  return 'npm'; // package-lock.json, npm-shrinkwrap.json, or nothing declared
}

/** Command to run a package.json script, e.g. pmRun('pnpm','test') → "pnpm run test" (yarn omits "run"). */
export function pmRun(pm: PackageManager, script: string): string {
  return pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`;
}

/** Prefix to execute a locally-installed binary, e.g. `${pmExec('pnpm')} vitest` → "pnpm exec vitest". */
export function pmExec(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm': return 'pnpm exec';
    case 'yarn': return 'yarn'; // `yarn <bin>` runs a project-local binary
    case 'bun': return 'bunx';
    default: return 'npx';
  }
}

/** Command to install dependencies from the lockfile. */
export function pmInstall(pm: PackageManager): string {
  switch (pm) {
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn install';
    case 'bun': return 'bun install';
    default: return 'npm install';
  }
}
