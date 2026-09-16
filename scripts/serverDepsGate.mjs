#!/usr/bin/env node
// Server production-dependency gate.
//
// 🔴 WHAT THIS CATCHES, AND WHY THE EXISTING BOOT CHECK CANNOT (production outage, 2026-09-16).
//
// Cloud Run failed the startup TCP probe on port 8080 with the container crashing before it ever
// bound a socket. Root cause: `src/server/lib/githubSecrets.ts` (added 2026-09-15, wired statically
// into `server.ts` via `registerMobileShipRoutes`) does a top-level `import _sodium from
// 'libsodium-wrappers'`. That package was listed only in `devDependencies`. The Dockerfile's runtime
// stage runs `npm prune --omit=dev` before shipping the image, so the module was physically absent at
// container boot — `require('libsodium-wrappers')` threw synchronously, before `app.listen()` was
// ever reached, and Cloud Run's probe saw a process that would never open the port.
//
// `scripts/boot-check.sh` — the gate the Dockerfile's own header comment names as "the backstop that
// turns that class of mistake into a red check instead of an outage" — runs against the FULL,
// unpruned `node_modules` (devDependencies included), so it passes cleanly for exactly this class of
// bug. It is not broken; it answers a different question ("does the bundle crash on load") from the
// one that actually matters for a shipped image ("does the bundle crash on load WITH ONLY THE
// DEPENDENCIES THE IMAGE WILL ACTUALLY CONTAIN").
//
// This script answers the second question WITHOUT needing Docker or a real `npm prune` (so it is
// fast, safe to run in a shared install, and needs no network): it bundles server.ts exactly as the
// Dockerfile's build stage does, with `--metafile` so esbuild reports the external imports it
// actually resolved via AST analysis, and checks that every one of them is listed in
// `package.json`'s `dependencies` — the only section that survives `npm prune --omit=dev`.
//
// 🔴 A NAIVE TEXT SCAN OF THE BUNDLE WAS TRIED FIRST AND REJECTED — record why, so nobody re-adds it.
// Regexing the bundled JS for `require("pkg")` matches CODE-GENERATOR TEMPLATE STRINGS as if they
// were real imports: `DesktopExportGenerator.ts` builds a scaffold Electron `main.cjs` for the USER's
// exported app as a backtick string containing the literal text `require('electron')`, and
// `E2BActuator.ts` ships Playwright screenshot scripts to the SANDBOX VM the same way — neither ever
// runs in this process. A text scan flagged both as fatal. esbuild's `--metafile` is built from the
// real parsed AST, so it can only ever report a specifier that was an actual `import`/`require`
// expression — a string literal that merely CONTAINS that text is invisible to it, which is exactly
// what the check needs.
//
// PURE static analysis: no install, no prune, no container, no network. The parsing/checking logic is
// exported so it is unit-testable without invoking esbuild.

import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every Node builtin, with and without the `node:` prefix — neither needs to be in package.json. */
const BUILTIN_NAMES = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

/**
 * Reduce a bare specifier to its npm PACKAGE name — the thing that actually has a `package.json`
 * entry. `@scope/pkg/sub/path` → `@scope/pkg`; `pkg/sub/path` → `pkg`. PURE.
 */
export function packageNameOf(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/');
  return parts[0];
}

/**
 * Import kinds that run UNCONDITIONALLY the moment the referencing module's wrapper executes — a
 * static `import`, or the `require()` esbuild compiles it down to in CJS output. If the package is
 * missing, `require()` throws synchronously and the process is gone before `app.listen()` — this is
 * exactly the libsodium-wrappers failure mode.
 *
 * `dynamic-import` is deliberately EXCLUDED: `await import('pkg')` only runs if and when that specific
 * line of code executes, so a package reachable ONLY via a dynamic import is safe at boot — the vite
 * dev-server import in server.ts is exactly this (`if (NODE_ENV !== 'production') await import('vite')`,
 * guarded so it can never run in the shipped container, which is WHY vite is correctly a devDependency
 * and must not be flagged). Flagging it anyway would make the gate loud AND wrong, which is worse than
 * not having it: a check that cries about a safe pattern trains people to stop reading its output.
 */
const BOOT_FATAL_KINDS = new Set(['require-call', 'import-statement']);

/**
 * Pull the REAL, BOOT-FATAL external package names out of an esbuild metafile for one output file.
 * PURE — takes the already-parsed metafile JSON and the output's own key, returns a sorted, deduped
 * list of packages reached through at least one boot-fatal import kind (see BOOT_FATAL_KINDS).
 *
 * Only entries with `external: true` are external packages (`--packages=external` is what makes them
 * appear this way instead of being inlined); a relative/absolute path import is never external, so it
 * is excluded even if present. A package imported BOTH dynamically in one place and eagerly in another
 * is still flagged — one eager reference is enough to crash the boot, whatever else also imports it.
 */
export function externalPackagesFromMetafile(metafile, outputKey) {
  const output = metafile.outputs?.[outputKey];
  const imports = output?.imports ?? [];
  const names = new Set();
  for (const imp of imports) {
    if (!imp.external) continue;
    if (!BOOT_FATAL_KINDS.has(imp.kind)) continue;
    names.add(packageNameOf(imp.path));
  }
  return [...names].sort();
}

/**
 * The gate's verdict. PURE — takes the real external package names esbuild resolved and package.json's
 * parsed dependency maps, returns which are missing from `dependencies` and why (absent entirely vs.
 * dev-only).
 */
export function findMissingProductionDeps(externalPackageNames, dependencies, devDependencies) {
  const deps = new Set(Object.keys(dependencies ?? {}));
  const devDeps = new Set(Object.keys(devDependencies ?? {}));
  const missing = [];
  for (const pkg of externalPackageNames) {
    if (BUILTIN_NAMES.has(pkg)) continue;
    if (deps.has(pkg)) continue;
    missing.push({ package: pkg, reason: devDeps.has(pkg) ? 'dev-only' : 'absent' });
  }
  return missing;
}

function main() {
  const pkgJsonPath = join(REPO_ROOT, 'package.json');
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  const tmpDir = mkdtempSync(join(tmpdir(), 'server-deps-gate-'));
  const bundlePath = join(tmpDir, 'server.gate.cjs');
  const metaPath = join(tmpDir, 'server.gate.meta.json');
  try {
    console.log('[serverDepsGate] bundling server.ts (matching the Dockerfile build stage exactly)...');
    execFileSync(
      'npx',
      [
        'esbuild', 'server.ts', '--bundle', '--platform=node', '--format=cjs', '--packages=external',
        `--outfile=${bundlePath}`, `--metafile=${metaPath}`,
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
    );

    const metafile = JSON.parse(readFileSync(metaPath, 'utf8'));
    // esbuild's metafile keys `outputs` by the output path RELATIVE TO ITS OWN CWD, which can differ
    // in exact spelling from `bundlePath` depending on how many `../` segments the relative path
    // needs — so match by the key that actually ends in our chosen filename, not by exact equality.
    const outputKey = Object.keys(metafile.outputs ?? {}).find((k) => k.endsWith('server.gate.cjs'));
    if (!outputKey) {
      throw new Error('esbuild metafile did not contain the expected output — cannot verify dependencies.');
    }

    const externalPackages = externalPackagesFromMetafile(metafile, outputKey);
    const missing = findMissingProductionDeps(externalPackages, pkgJson.dependencies, pkgJson.devDependencies);

    if (missing.length === 0) {
      console.log(`[serverDepsGate] PASS — all ${externalPackages.length} external packages the production bundle requires are real "dependencies".`);
      process.exit(0);
    }

    console.error('[serverDepsGate] FAIL — the production image would crash on boot before listening on its port.');
    console.error('');
    console.error('The server bundle requires these packages, but `npm prune --omit=dev` (the Dockerfile\'s');
    console.error('runtime stage) removes anything not listed in "dependencies":');
    console.error('');
    for (const { package: pkg, reason } of missing) {
      const where = reason === 'dev-only' ? 'listed only in "devDependencies"' : 'not listed in package.json at all';
      console.error(`  - ${pkg}  (${where})`);
    }
    console.error('');
    console.error('Fix: move each package above into "dependencies" in package.json (and run');
    console.error('`npm install --package-lock-only` to update the lockfile), or remove the runtime import');
    console.error('if the package was never meant to run in production.');
    process.exit(1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
