// A TEST FILE'S ERROR IS NOT A RELEASE BLOCKER WHEN THE RELEASE CONFIG LEAVES TESTS OUT (failedbr #2525, Q-3462).
//
// The write-time typecheck told the builder that `src/game/controls.test.ts(6,38)` "fail[s] the production build"; the
// build script is `tsc -p tsconfig.build.json && vite build` and that config excludes test files. The class: every
// "the production build fails" sentence was said of every error. This locks (1) the real #2525 errors, (2) every note
// that makes the claim, (3) the typecheck tool's header, and (4) the test-file globs against the platform's own
// tsconfig.build.json, so the two lists cannot drift.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTscErrors } from '../src/server/AgentV3/EndgameRepair';
import { isTestOnlyFile, releaseBuildExcludesTests, releaseConsequence, writeTypecheckNote } from '../src/server/AgentV3/writeTimeTypecheck';
import { tsconfigBuild } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

// The write-time typecheck output of failedbr #2523 / #2525, verbatim (first two errors).
const BR2525_TSC = `src/game/controls.test.ts(6,38): error TS2307: Cannot find module 'vitest' or its corresponding type declarations.
src/game/play/playerBody.ts(473,71): error TS2345: Argument of type 'HumanoidAction' is not assignable to parameter of type 'PlayerMove'.`;
const PKG = JSON.stringify({ scripts: { build: 'tsc -p tsconfig.build.json && vite build', test: 'vitest run' } });

describe('which files the release build leaves out', () => {
  it('the platform tsconfig.build.json and isTestOnlyFile name the same files', () => {
    const globs: string[] = JSON.parse(tsconfigBuild).exclude;
    const samples: Record<string, string> = {
      '**/*.test.ts': 'src/game/controls.test.ts', '**/*.test.tsx': 'src/App.test.tsx',
      '**/*.spec.ts': 'src/a.spec.ts', '**/*.spec.tsx': 'src/a.spec.tsx',
      '**/__tests__/**': 'src/__tests__/x.ts', '**/__mocks__/**': 'src/__mocks__/x.ts',
    };
    for (const g of globs) {
      expect(samples[g], `a sample for ${g}`).toBeDefined();
      expect(isTestOnlyFile(samples[g])).toBe(true);
    }
    expect(isTestOnlyFile('src/game/controls.ts')).toBe(false);
    expect(isTestOnlyFile('src/game/testing.ts')).toBe(false);
  });

  it('the #2525 project leaves tests out; unknown configs stay unknown', () => {
    expect(releaseBuildExcludesTests(PKG, tsconfigBuild)).toBe(true);
    expect(releaseBuildExcludesTests(PKG, null)).toBeNull();
    expect(releaseBuildExcludesTests(JSON.stringify({ scripts: { build: 'tsc && vite build' } }), null)).toBe(false);
    expect(releaseBuildExcludesTests(JSON.stringify({ scripts: { build: 'next build' } }), null)).toBe(false);
    expect(releaseBuildExcludesTests('not json', tsconfigBuild)).toBeNull();
  });
});

describe('the notes say a test-file error blocks the release only when it does', () => {
  const [testErr, shippedErr] = parseTscErrors(BR2525_TSC);

  it('failedbr #2525: the test file just written — not called a production-build failure', () => {
    const note = writeTypecheckNote([testErr], ['src/game/controls.test.ts'], {}, undefined, { releaseExcludesTests: true });
    expect(note).toContain('controls.test.ts');
    expect(note).not.toContain('production build fails');
    expect(note).toContain('do not block publishing');
  });

  it('failedbr #2525: the test file elsewhere — not "They fail the production build"', () => {
    const note = writeTypecheckNote([testErr], ['src/App.tsx'], {}, undefined, { releaseExcludesTests: true });
    expect(note).not.toContain('fail the production build');
    expect(note).toContain('Not a release blocker');
  });

  it('a shipped file is still a release blocker, alone or beside a test file', () => {
    const note = writeTypecheckNote([shippedErr], ['src/App.tsx'], {}, undefined, { releaseExcludesTests: true });
    expect(note).toContain('They fail the production build');
    expect(releaseConsequence([testErr, shippedErr], true).blocksRelease).toBe(true);
  });

  it('an unknown release config keeps the cautious wording', () => {
    expect(releaseConsequence([testErr], null).blocksRelease).toBe(true);
    expect(writeTypecheckNote([testErr], ['src/game/controls.test.ts'])).toContain('production build fails');
  });

  it('the typecheck tool header goes through the same helper (source guard)', () => {
    const src = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    const header = src.indexOf('TYPE ERROR(S) — the production build');
    expect(header).toBeGreaterThan(-1);
    expect(src.slice(header - 600, header)).toContain('releaseConsequence(tscErrs');
    expect(src).toContain('writeTypecheckNote(errors, tsPaths, sources, undefined, { releaseExcludesTests })');
  });
});
