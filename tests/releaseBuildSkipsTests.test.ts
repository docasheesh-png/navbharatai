/**
 * A BROKEN TEST MUST NOT BE ABLE TO STOP A RELEASE.
 *
 * ADMIN REPORT 2026-08-11 (a real user's APK build, repo "ball"):
 *
 *   build-apk: src/components/Login.test.tsx#L2
 *   Module '"./Login"' has no exported member …
 *   Process completed with exit code 2.
 *
 * The APK workflow's "Build the web app" step runs `npm run build`, which was `tsc && vite build`, and
 * the generated tsconfig includes ALL of `src` — tests included. So one wrong import inside a TEST
 * file typechecked as part of the RELEASE and no APK was ever produced.
 *
 * That is the wrong shape, independent of whose fault the bad import was: tests are checked by the
 * test runner, and a release build should typecheck what actually SHIPS. tsconfig.json is deliberately
 * left alone so tests keep their editor and vitest typechecking — they simply cannot block a release.
 */

import { describe, it, expect } from 'vitest';
import { tsconfig, tsconfigBuild, packageJson } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';
import { goldenBaseFiles } from '../src/server/AgentV3/goldenScaffolds/base';

const TEST_GLOBS = ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'];

describe('🔒 the release build typechecks only what ships', () => {
  it('the build script points at the release config, not the full one', () => {
    const pkg = JSON.parse(packageJson);
    expect(pkg.scripts.build).toBe('tsc -p tsconfig.build.json && vite build');
    // The exact string that caused the reported failure.
    expect(pkg.scripts.build).not.toBe('tsc && vite build');
  });

  it('🔒 the release config excludes every test-file shape', () => {
    const cfg = JSON.parse(tsconfigBuild);
    for (const glob of TEST_GLOBS) expect(cfg.exclude, glob).toContain(glob);
    expect(cfg.exclude).toContain('**/__tests__/**');
  });

  it('it EXTENDS the real config rather than restating the rules', () => {
    // A second copy of the compiler options would drift, and then the release would be typechecked
    // under different rules than the editor — a worse bug than the one being fixed.
    const cfg = JSON.parse(tsconfigBuild);
    expect(cfg.extends).toBe('./tsconfig.json');
    expect(cfg.compilerOptions).toBeUndefined();
  });

  it('🔒 tsconfig.json itself still covers tests, so they are still typechecked', () => {
    // The lazy fix is to exclude tests from tsconfig.json. That would silence real type errors in
    // tests everywhere — editor, vitest, CI — which is not a fix, it is looking away.
    const cfg = JSON.parse(tsconfig);
    expect(cfg.include).toContain('src');
    expect(cfg.exclude).toBeUndefined();
  });

  it('the scaffold actually ships the file the build script names', () => {
    // A build script pointing at a tsconfig that does not exist fails with "File not found" — the same
    // dead build, with a more confusing message.
    const files = goldenBaseFiles('Demo', 'export default function App(){ return null; }');
    expect(Object.keys(files)).toContain('tsconfig.build.json');
    expect(() => JSON.parse(files['tsconfig.build.json'])).not.toThrow();
    expect(JSON.parse(files['tsconfig.build.json']).extends).toBe('./tsconfig.json');
  });

  it('the app-repair scaffold writes it too, beside tsconfig.json', () => {
    // FrameworkFoundation backfills missing scaffold files into an existing app; if it wrote
    // tsconfig.json without this sibling, a repaired app would get the broken combination back.
    const src = require('fs').readFileSync('src/server/AgentV3/FrameworkFoundation.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("add('tsconfig.build.json', TSCONFIG_BUILD_JSON, 'tsconfig.build.json')");
    expect(code).toContain("add('tsconfig.json', TSCONFIG_JSON, 'tsconfig.json')");
  });
});

describe('the reported failure, as a scenario', () => {
  it('🔒 a Login.test.tsx with a bad import is outside the release typecheck', () => {
    // The literal file from the report. Under tsconfig.build.json it is excluded, so `tsc -p` never
    // reads it and the APK gets built; under the old `tsc` it was compiled and exit code 2 followed.
    const excluded = JSON.parse(tsconfigBuild).exclude as string[];
    // `**/` is swapped for a placeholder BEFORE single `*` is expanded — otherwise the `.*` just
    // written for `**/` gets mangled by the next replacement, which is what this helper did at first.
    const matches = (glob: string, path: string) => {
      const DIRS = '\u0000';
      const re = new RegExp('^' + glob
        .replace(/\./g, '\\.')
        .replace(/\*\*\//g, DIRS)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(DIRS, 'g'), '(?:[^/]+/)*') + '$');
      return re.test(path);
    };
    expect(excluded.some((g) => matches(g, 'src/components/Login.test.tsx'))).toBe(true);
    // …while the component it tests is still very much typechecked.
    expect(excluded.some((g) => matches(g, 'src/components/Login.tsx'))).toBe(false);
  });
});
