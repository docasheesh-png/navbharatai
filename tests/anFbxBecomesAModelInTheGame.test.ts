/**
 * Admin 2026-11-20: "FBX file seedha lena … ok banao". An .fbx the user attaches is converted on the server (three.js's
 * own FBXLoader + GLTFExporter, no browser, no native code) and goes into their game like a .glb. Real CC0 fixtures, each
 * carrying a defect found converting real packs (tests/fixtures/fbx/LICENSE.txt):
 *   - pig.fbx: FBXLoader reads its materials as fully transparent — the animal exported invisible;
 *   - sword.fbx: references a texture, so FBXLoader called browser APIs in Node and could not parse at all.
 * And the second request: when the library lacks what the user asked for, the user is told where to get it and how to
 * bring it in (modelSourcesGuide.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { planUserModels, convertFbxFiles } from '../src/server/AgentV3/gameAssets/userModels';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS } from '../src/server/AgentV3/gameAssets/userModels';
import { ownModelGuide, FREE_MODEL_SOURCES } from '../src/server/AgentV3/gameAssets/modelSourcesGuide';
import { gameLibraryMenuHandoff } from '../src/server/AgentV3/gameAssets/gameLibrarySelection';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/fbx/${name}`));
const glbJson = (glb: Uint8Array) => { const b = Buffer.from(glb); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as { materials?: { alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]; meshes: { primitives: unknown[] }[] }; };

describe('an attached FBX becomes a checked model in the game', () => {
  it('an animated FBX keeps its clips, and its materials are solid (they exported fully transparent)', async () => {
    const plan = await planUserModels([{ name: 'pig.fbx', base64: Buffer.from(fixture('pig.fbx')).toString('base64') }]);
    expect(plan.refused).toEqual([]);
    const pig = plan.models[0];
    expect(pig).toMatchObject({ subject: 'pig', path: 'public/models/pig.glb', from: 'pig.fbx' });
    expect(pig.animations.sort()).toEqual(['Idle', 'Jump']);
    validateGlb(pig.bytes, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
    for (const m of glbJson(pig.bytes).materials ?? []) {
      expect(m.alphaMode ?? 'OPAQUE').toBe('OPAQUE');
      expect(m.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1).toBe(1);
    }
    for (const mesh of glbJson(pig.bytes).meshes) expect(mesh.primitives.length).toBeLessThanOrEqual(4);
    expect(pig.warnings.join(' ')).toMatch(/converted from FBX/);
  });

  it('a textured FBX parses (it threw "document is not defined") and the user is told its textures stayed behind', async () => {
    const { files, refused, warnings } = await convertFbxFiles(new Map([['weapons/sword.fbx', fixture('sword.fbx')]]));
    expect(refused).toEqual([]);
    expect([...files.keys()]).toEqual(['weapons/sword.glb']);
    validateGlb(files.get('weapons/sword.glb')!, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
    expect(warnings.get('weapons/sword.glb')!.join(' ')).toMatch(/textures could not be carried over from FBX[\s\S]*export it as \.glb/);
  });

  it('a broken FBX is refused with the export step, never dropped', async () => {
    const { refused } = await convertFbxFiles(new Map([['broken.fbx', new Uint8Array(Buffer.from('Kaydara FBX Binary  \u0000 not really'))]]));
    expect(refused).toEqual([{ from: 'broken.fbx', reason: expect.stringMatching(/File → Export → glTF 2\.0/) }]);
  });
});

describe('when the library has no such model, the user is told where to get it and how to bring it in', () => {
  it('the guide names the object, free sources with their licences, the file to pick, the exact upload path and the licence rule', () => {
    const guide = ownModelGuide(['dragon', 'tuk tuk']);
    expect(guide).toMatch(/"DRAGON", "TUK TUK"/);
    for (const s of FREE_MODEL_SOURCES) { expect(guide).toContain(s.url); expect(s.url.startsWith('https://')).toBe(true); }
    expect(guide).toMatch(/prefer \.glb/);
    expect(guide).toMatch(/NavBharatAI Pro → paperclip → Choose file/);
    expect(guide).toMatch(/CC-BY needs the author's name/);
    expect(guide).toMatch(/Never suggest paid, ripped/);
    expect(guide).toMatch(/Build the closest working version from code so the game runs/);
  });

  it('it reaches the builder in the library menu, and in add_library_models when a name is not in the library', () => {
    expect(gameLibraryMenuHandoff()).toContain('NavBharatAI Pro → paperclip → Choose file');
    expect(readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8').match(/ownModelGuide\(unknown\)/g)?.length).toBe(2);
  });
});
