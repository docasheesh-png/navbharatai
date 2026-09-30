// Autopsy 876afca9 (2026-09-30) — open item closed. The preview copy is taken right after the production
// build, and four passes may still change the app after it: the vaccine repair, the runtime auto-fix, the
// reviewer's repair and the GreenGuard restore (the explorer repair runs BEFORE the copy). Only the
// reviewer's repair re-took the copy (autopsy 972acde5), so in the calculator build the auto-fix deleted a file and the free preview stayed on the
// version before it (PREVIEW_SNAPSHOT_STALE). The copy is now re-taken ONCE, at the end, whenever it no
// longer matches what is about to be persisted — so a pass added later cannot forget it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the end-of-build refresh', () => {
  const persistedAt = route.indexOf('let persisted: Record<string, string> = toSave;');
  const refreshAt = route.indexOf("withTimeout(refreshPreviewCopy(), PREVIEW_COPY_REFRESH_MS, 'snapshot-refresh-final')");
  const finalCompareAt = route.indexOf('if (snapshotTaken) {\n            await finalSave;');

  it('exists, after the persisted set is known and before the final comparison', () => {
    expect(persistedAt).toBeGreaterThan(-1);
    expect(refreshAt).toBeGreaterThan(persistedAt);
    expect(finalCompareAt).toBeGreaterThan(refreshAt);
  });

  it('runs every post-copy pass first — they all sit above it', () => {
    for (const pass of ["runInPass('vaccine-repair'", "runInPass('runtime-error-autofix'", "runInPass('reviewer-functional-repair'", "runInPass('green-guard-restore'"]) {
      const at = route.indexOf(pass);
      expect(at, pass).toBeGreaterThan(-1);
      expect(at, pass).toBeLessThan(refreshAt);
    }
  });

  it('the explorer repair runs BEFORE the copy is taken, so it cannot leave it stale', () => {
    expect(route.indexOf('await runExplorerRepair(')).toBeLessThan(route.indexOf("new FirebaseHostingDeployer().deployStatic(workspaceId, dist, snapshotChannelId(workspaceId))"));
  });

  it('fires only when the copy no longer matches what is about to be persisted', () => {
    const block = route.slice(refreshAt - 900, refreshAt);
    expect(block).toContain('persistedHash: workspaceContentHash(identitySource(persisted))');
    expect(block).toContain("if (before.action !== 'restamp') {");
  });

  it('is bounded: one finite re-arm of the advisory cap, one attempt', () => {
    const block = route.slice(refreshAt - 300, refreshAt);
    expect(block).toContain('armAdvisoryCap(PREVIEW_COPY_REFRESH_MS + 20_000);');
    expect(route.split("'snapshot-refresh-final'").length - 1).toBe(1);
  });

  it('says what happened either way', () => {
    const after = route.slice(refreshAt, refreshAt + 900);
    expect(after).toContain("code: refreshed ? 'PREVIEW_SNAPSHOT_REFRESHED' : 'PREVIEW_SNAPSHOT_NOT_REFRESHED',");
    expect(after).toContain('before the final save');
  });
});
