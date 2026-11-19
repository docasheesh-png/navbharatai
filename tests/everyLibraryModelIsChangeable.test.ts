/**
 * Admin 2026-11-19: "every module must be maximally flexible — the user can change anything, any time, even replace it
 * 100%". These tests run the REAL generated runtime and loader against a real GLB: every customization field changes
 * the mounted model, a project's own file replaces a library model or adds a new subject, and nothing a user writes in
 * assetCustomizations.ts can break the game (bad values are ignored, bad files fall back to the code-built object).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { generateAssetCustomizations, generateAssetModelLoader, generateGameAssetRuntime, previousAssetModelLoader, upgradeAssetModelLoader } from '../src/server/lib/GameAssetRuntimeGenerator';
import { syntheticGlb } from './fixtures/gameAssetFixtures';
import { localModelLead } from '../src/server/AgentV3/gameAssets/localModelNote';

const root = join(__dirname, `.tmp-changeable-${process.pid}`);
const library = syntheticGlb(false);
const own = syntheticGlb(true);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const files = new Map<string, Uint8Array>([[`/game-assets/${sha(library)}.glb`, library], ['/models/my-car.glb', own], ['/models/dragon.glb', own]]);
const procedural = () => ({ root: new THREE.Group(), source: 'procedural' as const, update() {}, dispose() {} });

/** One fixture project per customization file: the loader reads it once, at import, like a real game build. */
async function game(name: string, customizations: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'externalAssets.ts'), generateGameAssetRuntime());
  writeFileSync(join(dir, 'assetModels.ts'), generateAssetModelLoader({ car: { sha256: sha(library), height: 1.4, yaw: 0, lod: false } }));
  if (customizations) writeFileSync(join(dir, 'assetCustomizations.ts'), generateAssetCustomizations(['car']).replace('= {};', `= ${customizations};`));
  return await import(join(dir, 'assetModels.ts')) as { loadRequestedAsset: (s: string, f: typeof procedural) => Promise<{ root: THREE.Group; source: string }>; availableAssetSubjects: () => string[] };
}
const size = (g: THREE.Object3D) => { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()); };
const firstColor = (g: THREE.Object3D) => { let c: THREE.Color | undefined; g.traverse(o => { if (!c && o instanceof THREE.Mesh) c = (o.material as THREE.MeshStandardMaterial).color; }); return c!; };

beforeAll(() => {
  vi.stubGlobal('location', { href: 'http://game.local/', origin: 'http://game.local' });
  vi.stubGlobal('fetch', async (url: URL) => {
    const bytes = new URL(url).origin === 'http://game.local' ? files.get(new URL(url).pathname) : undefined;
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  });
});
afterAll(() => { vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }); });

describe('every library model is changeable', () => {
  it('a game with no customization file loads the library model unchanged (an old game cannot break)', async () => {
    const m = await game('none', '');
    const car = await m.loadRequestedAsset('car', procedural);
    expect(car.source).toBe('model');
    expect(size(car.root).y).toBeCloseTo(1.4, 3);
  });
  it('resizes, recolours and makes see-through', async () => {
    const m = await game('look', `{ car: { height: 3, scale: 2, tint: '#00ff00', opacity: 0.5, offset: [0, 1, 0], shadows: false } }`);
    const car = await m.loadRequestedAsset('car', procedural);
    expect(size(car.root).y).toBeCloseTo(6, 3);
    const c = firstColor(car.root);
    expect(c.r).toBe(0); expect(c.g).toBeGreaterThan(0); expect(c.b).toBe(0);
    let mesh!: THREE.Mesh; car.root.traverse(o => { if (o instanceof THREE.Mesh) mesh = o; });
    expect((mesh.material as THREE.Material).opacity).toBe(0.5);
    expect(mesh.castShadow).toBe(false);
    expect(new THREE.Box3().setFromObject(car.root).min.y).toBeCloseTo(1, 3);
  });
  it('switches a subject to the code-built object', async () => {
    const m = await game('procedural', `{ car: { source: 'procedural' } }`);
    expect((await m.loadRequestedAsset('car', procedural)).source).toBe('procedural');
  });
  it('replaces a library model 100% with the project\'s own file, and adds a brand-new subject', async () => {
    const m = await game('own', `{ car: { source: { file: 'public/models/my-car.glb' }, height: 2 }, dragon: { source: { file: '/models/dragon.glb', sha256: '${sha(own)}' }, height: 6 } }`);
    const car = await m.loadRequestedAsset('car', procedural);
    expect(car.source).toBe('model'); expect(size(car.root).y).toBeCloseTo(2, 3);
    const dragon = await m.loadRequestedAsset('dragon', procedural);
    expect(dragon.source).toBe('model'); expect(size(dragon.root).y).toBeCloseTo(6, 3);
    expect(m.availableAssetSubjects().sort()).toEqual(['car', 'dragon']);
  });
  it.each([
    ['a path outside the project', `{ car: { source: { file: '../secret/x.glb' } } }`],
    ['another website', `{ car: { source: { file: 'https://evil.example/x.glb' } } }`],
    ['a missing file', `{ car: { source: { file: 'models/nope.glb' } } }`],
    ['a file whose pinned hash changed', `{ car: { source: { file: 'models/my-car.glb', sha256: '${'0'.repeat(64)}' } } }`],
    ['a file that is not a model', `{ car: { source: { file: 'models/my-car.png' } } }`],
  ])('falls back to the code-built object, never breaks, for %s', async (name, custom) => {
    const m = await game(`bad-${name.replace(/\W+/g, '-')}`, custom);
    expect((await m.loadRequestedAsset('car', procedural)).source).toBe('procedural');
  });
  it('ignores invalid values instead of breaking', async () => {
    const m = await game('invalid', `{ car: { height: -5, scale: Number.NaN, yaw: Infinity, tint: 'red', opacity: 'x', offset: [1, 2] } as never }`);
    const car = await m.loadRequestedAsset('car', procedural);
    expect(car.source).toBe('model'); expect(size(car.root).y).toBeCloseTo(1.4, 3);
  });
  it('colours one material by name and leaves the rest', async () => {
    const dir = join(root, 'helpers'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'externalAssets.ts'), generateGameAssetRuntime());
    const rt = await import(join(dir, 'externalAssets.ts'));
    const group = new THREE.Group(); const pivot = new THREE.Group(); group.add(pivot);
    const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Body', color: '#ffffff' }));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name: 'Glass', color: '#ffffff' }));
    pivot.add(body, glass);
    rt.applyGameAssetCustomization({ root: group, source: 'model', update() {}, dispose() {} }, { colors: { Body: '#ff0000' } });
    expect((body.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect((glass.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    const merged = rt.customizedGameAsset({ sha256: 'a'.repeat(64), height: 2, yaw: 0, hidden: ['Sword'], roles: { idle: 'Idle' } }, { yaw: 180, hide: ['Shield'], roles: { attack: 'Chop' }, animation: 'Run' });
    expect(merged.yaw).toBeCloseTo(Math.PI, 6);
    expect(merged.hidden).toEqual(['Sword', 'Shield']);
    expect(merged.roles).toEqual({ idle: 'Idle', attack: 'Chop' });
    expect(merged.animation).toBe('Run');
  });
  it('an unedited loader from before customizations is upgraded; an edited one is left alone', () => {
    const models = { car: { sha256: sha(library), height: 1.4, yaw: 0 } };
    const previous = previousAssetModelLoader(models);
    expect(previous).not.toContain('assetCustomizations');
    expect(upgradeAssetModelLoader(previous)).toBe(generateAssetModelLoader(models));
    expect(upgradeAssetModelLoader(generateAssetModelLoader(models))).toBeNull();
    expect(upgradeAssetModelLoader(previous.replace('return handle;', 'return handle; // mine'))).toBeNull();
  });
  it('the builder is told, in every later edit turn, where a change to a ready model goes', () => {
    expect(localModelLead('car')).toContain('src/game/three/assetCustomizations.ts');
    expect(localModelLead('car')).toMatch(/100% replacement/);
    expect(generateAssetCustomizations(['car'])).toContain("source: { file: 'public/models/my-car.glb' }");
  });
});
