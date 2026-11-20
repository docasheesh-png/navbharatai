/**
 * Admin 2026-11-20: "user koi apna module add karna ho to bhi kar sake — attach file → zip ya jo bhi file ho, woh
 * navbharatai me user ke game me blend/merge/sync ho". Before this a .glb attached in Pro went to private storage with a
 * receipt telling the builder NOT to use it, a zip was always a whole-project import (refused once the chat held an app),
 * and a .glb inside a zip was read as TEXT. These lock the path that puts the user's own models into their game.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import {
  userModelsFromFiles, userModelFilesFromAttachments, splitUserModelAttachments, zipIsModelPack, landUserModels, userModelNote,
  userModelSubject, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS,
} from '../src/server/AgentV3/gameAssets/userModels';
import { validateGlb } from '../src/server/AgentV3/gameAssets/assetPolicy';
import { needsOpaqueStorage } from '../src/lib/proAttachmentClient';
import { syntheticGlb, encodeFixtureGlb } from './fixtures/gameAssetFixtures';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64');
const u8 = (b: Buffer | string) => new Uint8Array(typeof b === 'string' ? Buffer.from(b) : b);
const glbJson = (glb: Uint8Array) => { const b = Buffer.from(glb); return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')); };
const OBJ = ['mtllib crate.mtl', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'usemtl Wood', 'f 1/1 2/2 3/3 4/4', 'usemtl Paint', 'f -4/1 -2/3 -1/4'].join('\n');
const MTL = ['newmtl Wood', 'Kd 0.6 0.4 0.2', 'map_Kd textures/wood.png', 'newmtl Paint', 'Kd 1 0 0', 'd 0.5'].join('\n');

/** A glTF that names a .bin and a normal map; the bin is the synthetic model's. */
function gltfPack(withNormalMap: boolean) {
  const glb = syntheticGlb(false); const n = glb.readUInt32LE(12);
  const doc = JSON.parse(glb.subarray(20, 20 + n).toString('utf8')); const bin = glb.subarray(28 + n);
  doc.buffers = [{ uri: 'hero.bin', byteLength: doc.buffers[0].byteLength }];
  doc.images = [{ uri: 'hero_color.png' }, { uri: 'hero_normal.png' }];
  doc.textures = [{ source: 0 }, { source: 1 }];
  doc.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  doc.materials[0].normalTexture = { index: 1 };
  const files = new Map<string, Uint8Array>([['pack/hero.gltf', u8(JSON.stringify(doc))], ['pack/hero.bin', u8(bin.subarray(0, doc.buffers[0].byteLength))], ['pack/hero_color.png', u8(PNG)]]);
  if (withNormalMap) files.set('pack/hero_normal.png', u8(PNG));
  return files;
}

describe('a user\'s own model becomes a checked GLB in their project', () => {
  it('a .glb is taken as it is, named after its file, at public/models/<name>.glb', () => {
    const glb = u8(syntheticGlb());
    const { models, refused } = userModelsFromFiles(new Map([['My Hero Car.glb', glb]]));
    expect(refused).toEqual([]);
    expect(models[0]).toMatchObject({ subject: 'my-hero-car', path: 'public/models/my-hero-car.glb', animations: ['Move'], sha256: createHash('sha256').update(glb).digest('hex') });
    expect(userModelSubject('गाड़ी.glb')).toBe('model');
  });

  it('an .obj with its .mtl becomes one GLB: a primitive per material, colours, opacity, the texture embedded, normals computed', () => {
    const { models, refused } = userModelsFromFiles(new Map([['crate.obj', u8(OBJ)], ['crate.mtl', u8(MTL)], ['textures/wood.png', u8(PNG)]]));
    expect(refused).toEqual([]);
    const doc = glbJson(models[0].bytes);
    expect(models[0].materials).toEqual(['Wood', 'Paint']);
    expect(models[0].triangles).toBe(3);
    expect(doc.meshes[0].primitives).toHaveLength(2);
    expect(doc.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    expect(doc.materials[1]).toMatchObject({ alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 0.5] } });
    expect(doc.images[0].mimeType).toBe('image/png');
    expect(doc.meshes[0].primitives[0].attributes.NORMAL).toBeDefined();
    validateGlb(models[0].bytes, USER_MODEL_LIMITS, USER_MODEL_EXTENSIONS);
  });

  it('a .gltf with its .bin and textures is bundled; a missing TEXTURE loads without it and says so; a missing .bin refuses', () => {
    const full = userModelsFromFiles(gltfPack(true));
    expect(full.models[0]).toMatchObject({ subject: 'hero', warnings: [] });
    expect(glbJson(full.models[0].bytes).images).toHaveLength(2);
    const noNormal = userModelsFromFiles(gltfPack(false));
    expect(noNormal.models[0].warnings).toEqual(['its texture hero_normal.png was not in the files, so the model is shown without it']);
    const doc = glbJson(noNormal.models[0].bytes);
    expect(doc.images).toHaveLength(1);
    expect(doc.materials[0].normalTexture).toBeUndefined();
    expect(doc.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({ index: 0 });
    expect(userModelNote(noNormal.models, [])).toMatch(/tell the user: its texture hero_normal\.png/);
    const noBin = gltfPack(true); noBin.delete('pack/hero.bin');
    expect(userModelsFromFiles(noBin).refused[0].reason).toMatch(/a file it needs is missing: hero\.bin/);
  });

  it('every unusable file comes back with a plain reason, never dropped: FBX, compressed, too heavy, not a model', () => {
    const glb = syntheticGlb(false); const n = glb.readUInt32LE(12);
    const doc = JSON.parse(glb.subarray(20, 20 + n).toString('utf8'));
    const draco = encodeFixtureGlb({ ...doc, extensionsUsed: ['KHR_draco_mesh_compression'] }, glb.subarray(28 + n));
    const unlit = encodeFixtureGlb({ ...doc, extensionsUsed: ['KHR_materials_unlit'], materials: [{ ...doc.materials[0], extensions: { KHR_materials_unlit: {} } }] }, glb.subarray(28 + n));
    const { models, refused } = userModelsFromFiles(new Map([['a.fbx', u8('Kaydara FBX Binary')], ['b.glb', u8(draco)], ['c.glb', u8('not a model')], ['d.glb', u8(unlit)]]));
    expect(models.map(m => m.subject)).toEqual(['d']);
    expect(refused.find(r => r.from === 'a.fbx')!.reason).toMatch(/File → Export → glTF 2\.0 \(\.glb\)/);
    expect(refused.find(r => r.from === 'b.glb')!.reason).toMatch(/compressed geometry \(Draco\/Meshopt\)/);
    expect(refused.find(r => r.from === 'c.glb')!.reason).toMatch(/not a valid 3D model/);
    // "size" from the validator also means too SMALL: only a file really over the limit is told it is too big.
    expect(userModelsFromFiles(new Map([['huge.glb', new Uint8Array(USER_MODEL_LIMITS.bytes + 4)]])).refused[0].reason).toMatch(/larger than 8 MB/);
    expect(refused.find(r => r.from === 'c.glb')!.reason).not.toMatch(/larger than/);
    // The library keeps its stricter rule: no extension at all.
    expect(() => validateGlb(unlit)).toThrow(/references or extensions/);
    const big = ['v 0 0 0', 'v 1 0 0', 'v 0 1 0', ...Array.from({ length: USER_MODEL_LIMITS.triangles + 1 }, () => 'f 1 2 3')].join('\n');
    expect(userModelsFromFiles(new Map([['big.obj', u8(big)]])).refused[0].reason).toMatch(/more than 200,000 triangles/);
  });

  it('two files with the same name get two names; at most 8 models per message, the rest told to wait', () => {
    const glb = u8(syntheticGlb());
    expect(userModelsFromFiles(new Map([['a/car.glb', glb], ['b/car.glb', glb]])).models.map(m => m.subject)).toEqual(['car', 'car-2']);
    const many = new Map(Array.from({ length: 9 }, (_, i) => [`m${i}.glb`, glb] as [string, Uint8Array]));
    const r = userModelsFromFiles(many);
    expect(r.models).toHaveLength(8); expect(r.refused[0].reason).toMatch(/only 8 models are added per message/);
  });
});

describe('a zip of models is merged into the game; a zip of an app stays a project import', () => {
  const zip = async (files: Record<string, Uint8Array | string>) => { const z = new JSZip(); for (const [p, c] of Object.entries(files)) z.file(p, c); return new Uint8Array(await z.generateAsync({ type: 'uint8array' })); };

  it('models without an app are a model pack; with package.json or index.html they are a project', async () => {
    expect(await zipIsModelPack(await zip({ 'pack/car.glb': u8(syntheticGlb()), 'pack/readme.txt': 'hi' }))).toBe(true);
    expect(await zipIsModelPack(await zip({ 'car.glb': u8(syntheticGlb()), 'package.json': '{}' }))).toBe(false);
    expect(await zipIsModelPack(await zip({ 'models/car.glb': u8(syntheticGlb()), 'index.html': '<html>' }))).toBe(false);
    expect(await zipIsModelPack(await zip({ 'readme.txt': 'no models' }))).toBe(false);
  });

  it('a .glb inside the pack arrives byte-exact (it used to be read as text), the shared root folder stripped', async () => {
    const glb = u8(syntheticGlb());
    const pack = await zip({ 'MyPack/cars/car.glb': glb, 'MyPack/crate.obj': OBJ, 'MyPack/crate.mtl': MTL, 'MyPack/textures/wood.png': u8(PNG) });
    const { files } = await userModelFilesFromAttachments([{ name: 'models.zip', base64: Buffer.from(pack).toString('base64') }]);
    expect([...files.keys()].sort()).toEqual(['cars/car.glb', 'crate.mtl', 'crate.obj', 'textures/wood.png']);
    expect(Buffer.from(files.get('cars/car.glb')!).equals(Buffer.from(glb))).toBe(true);
    expect(userModelsFromFiles(files).models.map(m => m.subject)).toEqual(['car', 'crate']);
  });

  it('the split: models, their .bin/.mtl and (only then) their pictures go to the game; a document, a project zip or a lone mockup do not', async () => {
    const b64 = (b: Uint8Array | string) => Buffer.from(b).toString('base64');
    const project = await zip({ 'index.html': '<html>', 'logo.glb': u8(syntheticGlb()) });
    const pack = await zip({ 'tree.glb': u8(syntheticGlb()) });
    const atts = [{ name: 'hero.gltf', base64: b64('{}') }, { name: 'hero.bin', base64: b64('x') }, { name: 'hero.png', base64: b64(PNG) },
      { name: 'brief.pdf', base64: b64('%PDF') }, { name: 'app.zip', base64: b64(project) }, { name: 'trees.zip', base64: b64(pack) }];
    const s = await splitUserModelAttachments(atts);
    expect(s.models.map(a => a.name)).toEqual(['hero.gltf', 'hero.bin', 'hero.png', 'trees.zip']);
    expect(s.rest.map(a => a.name)).toEqual(['brief.pdf', 'app.zip']);
    const mockup = await splitUserModelAttachments([{ name: 'design.png', base64: b64(PNG) }]);
    expect(mockup).toEqual({ models: [], rest: [{ name: 'design.png', base64: b64(PNG) }] });
  });
});

describe('landing: durable first, read back, then the sandbox — and only what landed is announced', () => {
  it('a model whose durable copy does not read back is not written to the sandbox and is named as failed', async () => {
    const { models } = userModelsFromFiles(new Map([['car.glb', u8(syntheticGlb())], ['tree.glb', u8(syntheticGlb(false))]]));
    const saved = new Map<string, string>();
    const store = {
      saveBinary: vi.fn(async (_: string, f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) if (!p.includes('tree')) saved.set(p, c); }),
      readBinary: vi.fn(async (_: string, p: string) => saved.has(p) ? Buffer.from(saved.get(p)!.split(',')[1], 'base64') : null),
    };
    const writeBinaryFile = vi.fn(async () => {});
    const r = await landUserModels(models, 'w', { writeBinaryFile }, store);
    expect(r.landed.map(m => m.subject)).toEqual(['car']);
    expect(r.failed).toEqual([{ from: 'tree.glb', reason: expect.stringMatching(/could not be saved/) }]);
    expect(writeBinaryFile).toHaveBeenCalledTimes(1);
    expect(writeBinaryFile).toHaveBeenCalledWith('w', 'public/models/car.glb', expect.any(String));
    const note = userModelNote(r.landed, r.failed);
    expect(note).toMatch(/"car" → public\/models\/car\.glb/);
    expect(note).toMatch(/source: \{ file: 'public\/models\/car\.glb', sha256: '[a-f0-9]{64}' \}/);
    expect(note).toMatch(/\[USER MODELS NOT ADDED\][\s\S]*tree\.glb/);
    expect(note).not.toMatch(/"tree" →/);
  });

  it('the build route splits models off before the project-zip and document paths, and announces only what landed', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toMatch(/const userModelSplit = await splitUserModelAttachments\(rawAttachments\);[\s\S]{0,900}const zipImports = userModelSplit\.rest\.filter/);
    expect(route).toMatch(/const docAttachments = userModelSplit\.rest\.filter/);
    expect(route).toMatch(/attachmentContext\.replace\(userModelsPendingNote, realNote\)/);
    expect(route).toMatch(/are added to the project when the game is built or edited in this turn — not before/);
  });

  it('the Pro client sends model files to the build instead of private storage', async () => {
    for (const name of ['car.glb', 'car.gltf', 'crate.obj', 'crate.mtl', 'car.bin', 'hero.fbx']) {
      expect(await needsOpaqueStorage({ name, type: '', arrayBuffer: async () => new Uint8Array([0, 1, 2, 3]).buffer }), name).toBe(false);
    }
  });
});
