/**
 * Admin 2026-11-21: "1000 module … 100 house, 100 tree, 100 vehicle, 100 humans … kya navbharatai pura alag world bana
 * dega?" → "ok models streaming banao". Every library model used to load at game start and stay until the end, each copy
 * its own draw calls, capped at 120 copies over 120 m. These run the EMITTED src/game/three/worldStreaming.ts with real
 * three.js objects and lock what makes a big world playable: only cells near the camera exist, each model loads once,
 * copies are instanced, far cells are lighter, animated copies are capped, collision marks survive, memory is freed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { generateWorldStreamingModule, GAME_WORLD_STREAMING_PATH, WORLD_STREAMING_HANDOFF } from '../src/server/lib/GameWorldStreamingGenerator';
import { gameCapabilityMenu } from '../src/server/AgentV3/gameAssets/gameCapabilities';

type Handle = { root: THREE.Group; source: 'model' | 'procedural'; update(dt: number): void; dispose(): void; play?(role: string): boolean };
type Streamer = {
  place(list: unknown[]): number; clear(): void; update(c: { x: number; z: number }, dt?: number): void; settled(): Promise<void>; dispose(): void;
  stats(): { placements: number; cells: number; liveCells: number; instancedMeshes: number; instances: number; actors: number; templates: number };
};
let mod: {
  createWorldStreamer(scene: THREE.Object3D, o: Record<string, unknown>): Streamer;
  cellsInView(cx: number, cz: number, r: number): Array<[number, number]>;
  detectStreamQuality(): string;
  STREAM_TIERS: Record<string, { viewRadius: number; maxActors: number }>;
};

beforeAll(() => {
  const js = ts.transpileModule(generateWorldStreamingModule(), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string) => {
    if (id === 'three') return THREE;
    if (id === './assetModels') return { loadRequestedAsset: () => { throw new Error('the tests pass their own loader'); } };
    throw new Error('unexpected import ' + id);
  };
  new Function('exports', 'require', js)(exports, req);
  mod = exports as typeof mod;
});

/** A loader that counts calls: 'house' has two parts (one a collider proxy, invisible) and a reduced LOD mesh; 'villager' is skinned. */
function fakeLibrary() {
  const loads: Record<string, number> = {}; const disposed: Record<string, number> = {}; const actorTicks: number[] = [];
  const mat = new THREE.MeshStandardMaterial();
  const load = async (subject: string): Promise<Handle> => {
    loads[subject] = (loads[subject] ?? 0) + 1;
    const root = new THREE.Group();
    const done = () => { disposed[subject] = (disposed[subject] ?? 0) + 1; };
    if (subject === 'house') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4, 8, 8, 8), mat); body.castShadow = true;
      const far = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), mat);
      const lod = new THREE.LOD(); lod.addLevel(body, 0); lod.addLevel(far, 40); lod.position.y = 1.5;
      body.userData.navbharatWorldCollider = 'solid';
      root.add(lod);
      return { root, source: 'model', update() {}, dispose: done };
    }
    if (subject === 'tree') {
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2), mat); crown.position.y = 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 3), new THREE.MeshBasicMaterial()); trunk.visible = false; trunk.userData.navbharatWorldCollider = 'solid';
      root.add(crown, trunk);
      return { root, source: 'model', update() {}, dispose: done };
    }
    if (subject === 'villager') {
      const bone = new THREE.Bone(); const geo = new THREE.BoxGeometry();
      const skinned = new THREE.SkinnedMesh(geo, mat); skinned.add(bone); skinned.bind(new THREE.Skeleton([bone]));
      root.add(skinned);
      return { root, source: 'model', update(dt) { actorTicks.push(dt); }, dispose: done, play: () => true };
    }
    if (subject === 'broken') throw new Error('network');
    return { root, source: 'procedural', update() {}, dispose: done };
  };
  return { load, loads, disposed, actorTicks };
}

/** A seeded grid world: 2000+ copies over 2.5 km. */
function world(count = 2400): Array<{ subject: string; x: number; z: number; yaw: number }> {
  let s = 7; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  return Array.from({ length: count }, (_, i) => ({ subject: i % 10 === 0 ? 'villager' : i % 2 ? 'tree' : 'house', x: (r() - 0.5) * 2500, z: (r() - 0.5) * 2500, yaw: r() * 6 }));
}
const tier = { viewRadius: 2, farRing: 2, maxBuildsPerUpdate: 100, maxActors: 6, maxTemplates: 8 };

describe('a big world streams: only what is near the camera exists', () => {
  it('2400 placements over 2.5 km: only the cells around the camera are built, and each model is loaded ONCE', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier, cellSize: 64 });
    expect(w.place(world())).toBe(2400);
    w.update({ x: 0, z: 0 }); await w.settled();
    const s = w.stats();
    expect(s.placements).toBe(2400);
    expect(s.liveCells).toBeGreaterThan(0);
    expect(s.liveCells).toBeLessThanOrEqual(25); // (2·2+1)²
    expect(s.instances).toBeLessThan(400);       // a few hundred near the camera, not 2400
    expect(lib.loads.house).toBe(1);
    expect(lib.loads.tree).toBe(1);
    // Copies are drawn together: per live cell, at most one InstancedMesh per part of each static model.
    expect(s.instancedMeshes).toBeLessThanOrEqual(s.liveCells * 3);
    const houses = scene.getObjectsByProperty('name', 'house') as THREE.InstancedMesh[];
    expect(houses.length).toBeGreaterThan(0);
    expect(houses.every((m) => m.isInstancedMesh && m.count >= 1)).toBe(true);
    expect(houses.reduce((n, m) => n + m.count, 0)).toBeGreaterThan(houses.length); // several houses share one draw
  });

  it('walking away frees the cells behind (GPU buffers disposed) and builds the ones ahead; one ring of slack stops border thrash', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier, cellSize: 64 });
    w.place(world());
    w.update({ x: 0, z: 0 }); await w.settled();
    const before = scene.getObjectsByProperty('name', 'house') as THREE.InstancedMesh[];
    let freed = 0; for (const m of before) m.addEventListener('dispose', () => { freed++; });
    w.update({ x: 64, z: 0 }); await w.settled(); // one cell over: inside the slack
    expect(freed).toBe(0);
    w.update({ x: 1000, z: 1000 }); await w.settled();
    expect(freed).toBe(before.length);
    const inScene = (o: THREE.Object3D) => { let p: THREE.Object3D | null = o; while (p && p !== scene) p = p.parent; return p === scene; };
    for (const m of before) expect(inScene(m)).toBe(false);
    expect(w.stats().liveCells).toBeLessThanOrEqual(25);
    expect(lib.loads.house).toBe(1); // the model stayed in memory: walking does not re-download it
  });

  it('far cells use the reduced mesh and swap to full detail as the camera comes near — no rebuild', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier: { ...tier, viewRadius: 3 }, cellSize: 64 });
    w.place([{ subject: 'house', x: 64 * 2 + 10, z: 10 }]);
    w.update({ x: 10, z: 10 }); await w.settled();
    const [house] = scene.getObjectsByProperty('name', 'house') as THREE.InstancedMesh[];
    const farCount = house.geometry.getAttribute('position').count;
    w.update({ x: 64 * 2 + 10, z: 10 });
    const [same] = scene.getObjectsByProperty('name', 'house') as THREE.InstancedMesh[];
    expect(same).toBe(house);
    expect(same.geometry.getAttribute('position').count).toBeGreaterThan(farCount);
  });

  it('animated copies each get their own model, only near the camera, capped for the device, and are ticked and freed', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier, cellSize: 64 });
    w.place(Array.from({ length: 40 }, (_, i) => ({ subject: 'villager', x: i, z: 0, role: 'walk' })));
    w.update({ x: 0, z: 0 }); await w.settled();
    expect(w.stats().actors).toBe(6);
    w.update({ x: 0, z: 0 }, 0.016);
    expect(lib.actorTicks).toHaveLength(6);
    w.update({ x: 5000, z: 0 }); await w.settled();
    expect(w.stats().actors).toBe(0);
    expect(lib.disposed.villager).toBe(7); // the probe + the six copies
  });

  it('collision survives instancing: solid parts carry the mark, and an invisible collider proxy stays invisible', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier, cellSize: 64 });
    w.place([{ subject: 'tree', x: 5, z: 5 }, { subject: 'tree', x: 9, z: 5 }, { subject: 'house', x: 20, z: 20 }]);
    w.update({ x: 0, z: 0 }); await w.settled();
    const trees = scene.getObjectsByProperty('name', 'tree') as THREE.InstancedMesh[];
    const trunk = trees.find((m) => m.userData.navbharatWorldCollider === 'solid')!;
    expect(trunk.visible).toBe(false);
    expect(trunk.count).toBe(2);
    const m = new THREE.Matrix4(); trunk.getMatrixAt(1, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBeCloseTo(9);
    expect((scene.getObjectsByProperty('name', 'house') as THREE.InstancedMesh[]).every((h) => h.userData.navbharatWorldCollider === 'solid')).toBe(true);
    // The kit's collision tests every instance of an InstancedMesh (the reason a mark on it is enough).
    expect(readFileSync('src/server/lib/Game3DGenerator.ts', 'utf8')).toMatch(/if \(!batch\.isInstancedMesh\) return \[shapeAt/);
  });

  it('models no live cell uses are freed past the device budget; a model that fails to load is simply not placed', async () => {
    const lib = fakeLibrary(); const scene = new THREE.Scene();
    const w = mod.createWorldStreamer(scene, { load: lib.load, tier: { ...tier, maxTemplates: 1 }, cellSize: 64 });
    w.place([{ subject: 'house', x: 1, z: 1 }, { subject: 'tree', x: 3000, z: 1 }, { subject: 'broken', x: 2, z: 2 }]);
    w.update({ x: 0, z: 0 }); await w.settled();
    expect(w.stats().templates).toBe(1);
    w.update({ x: 3000, z: 0 }); await w.settled();
    expect(lib.disposed.house).toBe(1); // freed: no cell uses it and the budget is one model
    expect(w.stats().templates).toBe(1);
    w.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('a fast camera builds at most maxBuildsPerUpdate cells per frame', () => {
    const lib = fakeLibrary(); const w = mod.createWorldStreamer(new THREE.Scene(), { load: lib.load, tier: { ...tier, maxBuildsPerUpdate: 1 }, cellSize: 64 });
    w.place(world());
    w.update({ x: 0, z: 0 });
    expect(Object.values(lib.loads).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3);
  });

  it('cells are visited nearest first; a device without browser hints is mid; phones get the smallest budget', () => {
    const cells = mod.cellsInView(0, 0, 2);
    expect(cells).toHaveLength(25);
    expect(cells[0]).toEqual([0, 0]);
    expect(Math.max(Math.abs(cells[24][0]), Math.abs(cells[24][1]))).toBe(2);
    expect(['phone', 'mid', 'desktop']).toContain(mod.detectStreamQuality());
    expect(mod.STREAM_TIERS.phone.maxActors).toBeLessThan(mod.STREAM_TIERS.desktop.maxActors);
    expect(mod.STREAM_TIERS.phone.viewRadius).toBeLessThan(mod.STREAM_TIERS.desktop.viewRadius);
  });
});

describe('every game that gets library models also gets streaming, and the builder is told when to use it', () => {
  it('the asset seed writes the module once (a later turn keeps the game\'s copy) and hands the builder the rule', () => {
    const seed = readFileSync('src/server/AgentV3/gameAssets/assetSeed.ts', 'utf8');
    expect(seed).toMatch(/\.\.\.\(existing\?\.streaming \? \{\} : \{ \[GAME_WORLD_STREAMING_PATH\]: generateWorldStreamingModule\(\) \}\)/);
    expect(seed).toMatch(/\$\{WORLD_STREAMING_HANDOFF\}/);
    const dispatcher = readFileSync('src/server/AgentV3/ToolDispatcher.ts', 'utf8');
    expect(dispatcher).toMatch(/streaming: await read\(GAME_WORLD_STREAMING_PATH\)/);
    expect(GAME_WORLD_STREAMING_PATH).toBe('src/game/three/worldStreaming.ts');
    expect(WORLD_STREAMING_HANDOFF).toMatch(/Use a FEW models many times/);
  });

  it('a big world is an outcome in the intent map, whatever words ask for it', () => {
    expect(gameCapabilityMenu()).toMatch(/- big-world: .*createWorldStreamer/);
  });
});
