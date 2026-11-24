/**
 * Q-2765 (BR2001 D3): the fast-lane plan produced two app registries for one concept (`src/utils/apps.tsx` and
 * `src/utils/system.ts`), and the full builder held at 14 type errors for ~5 min until it made them agree.
 * Class: choosing an owner for a shared name changed only the OWNER's purpose; another planned file whose purpose also
 * claimed the name kept claiming it, and each per-file call reads its own purpose first. Now every other claimant is
 * told, in its own purpose, to import from the owner. File names are the report's; purposes are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { disownSharedNames, valueOwnerFor, type SimpleFileSpec } from '../src/server/AgentV3/SimpleBuilder';

const plan = (): SimpleFileSpec[] => [
  { path: 'src/types.ts', purpose: 'The shared contract.' },
  { path: 'src/utils/apps.tsx', purpose: 'Exports APPS, the registry of desktop apps with their icon components.' },
  { path: 'src/utils/system.ts', purpose: 'System helpers and APPS (the app list with string icons) for the taskbar.' },
  { path: 'src/components/Taskbar.tsx', purpose: 'The taskbar; shows every app in APPS.' },
  { path: 'src/components/Window.tsx', purpose: 'A draggable window.' },
];

describe('one shared name, one owner — the others are told', () => {
  it('🔴 the report shape: two files claim APPS; the owner keeps it, the other is told to import it', () => {
    const manifest = plan();
    const owner = valueOwnerFor(manifest, ['APPS'], 'src/types.ts')!;
    expect(owner.path).toBe('src/utils/apps.tsx');
    const changed = disownSharedNames(manifest, ['APPS'], owner.path);
    expect(changed).toEqual(['src/utils/system.ts', 'src/components/Taskbar.tsx']);
    const system = manifest.find((f) => f.path === 'src/utils/system.ts')!;
    expect(system.purpose).toMatch(/Do NOT define or export APPS here — src\/utils\/apps\.tsx owns it; import from it\./);
    expect(manifest.find((f) => f.path === 'src/utils/apps.tsx')!.purpose).not.toMatch(/Do NOT/);
    expect(manifest.find((f) => f.path === 'src/components/Window.tsx')!.purpose).toBe('A draggable window.');
  });
  it('whole names only, idempotent, and nothing to own changes nothing', () => {
    const manifest: SimpleFileSpec[] = [{ path: 'a.ts', purpose: 'APPS_COUNT and MY_APPS' }, { path: 'b.ts', purpose: 'uses APPS.' }];
    expect(disownSharedNames(manifest, ['APPS'], 'owner.ts')).toEqual(['b.ts']);
    expect(disownSharedNames(manifest, ['APPS'], 'owner.ts')).toEqual([]);
    expect(disownSharedNames(manifest, [], 'owner.ts')).toEqual([]);
    expect(disownSharedNames([{ path: 'x.css', purpose: 'APPS styles' }], ['APPS'], 'o.ts')).toEqual([]);
  });
  it('🔒 wired after both owners are chosen (helpers and constants)', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/SimpleBuilder.ts'), 'utf8');
    expect(src).toContain('disownSharedNames(manifest, owner.names, owner.path);');
    expect(src).toContain('const disowned = disownSharedNames(manifest, values, valueOwner.path);');
  });
});
