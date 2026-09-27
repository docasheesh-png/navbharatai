// AUTOPSY "Universal Remote" (2026-09-27): build 2 wrote NavBharatAI's starter E2E suite and was told the
// truth about it. Build 3 — the next message in the same app — found the same two files, had not written
// them itself, and reported them as the user's own suite: "this project HAS a test suite, but it could not
// be run here", RELEASE_GATE YELLOW. Whether a file is ours is a fact about its CONTENT, not about which
// build happened to write it.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { starterSuiteOnly, testFilesIn } from '../src/server/AgentV3/e2eAutoScaffold';
import { planE2eScaffold } from '../src/server/AgentV3/e2eScaffold';

const scaffold = planE2eScaffold({ appName: 'Universal Remote' }).files;
const FILES = ['index.html', 'src/App.tsx', 'package.json', ...Object.keys(scaffold)];
const NOTHING_THIS_BUILD = new Set<string>();

describe('our starter suite is ours on every build, not only the one that wrote it', () => {
  it('the exact report case: a later build, nothing written this turn, our marker on both files ⇒ ours', () => {
    expect(starterSuiteOnly(FILES, NOTHING_THIS_BUILD, scaffold)).toBe(true);
  });

  it('without the contents it is judged theirs — the old behaviour, and the safe direction', () => {
    expect(starterSuiteOnly(FILES, NOTHING_THIS_BUILD)).toBe(false);
  });

  it('🔒 a spec the user or the model wrote beside ours ⇒ theirs, even with our files recognised', () => {
    const files = [...FILES, 'e2e/checkout.spec.ts'];
    const contents = { ...scaffold, 'e2e/checkout.spec.ts': "import { test } from '@playwright/test';\n" };
    expect(starterSuiteOnly(files, NOTHING_THIS_BUILD, contents)).toBe(false);
  });

  it('🔒 a file at our path WITHOUT our marker is theirs — the path alone proves nothing', () => {
    const contents = { ...scaffold, 'e2e/smoke.spec.ts': "import { test } from '@playwright/test';\ntest('x', async () => {});\n" };
    expect(starterSuiteOnly(FILES, NOTHING_THIS_BUILD, contents)).toBe(false);
  });

  it('testFilesIn lists only test files, never node_modules', () => {
    expect(testFilesIn(['./src/App.tsx', 'e2e/smoke.spec.ts', 'playwright.config.ts', 'node_modules/a/test/x.test.js']))
      .toEqual(['e2e/smoke.spec.ts', 'playwright.config.ts']);
  });

  it('the route reads the test files and hands their contents to the check', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const i = route.indexOf('const ours = starterSuiteOnly(files, finishingPaths, testContents);');
    expect(i).toBeGreaterThan(-1);
    expect(route.slice(i - 600, i)).toContain('testFilesIn(files)');
  });
});
