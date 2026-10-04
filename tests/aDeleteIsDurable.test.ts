/**
 * QUEUE Q-106: A FILE THE BUILD DELETED COULD COME BACK ON THE NEXT RESTORE.
 *
 * The build's own maps already forget a deleted file (8b3dca5c, Q-246). The durable store did not:
 * `saveWorkspaceFiles` MERGES a drastically smaller set into the stored index (the case when the
 * end-of-build sandbox scan fails and only the build's own writes are saved), and it carries a root
 * manifest forward when the incoming set lacks it. Either way a file the build had deleted stayed in the
 * index, and the next sandbox was restored with it.
 *
 * The class: "a delete that only the in-memory maps know about". After the final save the route now
 * removes from the durable store every path this build deleted that is not in what it just persisted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deletionsToForgetDurably } from '../src/server/AgentV3/fileDeletion';
import { diffRemovedPaths, essentialManifestsToCarry, savePlanForFileSet } from '../src/server/AgentV3/WorkspaceFileStore';

const ROOT = join(__dirname, '..');

describe('deletionsToForgetDurably', () => {
  it('names every deleted path that is not in what was persisted', () => {
    expect(deletionsToForgetDurably(['src/old.css', 'src/Old.tsx'], { 'src/App.tsx': 'x' })).toEqual(['src/old.css', 'src/Old.tsx']);
  });

  it('keeps a file the build deleted and then wrote again, or that a restore put back', () => {
    expect(deletionsToForgetDurably(['src/Old.tsx', 'src/gone.ts'], { 'src/Old.tsx': 'again' })).toEqual(['src/gone.ts']);
  });

  it('is empty for nothing deleted, and de-duplicates', () => {
    expect(deletionsToForgetDurably([], { a: '1' })).toEqual([]);
    expect(deletionsToForgetDurably(null, null)).toEqual([]);
    expect(deletionsToForgetDurably(['a.ts', 'a.ts'], {})).toEqual(['a.ts']);
  });
});

describe('🔴 the two ways the store kept a deleted file, and the removal that closes both', () => {
  const stored = ['package.json', 'index.html', 'vite.config.js', 'src/App.tsx', 'src/main.tsx', 'src/old.css', 'src/a.tsx', 'src/b.tsx', 'src/c.tsx', 'src/d.tsx'];

  it('a partial save MERGES, so the deleted file survives it — and the removal takes it out', () => {
    const incoming = ['src/App.tsx', 'src/new.css'];
    expect(savePlanForFileSet(stored.length, incoming.length)).toBe('merge');
    const merged = [...new Set([...stored, ...incoming])];
    expect(merged).toContain('src/old.css');
    const forget = deletionsToForgetDurably(['src/old.css'], Object.fromEntries(incoming.map((p) => [p, 'x'])));
    const { remaining } = diffRemovedPaths(merged, forget);
    expect(remaining).not.toContain('src/old.css');
    expect(remaining).toContain('src/a.tsx');
  });

  it('a deleted root manifest is carried forward by the save — and the removal takes it out', () => {
    const incoming = stored.filter((p) => p !== 'vite.config.js').concat('vite.config.ts');
    expect(essentialManifestsToCarry(stored, incoming)).toEqual(['vite.config.js']);
    const afterSave = [...incoming, 'vite.config.js'];
    const forget = deletionsToForgetDurably(['vite.config.js'], Object.fromEntries(incoming.map((p) => [p, 'x'])));
    expect(diffRemovedPaths(afterSave, forget).remaining).not.toContain('vite.config.js');
  });
});

describe('the wiring — proven by reversion', () => {
  const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');

  it('the route removes the deleted paths from the store AFTER the final save, against what it persisted', () => {
    expect(route).toContain('const forgetDurably = deletionsToForgetDurably(deletedThisBuild, persisted);');
    expect(route).toContain('finalSave.then(() => removeWorkspaceFiles(workspaceId, forgetDurably))');
    expect(route.indexOf('const finalSave = saved ?')).toBeLessThan(route.indexOf('const forgetDurably ='));
  });
});
