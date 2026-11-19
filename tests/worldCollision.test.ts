import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGameAssetRuntime } from '../src/server/lib/GameAssetRuntimeGenerator';
import { GAME_ASSET_MODELS_PATH, generateAssetModelLoader } from '../src/server/lib/GameAssetRuntimeGenerator';
import { planKitRefresh } from '../src/server/lib/gameRecipeLayers';

const fixture = join(__dirname, `.tmp-world-contact-${process.pid}`);
const models = { tree: { sha256: 'a'.repeat(64), height: 4, yaw: 0 }, house: { sha256: 'b'.repeat(64), height: 4, yaw: 0.2 } };
const legacyLoader = `import { loadGameAsset, type GameAssetHandle, type LocalGameAsset } from './externalAssets';
const assets: Record<string, LocalGameAsset> = ${JSON.stringify(models)};
export function loadRequestedAsset(subject: string, fallback: () => GameAssetHandle, signal?: AbortSignal): Promise<GameAssetHandle> {
  return assets[subject] ? loadGameAsset(assets[subject], fallback, signal) : Promise.resolve(fallback());
}
`;
const current3DKit = generateGame3D().files;
// These modules are written by the recipes at test time.
/* eslint-disable @typescript-eslint/no-explicit-any */
let world: any;
let objects: any;
let collision: any;
let character: any;

beforeAll(async () => {
  for (const { files } of [generateGameRuntime(), generateGame3D(), generateGameController()]) {
    for (const [path, source] of Object.entries(files)) {
      const file = join(fixture, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, source);
    }
  }
  world = await import(join(fixture, 'src/game/three/world.ts'));
  objects = await import(join(fixture, 'src/game/three/objects.ts'));
  collision = await import(join(fixture, 'src/game/three/collision.ts'));
  character = await import(join(fixture, 'src/game/play/character.ts'));
  writeFileSync(join(fixture, 'src/game/three/externalAssets.ts'), `import * as THREE from 'three';
export async function loadGameAsset(asset: { height: number }) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, asset.height, 3));
  body.position.y = asset.height / 2;
  root.add(body);
  return { root, source: 'model' };
}
// The real runtime's customization helpers (2026-11-19); this stand-in leaves models unchanged.
export const customizedGameAsset = (asset: unknown) => asset;
export const applyGameAssetCustomization = () => {};
export const loadOwnGameAsset = loadGameAsset;
`);
});
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const still = { moveX: 0, moveZ: 0, sprint: false, jumpPressed: false, jumpHeld: false };
const forward = { ...still, moveZ: 1 };

function box(width: number, height: number, depth: number, x: number, bottom: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
  mesh.position.set(x, bottom + height / 2, z);
  return mesh;
}

function setup() {
  const scene = new THREE.Scene();
  scene.add(world.createTerrain({ size: 100, flat: true, segments: 8 }));
  const player = new character.CharacterController();
  scene.add(player.object);
  return { scene, player };
}

function walk(player: { update: (delta: number, input: typeof still) => void }, frames: number, input = forward): void {
  for (let frame = 0; frame < frames; frame++) player.update(1 / 60, input);
}

describe('contact in the generated 3D kit', () => {
  it('stops at a late, rotated building and releases its collider when it leaves the scene', () => {
    const { scene, player } = setup();
    walk(player, 1, still);
    const district = new THREE.Group();
    district.position.z = 6;
    district.rotation.y = 0.2;
    district.add(objects.createHouse({ width: 5, depth: 4, roof: 'flat', detail: 'lite' }));
    scene.add(district);
    walk(player, 100);
    expect(player.object.position.z).toBeGreaterThan(3);
    expect(player.object.position.z).toBeLessThan(4);
    expect(player.speed).toBeLessThan(0.1);

    scene.remove(district);
    walk(player, 100);
    expect(player.object.position.z).toBeGreaterThan(8);
  });

  it('hits a tree trunk and leaves the space under the canopy open', () => {
    const { scene, player } = setup();
    const tree = objects.createTree({ height: 6, detail: 'lite' });
    tree.position.z = 5;
    scene.add(tree);
    walk(player, 90);
    expect(player.object.position.z).toBeLessThan(4.6);

    player.reset(1.2, 0, 0);
    walk(player, 90);
    expect(player.object.position.z).toBeGreaterThan(6);
  });

  it('uses the instance matrix for a scattered tree trunk', () => {
    const { scene, player } = setup();
    const forest = world.scatterInstances(world.treeGeometry(), new THREE.MeshBasicMaterial(), { count: 1, area: 10 });
    forest.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 5));
    forest.instanceMatrix.needsUpdate = true;
    scene.add(forest);
    walk(player, 90);
    expect(player.object.position.z).toBeLessThan(4.6);
    expect(player.object.position.z).toBeGreaterThan(4);
  });

  it('upgrades a saved asset loader and keeps collision when an asynchronously loaded model is cloned', async () => {
    // A game whose runtime is the current one: the loader may be upgraded to match it.
    const savedProject = { ...current3DKit, [GAME_ASSET_MODELS_PATH]: legacyLoader, 'src/game/three/externalAssets.ts': generateGameAssetRuntime() };
    const refresh = planKitRefresh(savedProject);
    expect(refresh.refreshed).toEqual([GAME_ASSET_MODELS_PATH]);
    const upgraded = refresh.write[GAME_ASSET_MODELS_PATH];
    expect(upgraded).toBe(generateAssetModelLoader(models));
    expect(planKitRefresh({ ...savedProject, ...refresh.write }).write).toEqual({});
    const assetFile = join(fixture, GAME_ASSET_MODELS_PATH);
    writeFileSync(assetFile, upgraded);
    const assetModels = await import(assetFile);
    const { scene, player } = setup();
    const fallback = () => { throw new Error('Expected a local asset'); };
    const tree = await assetModels.loadRequestedAsset('tree', fallback);
    const house = await assetModels.loadRequestedAsset('house', fallback);
    const treeClone = tree.root.clone(true);
    const houseClone = house.root.clone(true);
    treeClone.position.z = 4;
    houseClone.position.set(3, 0, 4);
    scene.add(treeClone, houseClone);
    walk(player, 85);
    expect(player.object.position.z).toBeLessThan(3.6);
    player.reset(3, 0, 0);
    walk(player, 85);
    expect(player.object.position.z).toBeLessThan(2.2);
  });

  it('an OLDER game whose runtime lacks the new exports keeps its old loader — the pair must match, or the game would not compile', () => {
    const olderRuntime = generateGameAssetRuntime()
      .replace(/export function customizedGameAsset/, 'function customizedGameAsset')
      .replace(/export function applyGameAssetCustomization/, 'function applyGameAssetCustomization')
      .replace(/export async function loadOwnGameAsset/, 'async function loadOwnGameAsset');
    const plan = planKitRefresh({ ...current3DKit, [GAME_ASSET_MODELS_PATH]: legacyLoader, 'src/game/three/externalAssets.ts': olderRuntime });
    expect(plan.write[GAME_ASSET_MODELS_PATH]).toBeUndefined();
    expect(planKitRefresh({ ...current3DKit, [GAME_ASSET_MODELS_PATH]: legacyLoader }).write[GAME_ASSET_MODELS_PATH]).toBeUndefined();
  });

  it('keeps an edited asset loader and a project with its own physics intact', () => {
    const edited = legacyLoader.replace('Promise.resolve(fallback())', 'Promise.resolve(fallback()).then(asset => asset)');
    expect(planKitRefresh({ ...current3DKit, [GAME_ASSET_MODELS_PATH]: edited }).write).toEqual({});
    expect(planKitRefresh({ [GAME_ASSET_MODELS_PATH]: legacyLoader }).write).toEqual({});
  });

  it('leaves an open doorway and a non-solid trigger passable', () => {
    const { scene, player } = setup();
    const doorway = new THREE.Group();
    doorway.add(box(2, 3, 0.3, -2, 0, 3), box(2, 3, 0.3, 2, 0, 3), box(2, 0.8, 0.3, 0, 2.2, 3));
    scene.add(collision.markWorldCollider(doorway), collision.markWorldCollider(box(1, 3, 1, 0, 0, 4), 'none'));
    walk(player, 85);
    expect(player.object.position.z).toBeGreaterThan(5);
  });

  it('climbs successive low stairs and slides along a taller thin wall', () => {
    const { scene, player } = setup();
    for (let step = 1; step <= 3; step++) {
      scene.add(collision.markWorldCollider(box(6, step * 0.2, 1.2, 0, 0, 1.4 + step * 1.2)));
    }
    scene.add(collision.markWorldCollider(box(10, 1.2, 0.025, 0, 0.6, 5.5)));
    walk(player, 85);
    expect(player.object.position.y).toBeCloseTo(0.6, 2);
    expect(player.object.position.z).toBeGreaterThan(4.5);
    expect(player.object.position.z).toBeLessThan(5.2);
    walk(player, 22, { ...forward, moveX: 1 });
    expect(player.object.position.x).toBeGreaterThan(1);
    expect(player.object.position.z).toBeLessThan(5.3);
  });

  it('allows a walkable slope and blocks movement into a steeper slope', () => {
    const { scene, player } = setup();
    const ramp = new THREE.Mesh(new THREE.PlaneGeometry(12, 8));
    ramp.rotation.x = -Math.PI / 2 - Math.PI / 9;
    ramp.position.set(0, 4 * Math.sin(Math.PI / 9), 2 + 4 * Math.cos(Math.PI / 9));
    scene.add(collision.markWorldCollider(ramp));
    walk(player, 60);
    expect(player.object.position.z).toBeGreaterThan(3);
    expect(player.object.position.y).toBeGreaterThan(0.35);

    const steep = new THREE.Mesh(new THREE.PlaneGeometry(12, 8));
    steep.rotation.x = -Math.PI / 2 - Math.PI / 2.8;
    steep.position.set(0, 4 * Math.sin(Math.PI / 2.8), 2 + 4 * Math.cos(Math.PI / 2.8));
    ramp.removeFromParent();
    scene.add(collision.markWorldCollider(steep));
    player.reset();
    walk(player, 90);
    expect(player.object.position.z).toBeLessThan(2.15);
    expect(player.object.position.y).toBeLessThan(0.15);
  });

  it('follows the actual surface of a procedural mountain on foot', () => {
    const { scene, player } = setup();
    const mountain = objects.createMountain({ size: 22, height: 4, detail: 'lite' });
    mountain.position.z = 14;
    scene.add(mountain);
    walk(player, 120);
    const position = player.object.position;
    expect(position.z).toBeGreaterThan(8);
    const down = new THREE.Raycaster(new THREE.Vector3(position.x, 20, position.z), new THREE.Vector3(0, -1, 0));
    const surface = down.intersectObject(mountain)[0]?.point.y ?? 0;
    expect(surface).toBeGreaterThan(0.5);
    expect(position.y).toBeCloseTo(surface, 2);
  });

  it('stops a jump below a low ceiling and lands on a platform after a long drop', () => {
    const { scene, player } = setup();
    const ceiling = collision.markWorldCollider(box(5, 0.1, 5, 0, 2.05, 0));
    scene.add(ceiling);
    player.update(1 / 60, { ...still, jumpPressed: true, jumpHeld: true });
    let apex = 0;
    for (let i = 0; i < 35; i++) {
      walk(player, 1, { ...still, jumpHeld: true });
      apex = Math.max(apex, player.object.position.y);
    }
    expect(apex).toBeGreaterThan(0.18);
    expect(apex).toBeLessThan(0.27);
    player.reset(0, 35, 0);
    walk(player, 200, still);
    expect(player.object.position.y).toBeCloseTo(2.15, 3);
  });

  it('stops a fast car before a thin custom wall and allows it to reverse', () => {
    const { scene } = setup();
    const car = objects.createCar({ detail: 'lite' });
    const barrier = box(18, 3, 0.025, 0, 0, 7);
    scene.add(car, barrier);
    collision.setSceneColliders(scene, [barrier]);
    const tuning = { ground: false as const, maxSpeed: 200, startSpeed: 180 };
    const state = objects.createVehicleState(car, tuning);
    objects.driveVehicle(car, state, { x: 0, y: -1 }, 0.25, tuning);
    const stop = car.position.z;
    expect(stop).toBeGreaterThan(0);
    expect(stop).toBeLessThan(6);
    expect(state.speed).toBe(0);
    for (let i = 0; i < 35; i++) objects.driveVehicle(car, state, { x: 0, y: 1 }, 1 / 60, tuning);
    expect(car.position.z).toBeLessThan(stop - 0.2);
  });

  it('stops a driven vehicle before it crosses a solid mountain', () => {
    const { scene } = setup();
    const car = objects.createCar({ detail: 'lite' });
    const mountain = objects.createMountain({ size: 18, height: 10, detail: 'lite' });
    mountain.position.z = 13;
    scene.add(car, mountain);
    const tuning = { ground: false as const, maxSpeed: 200, startSpeed: 160 };
    const state = objects.createVehicleState(car, tuning);
    objects.driveVehicle(car, state, { x: 0, y: -1 }, 0.25, tuning);
    expect(car.position.z).toBeGreaterThan(2);
    expect(car.position.z).toBeLessThan(10);
    expect(state.speed).toBe(0);
  });
});
