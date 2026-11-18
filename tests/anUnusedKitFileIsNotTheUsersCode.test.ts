// Q-2715 (autopsy 57604006, builds 969740df and 1712adfa): the kit's untouched src/game/GameCanvas.tsx was reported as
// "[observation about your existing code] 1 component(s) created but never used". It is NavBharatAI's library, the
// game mounts its own canvas, and an unused kit module is not bundled. It is named for what it is — and NOT deleted,
// because a later edit may import a kit module the builder's prompt promises.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { isKnownKitVersion } from '../src/server/lib/gameRecipeLayers';
import { kitOrphanObservation, splitSeedOrphans } from '../src/server/AgentV3/seedOrphanOwnership';

const canvas = generateGameShell().files['src/game/GameCanvas.tsx'];

describe('an untouched kit file is the kit, not the user', () => {
  it('the shipped GameCanvas is recognised as a kit version; an edited copy is the user\'s', () => {
    expect(isKnownKitVersion('src/game/GameCanvas.tsx', canvas)).toBe(true);
    expect(isKnownKitVersion('src/game/GameCanvas.tsx', canvas + '\n// my change')).toBe(false);
  });
  it('the split puts it with the kit, and the note says so — never "your existing code"', () => {
    const orphans = [{ file: 'src/game/GameCanvas.tsx', label: 'src/game/GameCanvas.tsx (GameCanvas)' }, { file: 'src/components/Mine.tsx', label: 'src/components/Mine.tsx (Mine)' }];
    const split = splitSeedOrphans(orphans, ['src/game/GameCanvas.tsx']);
    expect(split.platform.map((o) => o.file)).toEqual(['src/game/GameCanvas.tsx']);
    expect(split.preExisting.map((o) => o.file)).toEqual(['src/components/Mine.tsx']);
    const note = kitOrphanObservation(split.platform.map((o) => o.label));
    expect(note).toContain("NavBharatAI's game kit — not the user's code");
    expect(note).not.toMatch(/your existing code|created but never used/);
  });
  it('the readiness pass reads each pre-existing orphan and moves an untouched kit file to the kit note (source guard)', () => {
    const src = readFileSync(new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url), 'utf8');
    expect(src).toContain('isKnownKitVersion(o.file, await this.actuator.readFile(this.workspaceId, o.file))');
    expect(src).toContain('kitOrphanObservation(kitOwnership.platform.map((o) => o.label))');
    expect(src).toContain('const reallyOld = kitOwnership.preExisting;');
  });
});
