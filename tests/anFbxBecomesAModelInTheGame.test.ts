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
    expect(warnings.get('weapons/sword.glb')!.join(' ')).toMatch(/picture\(s\) knight_texture\.png were not attached[\s\S]*attach the picture files with the FBX/);
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

describe('an FBX with its picture attached keeps its look (admin 2026-11-21)', () => {
  const uvs = (glb: Uint8Array) => {
    const b = Buffer.from(glb); const n = b.readUInt32LE(12);
    const doc = JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
    const bin = b.subarray(28 + n);
    const acc = doc.accessors[doc.meshes[0].primitives[0].attributes.TEXCOORD_0];
    const view = doc.bufferViews[acc.bufferView];
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    return Array.from({ length: 4 }, (_, i) => [bin.readFloatLE(start + i * 8), bin.readFloatLE(start + i * 8 + 4)]);
  };
  it('the picture the FBX names, attached beside it, goes into the GLB as its base colour, and nothing is reported missing', async () => {
    const { files, warnings, refused } = await convertFbxFiles(new Map([['sword.fbx', fixture('sword.fbx')], ['knight_texture.png', fixture('knight_texture.png')]]));
    expect(refused).toEqual([]);
    const glb = files.get('sword.glb')!;
    validateGlb(glb, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
    const b = Buffer.from(glb); const doc = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0].mimeType).toBe('image/png');
    expect(doc.materials.some((m: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) => m.pbrMetallicRoughness?.baseColorTexture)).toBe(true);
    expect(warnings.get('sword.glb')!.join(' ')).not.toMatch(/not attached|could not be carried over/);
  });
  it('its UVs are flipped for glTF (they showed the silver blade in the grip\'s brown), and only when a picture goes in', async () => {
    const plain = (await convertFbxFiles(new Map([['sword.fbx', fixture('sword.fbx')]]))).files.get('sword.glb')!;
    const textured = (await convertFbxFiles(new Map([['sword.fbx', fixture('sword.fbx')], ['knight_texture.png', fixture('knight_texture.png')]]))).files.get('sword.glb')!;
    const a = uvs(plain), b = uvs(textured);
    for (let i = 0; i < a.length; i++) { expect(b[i][0]).toBeCloseTo(a[i][0], 5); expect(b[i][1]).toBeCloseTo(1 - a[i][1], 5); }
  });
  it('without the picture, the user is told exactly which file to attach', async () => {
    const { warnings } = await convertFbxFiles(new Map([['sword.fbx', fixture('sword.fbx')]]));
    expect(warnings.get('sword.glb')!.join(' ')).toMatch(/picture\(s\) knight_texture\.png were not attached/);
  });
});

describe('FBX exports from Sketchfab / Mixamo / avatar creators (2026-11-21: 3 of 3 real Indian-clothing models failed)', () => {
  it('an FBX with EMBEDDED pictures parses: a window is lent only for the parse, its pictures are captured, and it is removed', async () => {
    const { withLentWindow } = await import('../src/server/AgentV3/gameAssets/userModels');
    const embedded = new Map<string, Blob>();
    const key = withLentWindow(embedded, () => (globalThis as unknown as { window: { URL: { createObjectURL(b: Blob): string } } }).window.URL.createObjectURL(new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })));
    expect(key).toBe('nbblob:0');
    expect(embedded.get('nbblob:0')!.type).toBe('image/png');
    expect('window' in globalThis).toBe(false);
    // A parse that throws still removes it; a window that already existed is left exactly as it was.
    expect(() => withLentWindow(new Map(), () => { throw new Error('bad fbx'); })).toThrow('bad fbx');
    expect('window' in globalThis).toBe(false);
    const mine = { mine: true }; (globalThis as unknown as { window: unknown }).window = mine;
    try { withLentWindow(new Map(), () => 0); expect((globalThis as unknown as { window: unknown }).window).toBe(mine); }
    finally { delete (globalThis as unknown as { window?: unknown }).window; }
  });

  it('face shape keys (morph targets) are left out — 126 of them were 42 MB of a 55 MB avatar — and the count is returned to tell the user', async () => {
    const THREE = await import('three');
    const { dropMorphTargets } = await import('../src/server/AgentV3/gameAssets/userModels');
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.morphAttributes.position = Array.from({ length: 5 }, () => new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
    const mesh = new THREE.Mesh(geo); mesh.updateMorphTargets();
    const root = new THREE.Group(); root.add(mesh, new THREE.Mesh(new THREE.BoxGeometry()));
    expect(dropMorphTargets(root)).toBe(5);
    expect(Object.keys(geo.morphAttributes)).toEqual([]);
    expect(mesh.morphTargetInfluences).toBeUndefined();
    expect(dropMorphTargets(root)).toBe(0);
    expect(readFileSync('src/server/AgentV3/gameAssets/userModels.ts', 'utf8')).toMatch(/face shape keys \(expressions\) were left out/);
  });
});
