/**
 * A TEST FILE'S ERROR IS NOT A PRODUCTION-BUILD FAILURE WHEN THE RELEASE LEAVES TESTS OUT (Q-3462, failedbr #2525).
 *
 * The write-time typecheck told the builder that src/game/controls.test.ts:6 "fail[s] the production build". The
 * build script is `tsc -p tsconfig.build.json && vite build`, and that config excludes test files — it did not. The
 * note now reads the project's own package.json and build config, and says a test file's error as what it is.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { releaseSkipsTests, writeTypecheckNote, TEST_SOURCE_FILE } from '../src/server/AgentV3/writeTimeTypecheck';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';

const PKG = (build: string) => JSON.stringify({ scripts: { build } });
const BUILD_CFG = '{ "extends": "./tsconfig.json", "exclude": ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**"] }';
const TEST_ERR = parseTscErrors("src/game/controls.test.ts(6,10): error TS2307: Cannot find module 'vitest' or its corresponding type declarations.");
const APP_ERR = parseTscErrors("src/game/fps.ts(12,3): error TS2339: Property 'scene' does not exist on type 'OpenWorld'.");

describe('the release config is read, never assumed', () => {
  it('tsc -p a config that excludes tests → skips them; plain tsc → compiles them; vite only → skips; unreadable → unknown', () => {
    expect(releaseSkipsTests(PKG('tsc -p tsconfig.build.json && vite build'), BUILD_CFG)).toBe(true);
    expect(releaseSkipsTests(PKG('tsc -p tsconfig.build.json && vite build'), '{ "extends": "./tsconfig.json" }')).toBe(false);
    expect(releaseSkipsTests(PKG('tsc && vite build'), null)).toBe(false);
    expect(releaseSkipsTests(PKG('vite build'), null)).toBe(true);
    expect(releaseSkipsTests(PKG('tsc -p tsconfig.build.json && vite build'), null)).toBeNull();
    expect(releaseSkipsTests(null, null)).toBeNull();
  });
  it('test and mock files are told apart from shipped files', () => {
    for (const f of ['src/game/controls.test.ts', 'src/a.spec.tsx', 'src/__tests__/x.ts', 'src/__mocks__/y.ts']) expect(TEST_SOURCE_FILE.test(f), f).toBe(true);
    for (const f of ['src/game/fps.ts', 'src/testimonials.tsx', 'src/latest.ts']) expect(TEST_SOURCE_FILE.test(f), f).toBe(false);
  });
});

describe('the note — failedbr #2525 replayed', () => {
  it('a test file error, with the release skipping tests: said as stopping the tests, never as failing the production build', () => {
    const note = writeTypecheckNote(TEST_ERR, ['src/game/fps.ts'], {}, undefined, { skipsTests: true });
    expect(note).toMatch(/🧪 1 error\(s\) in test file\(s\) \(src\/game\/controls\.test\.ts:6 TS2307\)/);
    expect(note).toMatch(/do NOT fail the production build/);
    expect(note).not.toMatch(/⛔|ℹ️ TYPECHECK|production build fails/);
  });
  it('a shipped file error beside it still fails the production build, and is still quoted', () => {
    const note = writeTypecheckNote([...APP_ERR, ...TEST_ERR], ['src/game/fps.ts'], {}, undefined, { skipsTests: true });
    expect(note).toMatch(/production build fails until they are gone/);
    expect(note).toMatch(/fps\.ts\(12,3\)/);
    expect(note).toMatch(/🧪 1 error\(s\) in test file/);
  });
  it('when the release compiles tests, or it cannot be told, the test error is reported as before', () => {
    for (const skipsTests of [false, null]) expect(writeTypecheckNote(TEST_ERR, ['src/game/fps.ts'], {}, undefined, { skipsTests })).toMatch(/fail the production build/);
  });
  it('the write door reads the project\'s release config for it', () => {
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8')).toMatch(/writeTypecheckNote\(errors, tsPaths, sources, undefined, release\)/);
  });
});
