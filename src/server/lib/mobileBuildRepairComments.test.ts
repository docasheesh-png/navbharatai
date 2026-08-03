// THE LOCK ON "a repair edited the workflow's own explanation".
//
// Found while building the self-healing loop, 2026-08-03. The generated workflows are heavily commented
// — each non-obvious step says why it exists — and one of those comments contains the sentence
// "so npm ci failed on EVERY run". `repairNpmCi` matched that prose and rewrote it to "so npm ci ||
// npm install failed on EVERY run".
//
// That is worse than cosmetic. The repair reports "I fixed something" and commits, but nothing
// EXECUTABLE changed, so the build fails again identically — one wasted attempt out of three. And the
// file now differs from what the kit generates, so the stale-workflow refresh sees a permanent
// difference and can never settle.
//
// Every workflow repair therefore skips comment lines, and this asserts it for all of them at once, so a
// repair added later inherits the guarantee instead of rediscovering the bug.

import { describe, it, expect } from 'vitest';
import {
  repairAndroidPlatform, repairGradlewPermission, repairJavaVersion, repairNpmCache, repairNpmCi,
  repairOutOfMemory, repairPeerConflict, repairSdkLicenses,
} from './mobileBuildRepair';
import { generateShipKit } from './mobileShipKit';
import { SHIP_WORKFLOWS, workflowPath } from '../../lib/shipWorkflows';

const REPAIRS: Array<[string, (wf: string) => string | null]> = [
  ['repairNpmCache', repairNpmCache],
  ['repairNpmCi', repairNpmCi],
  ['repairPeerConflict', repairPeerConflict],
  ['repairAndroidPlatform', repairAndroidPlatform],
  ['repairGradlewPermission', repairGradlewPermission],
  ['repairSdkLicenses', repairSdkLicenses],
  ['repairJavaVersion', (wf) => repairJavaVersion(wf)],
  ['repairOutOfMemory', repairOutOfMemory],
];

/** Comment lines, which no repair may ever rewrite. */
const comments = (text: string): string[] => text.split('\n').filter((l) => /^\s*#/.test(l));

describe('no repair rewrites a comment', () => {
  const files = generateShipKit({ appName: 'Test App', ios: true }).files;

  for (const key of ['androidApk', 'androidAab', 'iosIpa'] as const) {
    const path = workflowPath(SHIP_WORKFLOWS[key]);
    const wf = files[path];

    it.each(REPAIRS)(`${SHIP_WORKFLOWS[key]} — %s leaves every comment untouched`, (_name, repair) => {
      const out = repair(wf);
      if (out === null) return; // nothing to repair is the correct answer for a current workflow
      expect(comments(out)).toEqual(comments(wf));
    });
  }

  it('THE REGRESSION: prose mentioning npm ci is not rewritten into a command', () => {
    const wf = [
      '      # The old step ran npm ci, and npm ci failed on every run without a lock file.',
      '      - name: Install',
      '        run: npm install',
    ].join('\n');
    // Only the comment mentions `npm ci`, and a comment is not something to fix.
    expect(repairNpmCi(wf)).toBeNull();
  });

  it('but a real command IS still repaired, in the same file as such a comment', () => {
    const wf = [
      '      # Explains why npm ci matters here.',
      '      - name: Install',
      '        run: npm ci',
    ].join('\n');
    const out = repairNpmCi(wf);
    expect(out).toContain('run: npm ci || npm install');
    expect(comments(out!)).toEqual(comments(wf));
  });
});
