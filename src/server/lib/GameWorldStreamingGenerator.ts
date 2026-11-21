/**
 * MODEL STREAMING — a big world that still runs on a phone (admin 2026-11-21: "1000 module … 100 house, 100 tree, 100
 * vehicle, 100 humans … kya navbharatai pura alag world bana dega?" → "ok models streaming banao").
 *
 * 🔴 WHAT WAS THERE. Every library model in a game was loaded the moment the game started and kept until it ended:
 * `dressWorld` cloned at most 120 copies over 120 m, each copy its own set of draw calls, and the terrain was the only
 * thing that streamed (athreeMap). A world of a few thousand houses, trees and people therefore either did not fit
 * (the cap) or did not run (a phone drawing thousands of separate meshes). The size of a world was capped by the
 * device, not by what the user asked for.
 *
 * WHAT THIS WRITES: `src/game/three/worldStreaming.ts` in the user's game. `createWorldStreamer(scene)` takes any number
 * of placements (`place([{ subject, x, z, yaw, scale }])`) and, every frame, `update(cameraPosition, dt)`:
 *   - splits the world into square cells and keeps ONLY the cells near the camera in the scene; a cell that falls
 *     behind (with one ring of slack, so walking along a border does not thrash) leaves the scene and frees its GPU
 *     buffers;
 *   - loads each MODEL once (one fetch, one parse) however many copies stand in the world, and draws every copy of a
 *     static model in one cell as ONE InstancedMesh per part — 200 trees cost the draw calls of one tree;
 *   - far cells use the reduced mesh the loader already made (THREE.LOD level 1) and swap to full detail as the camera
 *     comes near, without rebuilding anything;
 *   - animated models (people, animals) cannot be instanced — each needs its own skeleton — so each is its own handle,
 *     only near the camera, and at most `maxActors` at once for the device;
 *   - models no cell uses any more are freed, least recently used first, past the device's `maxTemplates`;
 *   - collision is kept: instanced parts carry the kit's collider mark, and the kit's collision already tests every
 *     instance of an InstancedMesh (Game3DGenerator COLLISION → shapesFor).
 * Budgets come from the device (phone / mid / desktop), like the terrain's. A model that does not arrive is not
 * placed — never an unrelated substitute.
 *
 * PURE generator: no I/O, no model call.
 */
export const GAME_WORLD_STREAMING_PATH = 'src/game/three/worldStreaming.ts';

const MODULE = String.raw`// World streaming — written by NavBharatAI. A world of any size: only what is near the camera is loaded and drawn.
//   const world = createWorldStreamer(scene, { heightAt });
//   world.place([{ subject: 'house', x: 120, z: -40, yaw: 1.2 }, { subject: 'tree', x: 300, z: 15 }, …]);  // thousands are fine
//   every frame: world.update(camera.position, dt);   on teardown: world.dispose();
// Subjects are the ones loadRequestedAsset serves (library models and the game's own models in assetCustomizations.ts).
import * as THREE from 'three';
import { loadRequestedAsset } from './assetModels';
import type { GameAssetHandle } from './externalAssets';

export type StreamQuality = 'phone' | 'mid' | 'desktop';
export interface StreamTier {
  /** Cells kept in each direction from the camera's cell. */
  viewRadius: number;
  /** Cells at this ring or further use the reduced mesh when the model has one. */
  farRing: number;
  /** New cells built per update, so a fast camera never stalls one frame. */
  maxBuildsPerUpdate: number;
  /** Animated models alive at once (each has its own skeleton and mixer). */
  maxActors: number;
  /** Distinct models kept in memory; unused ones past this are freed. */
  maxTemplates: number;
}
export const STREAM_TIERS: Readonly<Record<StreamQuality, StreamTier>> = {
  phone: { viewRadius: 3, farRing: 2, maxBuildsPerUpdate: 1, maxActors: 12, maxTemplates: 24 },
  mid: { viewRadius: 4, farRing: 2, maxBuildsPerUpdate: 2, maxActors: 24, maxTemplates: 48 },
  desktop: { viewRadius: 6, farRing: 3, maxBuildsPerUpdate: 3, maxActors: 48, maxTemplates: 96 },
};

export interface Placement {
  subject: string;
  x: number;
  z: number;
  /** Ground height; when absent, heightAt(x, z) or 0. */
  y?: number;
  /** Turn in radians. */
  yaw?: number;
  /** Multiplies the model's own size. */
  scale?: number;
  /** Animated models: the role to play on arrival (e.g. 'walk', 'idle'). */
  role?: string;
}
export interface StreamerOptions {
  quality?: StreamQuality;
  /** Overrides the tier's numbers. */
  tier?: Partial<StreamTier>;
  /** Cell side in metres. */
  cellSize?: number;
  heightAt?: (x: number, z: number) => number;
  signal?: AbortSignal;
  /** Loader seam (tests, or a game with its own loader). */
  load?: (subject: string, signal?: AbortSignal) => Promise<GameAssetHandle>;
}
export interface StreamStats { placements: number; cells: number; liveCells: number; instancedMeshes: number; instances: number; actors: number; templates: number }
export interface WorldStreamer {
  place(list: readonly Placement[]): number;
  clear(): void;
  update(camera: { x: number; z: number }, dt?: number): void;
  stats(): StreamStats;
  /** Resolves when every wanted cell near the camera is built (loading screens, tests). */
  settled(): Promise<void>;
  dispose(): void;
}

/** The device class, from what the browser reports. Unknown → mid. */
export function detectStreamQuality(): StreamQuality {
  const nav = (globalThis as { navigator?: Navigator & { deviceMemory?: number } }).navigator;
  if (!nav) return 'mid';
  const coarse = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(pointer: coarse)').matches;
  const memory = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (coarse || memory <= 3 || cores <= 4) return coarse && memory >= 8 && cores >= 8 ? 'mid' : 'phone';
  return memory >= 8 && cores >= 8 ? 'desktop' : 'mid';
}

const cellKey = (cx: number, cz: number) => cx + ',' + cz;
/** Chebyshev ring of a cell around the camera's cell. PURE. */
export const ringOf = (cx: number, cz: number, camX: number, camZ: number) => Math.max(Math.abs(cx - camX), Math.abs(cz - camZ));
/** Cells within radius of (cx, cz), nearest first. PURE. */
export function cellsInView(cx: number, cz: number, radius: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) out.push([cx + dx, cz + dz]);
  return out.sort((a, b) => ringOf(a[0], a[1], cx, cz) - ringOf(b[0], b[1], cx, cz));
}

interface Part { geometry: THREE.BufferGeometry; far?: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4; collider?: unknown; visible: boolean; shadows: boolean }
interface Template { handle: GameAssetHandle | null; parts: Part[]; actor: boolean; users: number; lastUsed: number }
interface Cell { cx: number; cz: number; items: Placement[]; group: THREE.Group | null; meshes: Array<{ mesh: THREE.InstancedMesh; part: Part }>; actors: GameAssetHandle[]; far: boolean; building: boolean; subjects: Set<string> }

const COLLIDER_KEY = 'navbharatWorldCollider';

/** Split a loaded model into instanceable parts (full-detail meshes; the LOD's reduced mesh kept as 'far'). */
function partsOf(root: THREE.Object3D): { parts: Part[]; actor: boolean } {
  let actor = false;
  const parts: Part[] = [];
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  root.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) actor = true;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Object.values(mesh.geometry.morphAttributes ?? {}).some((list) => list.length)) actor = true;
    const lod = mesh.parent as THREE.LOD | null;
    if (lod?.isLOD && lod.levels[0]?.object !== mesh) return; // reduced levels are attached to level 0 below
    const reduced = lod?.isLOD ? (lod.levels[1]?.object as THREE.Mesh | undefined) : undefined;
    let collider: unknown;
    for (let o: THREE.Object3D | null = mesh; o && o !== root.parent; o = o.parent) if (o.userData[COLLIDER_KEY] !== undefined) { collider = o.userData[COLLIDER_KEY]; break; }
    parts.push({
      geometry: mesh.geometry, far: reduced?.isMesh ? reduced.geometry : undefined, material: mesh.material,
      matrix: inverse.clone().multiply(mesh.matrixWorld), collider, visible: mesh.visible, shadows: mesh.castShadow,
    });
  });
  return { parts, actor };
}

const placementMatrix = (p: Placement, y: number) => new THREE.Matrix4().compose(
  new THREE.Vector3(p.x, y, p.z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Number.isFinite(p.yaw) ? p.yaw! : 0),
  new THREE.Vector3().setScalar(Number.isFinite(p.scale) && p.scale! > 0 ? p.scale! : 1),
);

export function createWorldStreamer(scene: THREE.Object3D, options: StreamerOptions = {}): WorldStreamer {
  const tier: StreamTier = { ...STREAM_TIERS[options.quality ?? detectStreamQuality()], ...(options.tier ?? {}) };
  const size = Number.isFinite(options.cellSize) && options.cellSize! > 0 ? options.cellSize! : 64;
  const load = options.load ?? ((subject: string, signal?: AbortSignal) => loadRequestedAsset(subject, () => ({ root: new THREE.Group(), source: 'procedural', update() {}, dispose() {} }), signal));
  const cells = new Map<string, Cell>();
  const templates = new Map<string, Promise<Template | null>>();
  const ready = new Map<string, Template>();
  const root = new THREE.Group(); root.name = 'world-streaming';
  scene.add(root);
  let placements = 0, clock = 0, liveActors = 0, camX = 0, camZ = 0, disposed = false;
  const pending = new Set<Promise<void>>();

  const template = (subject: string): Promise<Template | null> => {
    let t = templates.get(subject);
    if (!t) {
      t = load(subject, options.signal).then((handle) => {
        if (handle.source !== 'model') { handle.dispose(); return null; }
        const { parts, actor } = partsOf(handle.root);
        const out: Template = { handle: actor ? null : handle, parts, actor, users: 0, lastUsed: clock };
        if (actor) handle.dispose(); // actors load one handle per copy; the probe is not kept
        ready.set(subject, out);
        return out;
      }).catch(() => null);
      templates.set(subject, t);
    }
    return t;
  };

  const evict = () => {
    if (ready.size <= tier.maxTemplates) return;
    const idle = [...ready].filter(([, t]) => t.users === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [subject, t] of idle) {
      if (ready.size <= tier.maxTemplates) break;
      t.handle?.dispose();
      ready.delete(subject); templates.delete(subject);
    }
  };

  const unload = (cell: Cell) => {
    if (cell.group) { cell.group.removeFromParent(); for (const { mesh } of cell.meshes) mesh.dispose(); }
    for (const a of cell.actors) a.dispose();
    liveActors -= cell.actors.length;
    for (const s of cell.subjects) { const t = ready.get(s); if (t) { t.users--; t.lastUsed = clock; } }
    cell.group = null; cell.meshes = []; cell.actors = []; cell.subjects = new Set();
  };

  const build = async (cell: Cell) => {
    cell.building = true;
    const bySubject = new Map<string, Placement[]>();
    for (const p of cell.items) { const list = bySubject.get(p.subject) ?? []; list.push(p); bySubject.set(p.subject, list); }
    const group = new THREE.Group(); group.name = 'cell ' + cellKey(cell.cx, cell.cz);
    const meshes: Cell['meshes'] = []; const actors: GameAssetHandle[] = []; const used = new Set<string>();
    const wanted = () => !disposed && ringOf(cell.cx, cell.cz, camX, camZ) <= tier.viewRadius + 1;
    for (const [subject, list] of bySubject) {
      const t = await template(subject);
      if (!t || !wanted()) continue;
      used.add(subject); t.users++; t.lastUsed = clock;
      if (t.actor) {
        for (const p of list) {
          if (liveActors >= tier.maxActors) break;
          liveActors++;
          const handle = await load(subject, options.signal).catch(() => null);
          if (!handle || handle.source !== 'model' || !wanted()) { liveActors--; handle?.dispose(); continue; }
          handle.root.applyMatrix4(placementMatrix(p, p.y ?? options.heightAt?.(p.x, p.z) ?? 0));
          if (p.role) handle.play?.(p.role);
          group.add(handle.root); actors.push(handle);
        }
        continue;
      }
      const matrices = list.map((p) => placementMatrix(p, p.y ?? options.heightAt?.(p.x, p.z) ?? 0));
      for (const part of t.parts) {
        const mesh = new THREE.InstancedMesh(cell.far && part.far ? part.far : part.geometry, part.material, matrices.length);
        const m = new THREE.Matrix4();
        matrices.forEach((placed, i) => mesh.setMatrixAt(i, m.multiplyMatrices(placed, part.matrix)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere(); mesh.computeBoundingBox();
        mesh.visible = part.visible; mesh.castShadow = part.shadows; mesh.receiveShadow = true;
        if (part.collider !== undefined) mesh.userData[COLLIDER_KEY] = part.collider;
        mesh.name = subject;
        group.add(mesh); meshes.push({ mesh, part });
      }
    }
    cell.building = false;
    if (!wanted()) {
      for (const { mesh } of meshes) mesh.dispose();
      for (const a of actors) a.dispose();
      liveActors -= actors.length;
      for (const s of used) { const t = ready.get(s); if (t) t.users--; }
      return;
    }
    cell.group = group; cell.meshes = meshes; cell.actors = actors; cell.subjects = used;
    root.add(group);
    evict();
  };

  const setDetail = (cell: Cell, far: boolean) => {
    if (cell.far === far) return;
    cell.far = far;
    for (const { mesh, part } of cell.meshes) if (part.far) { mesh.geometry = far ? part.far : part.geometry; mesh.computeBoundingSphere(); mesh.computeBoundingBox(); }
  };

  return {
    place(list) {
      let added = 0;
      for (const p of list) {
        if (!p || typeof p.subject !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        const cx = Math.floor(p.x / size), cz = Math.floor(p.z / size), key = cellKey(cx, cz);
        let cell = cells.get(key);
        if (!cell) { cell = { cx, cz, items: [], group: null, meshes: [], actors: [], far: false, building: false, subjects: new Set() }; cells.set(key, cell); }
        cell.items.push({ ...p });
        if (cell.group) { unload(cell); } // rebuilt with the new placement on the next update
        added++;
      }
      placements += added;
      return added;
    },
    clear() { for (const cell of cells.values()) unload(cell); cells.clear(); placements = 0; },
    update(camera, dt = 0) {
      if (disposed || !Number.isFinite(camera.x) || !Number.isFinite(camera.z)) return;
      clock++;
      camX = Math.floor(camera.x / size); camZ = Math.floor(camera.z / size);
      for (const cell of cells.values()) {
        const ring = ringOf(cell.cx, cell.cz, camX, camZ);
        if (cell.group && ring > tier.viewRadius + 1) unload(cell);
        else if (cell.group) setDetail(cell, ring >= tier.farRing);
      }
      let builds = 0;
      for (const [cx, cz] of cellsInView(camX, camZ, tier.viewRadius)) {
        if (builds >= tier.maxBuildsPerUpdate) break;
        const cell = cells.get(cellKey(cx, cz));
        if (!cell || cell.group || cell.building) continue;
        cell.far = ringOf(cx, cz, camX, camZ) >= tier.farRing;
        const job = build(cell).finally(() => pending.delete(job));
        pending.add(job); builds++;
      }
      if (dt > 0) for (const cell of cells.values()) for (const a of cell.actors) a.update(dt);
    },
    stats() {
      let liveCells = 0, instancedMeshes = 0, instances = 0, actors = 0;
      for (const cell of cells.values()) {
        if (cell.group) liveCells++;
        instancedMeshes += cell.meshes.length;
        for (const { mesh, part } of cell.meshes) if (part.visible) instances += mesh.count;
        actors += cell.actors.length;
      }
      return { placements, cells: cells.size, liveCells, instancedMeshes, instances, actors, templates: ready.size };
    },
    async settled() { while (pending.size) await Promise.all([...pending]); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cell of cells.values()) unload(cell);
      cells.clear();
      for (const t of ready.values()) t.handle?.dispose();
      ready.clear(); templates.clear();
      root.removeFromParent();
    },
  };
}
`;

export function generateWorldStreamingModule(): string { return MODULE; }

/** What the builder is told, wherever library models are prepared. */
export const WORLD_STREAMING_HANDOFF =
  `BIG WORLDS STREAM: for a world bigger than one screen or with many copies (a city, a forest, a whole map, hundreds of houses/trees/people), ` +
  `import { createWorldStreamer } from src/game/three/worldStreaming.ts — const world = createWorldStreamer(scene, { heightAt }); ` +
  `world.place([{ subject, x, z, yaw?, scale?, role? }, …]) with every placement (thousands are fine; plan them with a seeded layout), ` +
  `call world.update(camera.position, dt) every frame and world.dispose() on teardown. Only cells near the camera are loaded; each model loads once; ` +
  `copies of a static model are drawn together; far cells use lighter meshes; people and animals are capped for the device; collision is kept. ` +
  `Use a FEW models many times (10–15 house kinds varied by scale, yaw and assetCustomizations colours) rather than hundreds of different files — ` +
  `that is what keeps a big world playable on a phone. Do not also clone these placements by hand.`;
