// D12 (Tier 2F) — monorepo detection + task-runner-aware command routing. The engine treats every
// project as a single root package: on a turborepo / nx / pnpm-workspaces repo it runs a root-level
// install/build/test and never uses `turbo run` / `nx run-many` / `pnpm --filter`, so per-package
// scripts are missed. This deterministically detects the monorepo tool + its workspace packages and
// advises the CORRECT scoped install/build/test invocation.
//
// PURE + dependency-free (filename presence + light JSON/YAML parsing + a tiny glob-to-dir matcher —
// no external glob lib), mirroring lockfileAnalysis.ts / toolchainPins.ts. ADVISORY only (never blocks
// a build). Exported for tests.

export type MonorepoTool =
  | 'turborepo' | 'nx' | 'lerna' | 'rush' | 'pnpm-workspaces' | 'yarn-npm-workspaces' | null;

export interface MonorepoInfo {
  isMonorepo: boolean;
  tool: MonorepoTool;
  /** The workspace globs declared (e.g. ['apps/*', 'packages/*']). */
  workspaceGlobs: string[];
  /** Package directories that actually exist in the repo (a dir with its own package.json). */
  packageDirs: string[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Parse the `packages:` list from a minimal pnpm-workspace.yaml (line-based; no YAML lib). */
function parsePnpmWorkspaceGlobs(yaml: string): string[] {
  const out: string[] = [];
  let inPackages = false;
  for (const raw of String(yaml || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '');
    if (/^\s*packages\s*:/.test(line)) { inPackages = true; continue; }
    if (inPackages) {
      const m = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
      if (m) { out.push(m[1].trim()); continue; }
      if (line.trim() && !/^\s/.test(line)) break; // a new top-level key ends the packages block
    }
  }
  return out;
}

/** Workspace globs from a root package.json `workspaces` field (array or { packages: [] }). */
function parsePackageJsonWorkspaces(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const pkg = JSON.parse(raw);
    const ws = pkg?.workspaces;
    if (Array.isArray(ws)) return ws.filter((g: unknown): g is string => typeof g === 'string');
    if (ws && Array.isArray(ws.packages)) return ws.packages.filter((g: unknown): g is string => typeof g === 'string');
  } catch { /* tolerant */ }
  return [];
}

/** True when a directory path matches a workspace glob (`apps/*`, `packages/**`, or a literal dir). */
function dirMatchesGlob(dir: string, glob: string): boolean {
  const g = glob.replace(/\/+$/, '');
  if (g.endsWith('/**')) return dir === g.slice(0, -3) || dir.startsWith(g.slice(0, -3) + '/');
  if (g.endsWith('/*')) {
    const prefix = g.slice(0, -2);
    return dirOf(dir) === prefix; // exactly one segment under the prefix
  }
  return dir === g; // literal package dir
}

/** Directories (with their own package.json) that match at least one workspace glob. Sorted. */
function resolvePackageDirs(paths: string[], globs: string[]): string[] {
  if (globs.length === 0) return [];
  const pkgDirs = new Set<string>();
  for (const p of paths) {
    if (!/(^|\/)package\.json$/.test(p) || p.includes('node_modules/')) continue;
    const dir = dirOf(p);
    if (dir === '') continue; // the root package
    if (globs.some((g) => dirMatchesGlob(dir, g))) pkgDirs.add(dir);
  }
  return [...pkgDirs].sort();
}

/**
 * Detect the monorepo tool + its workspaces. `paths` is the workspace-relative file list; `contents`
 * maps a path → its content (only the config files need to be present). Pure; never throws.
 * Tool precedence: turbo → nx → rush → lerna → pnpm-workspaces → yarn/npm workspaces.
 */
export function detectMonorepo(paths: string[], contents: Record<string, string>): MonorepoInfo {
  const has = (name: string) => paths.some((p) => p === name || p.endsWith('/' + name));
  const rootPkg = contents['package.json'];
  const pnpmYaml = contents['pnpm-workspace.yaml'] ?? contents['pnpm-workspace.yml'];
  const pkgGlobs = parsePackageJsonWorkspaces(rootPkg);
  const pnpmGlobs = pnpmYaml ? parsePnpmWorkspaceGlobs(pnpmYaml) : [];
  const globs = pnpmGlobs.length ? pnpmGlobs : pkgGlobs;

  let tool: MonorepoTool = null;
  if (has('turbo.json')) tool = 'turborepo';
  else if (has('nx.json')) tool = 'nx';
  else if (has('rush.json')) tool = 'rush';
  else if (has('lerna.json')) tool = 'lerna';
  else if (pnpmGlobs.length) tool = 'pnpm-workspaces';
  else if (pkgGlobs.length) tool = 'yarn-npm-workspaces';

  if (!tool) return { isMonorepo: false, tool: null, workspaceGlobs: [], packageDirs: [] };
  return { isMonorepo: true, tool, workspaceGlobs: globs, packageDirs: resolvePackageDirs(paths, globs) };
}

/** The package-manager exec prefix (npx/pnpm exec/yarn dlx) for a detected manager. */
function pmExec(pm: string): string {
  if (pm === 'pnpm') return 'pnpm exec';
  if (pm === 'yarn') return 'yarn';
  if (pm === 'bun') return 'bunx';
  return 'npx';
}

/**
 * The correct scoped command to run `script` for one package in the monorepo, given the detected
 * tool + package manager. Falls back to `cd <dir> && <pm> run <script>` when no task-runner applies. Pure.
 */
export function routePackageCommand(info: MonorepoInfo, pm: string, packageDir: string, script: string): string {
  if (info.tool === 'turborepo') return `${pmExec(pm)} turbo run ${script} --filter=./${packageDir}`;
  if (info.tool === 'nx') return `${pmExec(pm)} nx run ${packageDir.split('/').pop()}:${script}`;
  if (pm === 'pnpm') return `pnpm --filter ./${packageDir} ${script}`;
  if (pm === 'yarn') return `yarn workspace ${packageDir.split('/').pop()} ${script}`;
  if (pm === 'npm') return `npm run ${script} -w ${packageDir}`;
  return `cd ${packageDir} && ${pm} run ${script}`;
}

const TOOL_LABEL: Record<Exclude<MonorepoTool, null>, string> = {
  turborepo: 'Turborepo', nx: 'Nx', lerna: 'Lerna', rush: 'Rush',
  'pnpm-workspaces': 'pnpm workspaces', 'yarn-npm-workspaces': 'yarn/npm workspaces',
};

/** Advisory `evaluate` line, or '' when the project is not a monorepo. Pure. */
export function monorepoSummary(info: MonorepoInfo, pm = 'npm'): string {
  if (!info || !info.isMonorepo || !info.tool) return '';
  const label = TOOL_LABEL[info.tool];
  const count = info.packageDirs.length;
  const example = info.packageDirs[0] ?? '<package>';
  const build = routePackageCommand(info, pm, example, 'build');
  const parts = [
    `Monorepo — this is a ${label} monorepo${count ? ` with ${count} workspace package(s)` : ''}.`,
    `Install once at the root, then build/test per package with the task runner (e.g. \`${build}\`) — do NOT run a plain root-level build/test that misses the workspace packages.`,
  ];
  return parts.join(' ');
}
