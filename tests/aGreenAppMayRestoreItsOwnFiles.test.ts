/**
 * A GREEN APP MAY RESTORE ITS OWN FILES — autopsy 2026-09-26 ("4D Future City Drive").
 *
 * After the build was verified working, a restore of the app's OWN saved files into its sandbox was
 * refused file by file by Green Freeze — 49 `GREEN_FREEZE_DEFERRED` lines, each telling the user "Reply
 * if you want this change made", one of them about `.nbai-landing.tar.gz`. The actuator's own restore
 * had been named `sandbox-file-restore` (an ALLOWED pass) on 2026-08-20; three sibling restores in the
 * route, and the shared asset restore, never were. A write with no pass name is an unknown writer to
 * the freeze, and an unknown writer is refused.
 *
 * `tsc` and `vitest` cannot see a missing pass name, so these are source guards, proven by reversion.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOWED_PASSES } from '../src/server/AgentV3/greenFreeze';

const route = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
const assets = readFileSync(resolve(__dirname, '../src/server/AgentV3/WorkspaceAssetStore.ts'), 'utf8');

describe('🔒 every restore of the app\'s own saved bytes is named as one', () => {
  it('the pass it uses is on the freeze\'s allowed list', () => {
    expect(ALLOWED_PASSES.has('sandbox-file-restore')).toBe(true);
  });

  it('no route writes the durable store\'s files back into a sandbox without the name', () => {
    // Every writeWorkspaceFiles whose source is the SAVED copy (a restore), as opposed to an import.
    const restores = [...route.matchAll(/writeWorkspaceFiles\(actuator, workspaceId, (saved|plan\.restore)\)/g)];
    expect(restores.length).toBe(3);
    for (const m of restores) {
      const before = route.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
      expect(before, `restore from ${m[1]}`).toMatch(/runInPass\('sandbox-file-restore', \(\) => $/);
    }
  });

  it('the asset restore names itself, so no caller can forget it', () => {
    const at = assets.indexOf('export async function restoreWorkspaceAssets(');
    expect(assets.slice(at, at + 900)).toMatch(/runInPass\('sandbox-file-restore', \(\) => materializeAssets\(/);
  });
});
