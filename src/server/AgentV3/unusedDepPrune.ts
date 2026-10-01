// A PACKAGE THIS BUILD INSTALLED AND NEVER USED IS TAKEN OUT AGAIN (admin 2026-10-01, after autopsy a106df77).
//
// 🔴 WHAT HAPPENED. The bill maker's rebuild installed `recharts` and never imported it. The report said so
// (`INTEGRITY_UNUSED_DEP`) and stopped there: the package shipped in the user's `package.json`, was installed
// on every later build and phone build, appeared in every dependency audit, and was the first thing a
// developer opening the exported repository would read as "the AI left junk behind".
//
// 🔑 THE RULE (the admin approved it with the condition that matters): remove ONLY a package that THIS build
// added, that nothing in the project refers to, and whose removal the app's own production build survives.
// A package the user had before the build is never touched, whatever it looks like.
//
// Why each condition exists:
//   • added by this build: `before` is the package.json as it stood when the builder started. With no
//     readable baseline nothing is removed — never guessed.
//   • unused: `findUnusedDependencies` (no import anywhere, not a script's command, not framework-provided),
//     plus the name appearing in no other file at all. A config file, a CSS `@import`, an HTML tag or a
//     string-load all name the package, and any such mention keeps it.
//   • not tooling: a plugin, a CLI or a compiler is used without being imported.
//   • the build survives: the route uninstalls, runs the app's own build, and puts everything back if the
//     build fails. A package another installed package needs (a peer) is kept before that, so the check is
//     not the only line of defence.
//
// Kill switch: AGENTV3_PRUNE_UNUSED_DEPS=off (the warning stays, nothing is removed). PURE apart from the env read.

export function pruneUnusedDepsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_PRUNE_UNUSED_DEPS ?? '').trim().toLowerCase() !== 'off';
}

/** At most this many packages are removed in one build — a bigger list is a sign the analysis is wrong. */
export const MAX_PRUNE = 5;

/** Packages that are used without being imported: plugins, CLIs, compilers, polyfills, type packages. */
const TOOLING = /^(?:@types\/|@vitejs\/|@babel\/|@tailwindcss\/|@eslint\/|@typescript-eslint\/|@capacitor\/)|(?:^|[-/])(?:plugin|preset|loader|cli|eslint|prettier|typescript|babel|postcss|autoprefixer|tailwindcss|vite|webpack|rollup|esbuild|nodemon|ts-node|tsx|concurrently|cross-env|dotenv|polyfill|core-js|regenerator-runtime)(?:$|[-/])/i;

function readDeps(raw: string | null | undefined): { deps: Record<string, string>; all: Set<string> } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const pkg = JSON.parse(raw);
    if (!pkg || typeof pkg !== 'object') return null;
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? (pkg.dependencies as Record<string, string>) : {};
    const all = new Set<string>(Object.keys(deps));
    for (const sec of ['devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const d = pkg[sec];
      if (d && typeof d === 'object') for (const k of Object.keys(d)) all.add(k);
    }
    return { deps, all };
  } catch {
    return null;
  }
}

/** The runtime dependencies `after` declares that `before` did not declare anywhere. [] without a baseline. PURE. */
export function depsAddedByBuild(before: string | null | undefined, after: string | null | undefined): string[] {
  const b = readDeps(before);
  const a = readDeps(after);
  if (!b || !a) return [];
  return Object.keys(a.deps).filter((name) => !b.all.has(name));
}

/** Does any project file other than the manifests name the package? PURE. */
function mentionedOutsideManifests(name: string, files: Readonly<Record<string, string>>): boolean {
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    if (/(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(path)) continue;
    if (content.includes(name)) return true;
  }
  return false;
}

export interface PruneInput {
  /** package.json when the builder started. */
  before: string | null | undefined;
  /** package.json now. */
  after: string | null | undefined;
  /** Names `findUnusedDependencies` reported for the project now. */
  unused: readonly string[];
  /** Every project file now, path → content. */
  files: Readonly<Record<string, string>>;
}

/** The packages that may be removed: added by this build, unused, unnamed anywhere else, not tooling. PURE. */
export function pruneCandidates(input: PruneInput): string[] {
  const added = new Set(depsAddedByBuild(input.before, input.after));
  const out: string[] = [];
  for (const name of input.unused ?? []) {
    if (!added.has(name)) continue;
    if (TOOLING.test(name)) continue;
    if (mentionedOutsideManifests(name, input.files ?? {})) continue;
    if (!out.includes(name)) out.push(name);
    if (out.length >= MAX_PRUNE) break;
  }
  return out;
}

/** A package name safe to put on a shell line (npm's own rules, no shell metacharacters). PURE. */
export function isSafePackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) && name.length <= 214;
}

/**
 * A node script run in the sandbox: which candidates does another DECLARED package depend on or list as a
 * peer? Prints one name per line. Reads only node_modules/<declared>/package.json. PURE (returns text).
 */
export function peerCheckScript(candidates: readonly string[]): string {
  const names = JSON.stringify(candidates.filter(isSafePackageName));
  return `node -e '
const fs=require("fs");const c=new Set(${names.replace(/'/g, '')});
let pkg;try{pkg=JSON.parse(fs.readFileSync("package.json","utf8"))}catch(e){process.exit(0)}
const declared=Object.keys(Object.assign({},pkg.dependencies||{},pkg.devDependencies||{}));
const needed=new Set();
for(const d of declared){if(c.has(d))continue;let m;try{m=JSON.parse(fs.readFileSync("node_modules/"+d+"/package.json","utf8"))}catch(e){continue}
for(const k of Object.keys(Object.assign({},m.dependencies||{},m.peerDependencies||{})))if(c.has(k))needed.add(k)}
for(const n of needed)console.log("NBAI_NEEDED "+n)'`;
}

/** The names `peerCheckScript` printed. PURE. */
export function parseNeeded(stdout: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const line of String(stdout ?? '').split('\n')) {
    const m = /^NBAI_NEEDED (\S+)\s*$/.exec(line.trim());
    if (m) out.add(m[1]);
  }
  return out;
}

/** What the user is told when packages were removed (no vendor names involved — these are their packages). */
export function prunedNarration(removed: readonly string[]): string {
  return `🧹 Removed ${removed.length} package${removed.length === 1 ? '' : 's'} this build installed but your app never uses (${removed.join(', ')}). Your app still builds.`;
}

export interface PruneRun {
  /** Runs a shell command in the app's sandbox, in its project directory. */
  run: (command: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Reads a project file from the sandbox (null when absent). */
  read: (path: string) => Promise<string | null>;
}

export type PruneOutcome =
  | { status: 'removed'; removed: string[]; keptForPeers: string[]; packageJson: string; lock: string | null }
  | { status: 'skipped'; reason: string; keptForPeers: string[] }
  | { status: 'reverted'; reason: string; tried: string[]; keptForPeers: string[] };

const BACKUP_PKG = '/tmp/nbai-prune-package.json';
const BACKUP_LOCK = '/tmp/nbai-prune-package-lock.json';

/** Does the package.json declare a build script we can verify the removal with? PURE. */
export function hasBuildScript(pkgRaw: string | null | undefined): boolean {
  try {
    const pkg = JSON.parse(String(pkgRaw ?? ''));
    return typeof pkg?.scripts?.build === 'string' && pkg.scripts.build.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Removes the candidates, proves the app's own production build still passes, and puts everything back if it
 * does not. A candidate another installed package needs is kept first. Never throws: a failure anywhere is
 * `reverted` or `skipped`, with the project as it was.
 */
export async function pruneBuildAddedDeps(candidates: readonly string[], packageJsonNow: string, io: PruneRun): Promise<PruneOutcome> {
  const safe = candidates.filter(isSafePackageName);
  if (safe.length === 0) return { status: 'skipped', reason: 'no candidates', keptForPeers: [] };
  if (!hasBuildScript(packageJsonNow)) return { status: 'skipped', reason: 'no build script to verify the removal with', keptForPeers: [] };
  let keptForPeers: string[] = [];
  try {
    const needed = parseNeeded((await io.run(peerCheckScript(safe))).stdout);
    keptForPeers = safe.filter((n) => needed.has(n));
  } catch {
    return { status: 'skipped', reason: 'could not check which packages other packages need', keptForPeers: [] };
  }
  const remove = safe.filter((n) => !keptForPeers.includes(n));
  if (remove.length === 0) return { status: 'skipped', reason: 'every candidate is needed by another package', keptForPeers };

  try {
    const backup = await io.run(`cp package.json ${BACKUP_PKG} && rm -f ${BACKUP_LOCK} && (test ! -f package-lock.json || cp package-lock.json ${BACKUP_LOCK})`);
    if (backup.exitCode !== 0) return { status: 'skipped', reason: 'could not back up package.json', keptForPeers };
  } catch {
    return { status: 'skipped', reason: 'could not back up package.json', keptForPeers };
  }
  const restore = async (): Promise<void> => {
    try {
      await io.run(`cp ${BACKUP_PKG} package.json && (test ! -f ${BACKUP_LOCK} || cp ${BACKUP_LOCK} package-lock.json) && timeout 180 npm install --no-audit --no-fund`);
    } catch { /* the backup files stay in /tmp; nothing else to do here */ }
  };
  try {
    const un = await io.run(`timeout 120 npm uninstall --no-audit --no-fund ${remove.join(' ')}`);
    if (un.exitCode !== 0) { await restore(); return { status: 'reverted', reason: 'npm uninstall failed', tried: remove, keptForPeers }; }
    const build = await io.run('timeout 240 npm run build');
    if (build.exitCode !== 0) { await restore(); return { status: 'reverted', reason: 'the app did not build without them', tried: remove, keptForPeers }; }
    const packageJson = await io.read('package.json');
    if (!packageJson) { await restore(); return { status: 'reverted', reason: 'package.json could not be read back', tried: remove, keptForPeers }; }
    const lock = await io.read('package-lock.json');
    return { status: 'removed', removed: remove, keptForPeers, packageJson, lock };
  } catch {
    await restore();
    return { status: 'reverted', reason: 'the removal could not be completed', tried: remove, keptForPeers };
  }
}
