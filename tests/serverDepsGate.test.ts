// The gate for the 2026-09-16 production outage: Cloud Run's TCP probe on port 8080 failed
// consecutively and the container never started. Root cause: `src/server/lib/githubSecrets.ts`
// (added 2026-09-15, wired statically into server.ts via `registerMobileShipRoutes`) does a
// top-level `import _sodium from 'libsodium-wrappers'`, and that package was listed only in
// `devDependencies`. The Dockerfile's runtime stage runs `npm prune --omit=dev` before shipping the
// image, so `require('libsodium-wrappers')` threw synchronously before `app.listen()` ever ran.
//
// `scripts/boot-check.sh` — the CI gate the Dockerfile's own header comment already names as the
// backstop for exactly this class of bug — runs against the FULL, unpruned node_modules, so it
// passed cleanly. It answers "does the bundle crash on load", not "does the bundle crash on load
// WITH ONLY THE DEPENDENCIES THE SHIPPED IMAGE WILL ACTUALLY CONTAIN" — this gate answers the
// second question, and these are its pure decision functions, tested without invoking esbuild.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  packageNameOf,
  externalPackagesFromMetafile,
  findMissingProductionDeps,
} from '../scripts/serverDepsGate.mjs';

const readRepoFile = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('packageNameOf — reducing a specifier to its package.json key', () => {
  it('an ordinary package name is itself', () => {
    expect(packageNameOf('libsodium-wrappers')).toBe('libsodium-wrappers');
  });

  it('a deep import reduces to the package root', () => {
    expect(packageNameOf('semver/functions/gt')).toBe('semver');
  });

  it('a scoped package keeps its scope', () => {
    expect(packageNameOf('@google-cloud/firestore')).toBe('@google-cloud/firestore');
  });

  it('a scoped deep import reduces to `@scope/pkg`, not just the scope', () => {
    expect(packageNameOf('@aws-sdk/client-bedrock-runtime/models')).toBe('@aws-sdk/client-bedrock-runtime');
  });
});

describe('externalPackagesFromMetafile — the AST-accurate half (why a text scan was rejected)', () => {
  // 🔴 THIS SHAPE IS WHY A REGEX OVER THE BUNDLE TEXT WAS TRIED FIRST AND DISCARDED. A naive scan for
  // `require("pkg")` in the bundled JS matched CODE-GENERATOR TEMPLATE STRINGS as if they were real
  // imports: `DesktopExportGenerator.ts` builds a scaffold Electron `main.cjs` for the USER'S exported
  // app as a backtick string containing the literal text `require('electron')`, and `E2BActuator.ts`
  // ships Playwright screenshot scripts to the SANDBOX VM the same way — neither ever runs in this
  // process, and esbuild's own parser never treats either as an import (they are just string
  // contents), so neither appears in a real metafile at all. These cases assert that this function,
  // built on the metafile rather than the bundle text, cannot repeat that mistake.
  const metafile = (imports: Array<{ path: string; kind: string; external: boolean }>) => ({
    outputs: { 'dist/server.cjs': { imports } },
  });

  it('a real, eager import is reported', () => {
    const mf = metafile([{ path: 'libsodium-wrappers', kind: 'require-call', external: true }]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual(['libsodium-wrappers']);
  });

  it('🔴 a package reachable ONLY via dynamic import() is NOT reported — this is the vite case', () => {
    // server.ts's own vite import: `if (NODE_ENV !== 'production') { await import('vite'); }`. It is
    // external and genuinely present in a real bundle, but it can only ever execute if that branch
    // is taken — which it never is in the shipped container. Flagging it would be loud AND wrong.
    const mf = metafile([{ path: 'vite', kind: 'dynamic-import', external: true }]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual([]);
  });

  it('a package with BOTH an eager and a dynamic reference is still reported — one eager path is enough', () => {
    const mf = metafile([
      { path: 'google-auth-library', kind: 'dynamic-import', external: true },
      { path: 'google-auth-library', kind: 'require-call', external: true },
    ]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual(['google-auth-library']);
  });

  it('a non-external (bundled-in) import is never reported, whatever its kind', () => {
    const mf = metafile([{ path: 'libsodium-wrappers', kind: 'require-call', external: false }]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual([]);
  });

  it('a deep import from the same package is deduped against a root import', () => {
    const mf = metafile([
      { path: 'semver', kind: 'require-call', external: true },
      { path: 'semver/functions/gt', kind: 'require-call', external: true },
    ]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual(['semver']);
  });

  it('the result is sorted, for a stable, diffable report', () => {
    const mf = metafile([
      { path: 'ws', kind: 'require-call', external: true },
      { path: '@google-cloud/firestore', kind: 'require-call', external: true },
      { path: 'axios', kind: 'require-call', external: true },
    ]);
    expect(externalPackagesFromMetafile(mf, 'dist/server.cjs')).toEqual(['@google-cloud/firestore', 'axios', 'ws']);
  });

  it('an unknown output key returns nothing rather than throwing', () => {
    const mf = metafile([{ path: 'ws', kind: 'require-call', external: true }]);
    expect(externalPackagesFromMetafile(mf, 'some/other/path.cjs')).toEqual([]);
  });
});

describe('findMissingProductionDeps — the verdict, and why each case matters', () => {
  it('a package in "dependencies" is never flagged', () => {
    expect(findMissingProductionDeps(['axios'], { axios: '^1.0.0' }, {})).toEqual([]);
  });

  it('🔴 the exact regression: a package ONLY in "devDependencies" is flagged as dev-only', () => {
    const missing = findMissingProductionDeps(
      ['libsodium-wrappers'],
      {},
      { 'libsodium-wrappers': '^0.8.4' },
    );
    expect(missing).toEqual([{ package: 'libsodium-wrappers', reason: 'dev-only' }]);
  });

  it('a package in NEITHER list is flagged as absent — distinct from dev-only, both fatal', () => {
    const missing = findMissingProductionDeps(['left-pad'], {}, {});
    expect(missing).toEqual([{ package: 'left-pad', reason: 'absent' }]);
  });

  it('a Node builtin is never flagged, with or without the `node:` prefix', () => {
    expect(findMissingProductionDeps(['fs', 'node:path', 'crypto'], {}, {})).toEqual([]);
  });

  it('several real gaps are all reported, not just the first', () => {
    const missing = findMissingProductionDeps(
      ['libsodium-wrappers', 'semver', 'ws', 'axios'],
      { axios: '^1.0.0' },
      { semver: '^7.0.0' },
    );
    expect(missing.map((m) => m.package).sort()).toEqual(['libsodium-wrappers', 'semver', 'ws']);
  });
});

describe('🔒 proven by reversion — a script this session already verified crashes without it', () => {
  it('the gate script itself checks for boot-fatal kinds, not every external import', () => {
    const src = readRepoFile('scripts/serverDepsGate.mjs');
    expect(src).toContain("BOOT_FATAL_KINDS = new Set(['require-call', 'import-statement'])");
    expect(src).toContain('if (!BOOT_FATAL_KINDS.has(imp.kind)) continue;');
  });

  it('is wired into CI, not left as a script nobody runs', () => {
    const ci = readRepoFile('.github/workflows/ci.yml');
    expect(ci).toContain('npm run deps:server-gate');
  });

  it('has an npm script entry matching its CI invocation', () => {
    const pkg = JSON.parse(readRepoFile('package.json'));
    expect(pkg.scripts['deps:server-gate']).toBe('node scripts/serverDepsGate.mjs');
  });

  it('libsodium-wrappers, google-auth-library, semver and ws are all real dependencies now', () => {
    const pkg = JSON.parse(readRepoFile('package.json'));
    for (const name of ['libsodium-wrappers', 'google-auth-library', 'semver', 'ws']) {
      expect(pkg.dependencies, name).toHaveProperty(name);
      expect(pkg.devDependencies, name).not.toHaveProperty(name);
    }
  });
});
