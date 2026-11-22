// 🏁 THE USER'S OWN CAR AND THE USER'S OWN TRACK IN THE ROAD-LIBRARY RACE (admin 2026-11-22, verbatim: "user puri racing
// game ko bhi AI se modified karwa sake, jaise chahe sab free hand do!").
//
// The race starter (<RacingRoadGame>, GameShellGenerator.ts) was a cage: one kit car, one road library, and a builder rule
// that said "never hand-build a second track". This kit file is the door out of it, built the way the open world's
// character is (src/game/player.ts + play/playerBody.ts): the user's choice lives in ONE small file of the game, and the
// kit does the hard, error-prone part — loading the model, sizing it, and turning an arbitrary track model into something
// a race can run on (a ground, a racing line, laps, a position and rivals) — or saying plainly on screen why it cannot.
//
// Shipped beside RacingRoadGame.tsx only (generateGameShell). TypeScript inside String.raw: never a backtick or a
// dollar-brace in the emitted code.

export const RACE_CUSTOM_PATH = 'src/game/play/raceCustom.ts';

export const RACE_CUSTOM = String.raw`// YOUR OWN CAR AND YOUR OWN TRACK in the road-library race (admin 2026-11-22: "user puri racing game ko bhi AI se
// modified karwa sake, jaise chahe sab free hand do!").
//
// <RacingRoadGame> reads two small files of the game by itself, when they exist (props of the same name win over them):
//   src/game/car.ts   → export const CAR: CarChoice     — the car the player drives: colour, size, speed, or a 3D model;
//   src/game/track.ts → export const TRACK: TrackChoice — race on a 3D track model instead of the road library.
// Neither file is needed: without them the race is the kit car on the twelve-map road library.
//
// A model is named either as a FILE of the project ('public/models/my-car.glb' — where an attached .glb/.gltf/.obj/.fbx
// lands) or as the SUBJECT of a game-library model this game has saved ('sports car'). The car keeps the kit's driving
// (speed, steering, the ground, the camera); only its look becomes the model, sized to the car. A track model becomes the
// ground; the racing line is read from its road (or given as points), so laps, the position and the rivals still work.
// A model that cannot be used is never hidden: the game says so on screen, with the reason.
import * as THREE from 'three';
import { markWorldCollider } from '../three/collision';
import type { TrackPose, VehicleTuning } from '../three/objects';

export interface CarChoice {
  /** The kit car's paint, 0xRRGGBB. */
  color?: number;
  /** A 3D model for the car: a project file ('public/models/my-car.glb') or a saved library subject. null = the kit car. */
  model?: string | null;
  /** Nose-to-tail length the model is sized to, in metres. Default 4.3 (a saloon car). */
  modelLength?: number;
  /** Turn the model, in degrees, when its nose does not point forward (180 = it drives backwards). Default 0. */
  modelYaw?: number;
  /** Raise (+) or sink (-) the model, in metres, when its wheels float or sink into the road. Default 0. */
  modelLift?: number;
  /** How it drives: maxSpeed (m/s; 25 is about 90 km/h), reverseSpeed, accel, brake, drag, steerRate, startSpeed. */
  tuning?: Pick<VehicleTuning, 'maxSpeed' | 'reverseSpeed' | 'accel' | 'brake' | 'drag' | 'steerRate' | 'startSpeed'>;
}

export interface TrackChoice {
  /** A 3D model of the track: a project file ('public/models/my-track.glb') or a saved library subject. null = the road library. */
  model?: string | null;
  /** Its longest side, in metres (the model is scaled to it). Default: the model's own size (glTF is in metres). */
  size?: number;
  /** Or a plain scale factor. Ignored when size is set. */
  scale?: number;
  /** The racing line as [x, z] points in metres from the track's centre, in driving order (a closed loop). Default: read from the road. */
  line?: ReadonlyArray<readonly [number, number]>;
  /** Drive the loop the other way round. */
  reverse?: boolean;
  /** Laps to the finish. Default 3. */
  laps?: number;
  /** Words in the names of the road's meshes or materials. Default: road, track, asphalt, tarmac, street, circuit, lane, highway. */
  roadNames?: readonly string[];
  /** The name shown in the HUD. */
  name?: string;
}

/** Turns a model name into its 3D object, or rejects with a reason a person can read. */
export type RaceModelLoader = (source: string) => Promise<THREE.Object3D>;

/** A file of the project rather than a library subject. */
export function isProjectModelFile(source: string): boolean {
  return /\.(?:glb|gltf)$/i.test(String(source || '').trim());
}

/** The URL the dev server and the published app serve a project file at: public/models/a.glb is /models/a.glb. */
export function projectModelUrl(source: string): string {
  const s = String(source || '').trim().replace(/^\.?\//, '').replace(/^public\//, '');
  return '/' + s;
}

type AssetHandle = { root: THREE.Object3D; source?: string; dispose?(): void; update?(dt: number): void };
type AssetModule = { loadRequestedAsset?: (subject: string, fallback: () => AssetHandle) => Promise<AssetHandle> };

/** The game's saved library models, when it has any. A game without the file simply has none — never a broken build. */
function assetModule(): Promise<AssetModule | null> {
  try {
    const found = import.meta.glob('../three/assetModels.ts') as Record<string, () => Promise<AssetModule>>;
    const load = Object.values(found)[0];
    return load ? load().catch(() => null) : Promise.resolve(null);
  } catch { return Promise.resolve(null); }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The kit's loader: a project file through GLTFLoader, a library subject through the game's saved models. */
export const loadRaceModel: RaceModelLoader = async (source) => {
  const name = String(source || '').trim();
  if (!name) throw new Error('no model was named');
  if (isProjectModelFile(name)) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    try {
      const gltf = await new GLTFLoader().loadAsync(projectModelUrl(name));
      return gltf.scene;
    } catch (error) {
      throw new Error('the file ' + name + ' could not be loaded (' + reasonOf(error) + ') — attach it again, or check the name');
    }
  }
  const mod = await assetModule();
  if (!mod || !mod.loadRequestedAsset) throw new Error('"' + name + '" is not one of this game\'s saved models — add it from the game library first, or attach the file');
  const handle = await mod.loadRequestedAsset(name, () => ({ root: new THREE.Group(), source: 'procedural' }));
  if (!handle || handle.source !== 'model') {
    if (handle && handle.dispose) handle.dispose();
    throw new Error('"' + name + '" is not one of this game\'s saved models — add it from the game library first, or attach the file');
  }
  return handle.root;
};

/** The game's own car.ts / track.ts, when they exist (an eager import: no file, no entry, never a broken build). */
export function projectRaceChoices(): { car: CarChoice | null; track: TrackChoice | null } {
  try {
    const cars = import.meta.glob('../car.ts', { eager: true, import: 'CAR' }) as Record<string, CarChoice | undefined>;
    const tracks = import.meta.glob('../track.ts', { eager: true, import: 'TRACK' }) as Record<string, TrackChoice | undefined>;
    return { car: Object.values(cars)[0] ?? null, track: Object.values(tracks)[0] ?? null };
  } catch { return { car: null, track: null }; }
}

// ── THE CAR ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The model, sized to the car: its longest side on the ground becomes modelLength, it stands with its lowest point on the
 * road (the kit car's origin is at the tyres) and its middle over the car's origin. Throws on an empty model.
 */
export function fitCarModel(model: THREE.Object3D, choice: CarChoice = {}): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = 'car model';
  const inner = new THREE.Group();
  inner.add(model);
  inner.rotation.y = ((Number.isFinite(choice.modelYaw) ? (choice.modelYaw as number) : 0) * Math.PI) / 180;
  pivot.add(inner);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.z);
  if (box.isEmpty() || !Number.isFinite(longest) || longest < 1e-6) throw new Error('the model is empty (it has nothing to show)');
  const length = choice.modelLength && choice.modelLength > 0 ? choice.modelLength : 4.3;
  const k = length / longest;
  inner.scale.setScalar(k);
  const lift = Number.isFinite(choice.modelLift) ? (choice.modelLift as number) : 0;
  inner.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k + lift, -((box.min.z + box.max.z) / 2) * k);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  pivot.updateMatrixWorld(true);
  return pivot;
}

export interface CarModelHandle {
  /** 'kit' while the kit car is shown; 'model' once the chosen model has taken its place. */
  readonly showing: 'kit' | 'model';
  /** Why the chosen model is not shown, or null. */
  readonly error: string | null;
  /** Settles when the model is shown or has failed (never rejects). */
  readonly ready: Promise<void>;
  dispose(): void;
}

/**
 * Put the chosen model on the car. The car object keeps driving exactly as before (it is still the kit's vehicle); its own
 * body is hidden only once the model is really there, so the player is never without a car. onError hears the reason.
 */
export function applyCarChoice(car: THREE.Object3D, choice: CarChoice | null | undefined, load: RaceModelLoader = loadRaceModel, onError?: (message: string) => void): CarModelHandle {
  let showing: 'kit' | 'model' = 'kit';
  let error: string | null = null;
  let gone = false;
  let fitted: THREE.Group | null = null;
  const hidden: THREE.Object3D[] = [];
  const name = typeof choice?.model === 'string' ? choice.model.trim() : '';
  const ready: Promise<void> = !name ? Promise.resolve() : load(name).then((model) => {
    if (gone) return;
    fitted = fitCarModel(model, choice ?? {});
    for (const child of [...car.children]) { if (child.visible) { child.visible = false; hidden.push(child); } }
    car.add(fitted);
    showing = 'model';
  }).catch((e: unknown) => {
    if (gone) return;
    error = 'Your car "' + name + '" could not be used: ' + reasonOf(e) + '. The standard car is shown instead.';
    console.error('[race car] ' + error);
    if (onError) onError(error);
  });
  return {
    get showing() { return showing; },
    get error() { return error; },
    ready,
    dispose() {
      gone = true;
      if (fitted) { fitted.removeFromParent(); fitted = null; }
      for (const child of hidden) child.visible = true;
      hidden.length = 0;
      showing = 'kit';
    },
  };
}

// ── THE TRACK ────────────────────────────────────────────────────────────────────────────────────────

const ROAD_WORDS = ['road', 'track', 'asphalt', 'tarmac', 'street', 'circuit', 'lane', 'highway'];

/** A track model ready to race on: the ground, the racing line and the lap counter. poseAt is what the rivals drive. */
export interface ModelTrack {
  root: THREE.Group;
  name: string;
  /** One lap, in metres. */
  length: number;
  laps: number;
  startPose: TrackPose;
  /** The track's surface under (x, z) — the car drives on it. */
  heightAt: (x: number, z: number) => number;
  /** The racing line, every 2 m, in driving order. */
  line: ReadonlyArray<{ x: number; z: number }>;
  /** Call every frame with the player's car: how far round it has driven (all laps) and which lap it is on. */
  update: (car: THREE.Object3D) => { distance: number; lap: number; segment: null; ended: boolean; rebased: null };
  /** The racing line at a distance (any lap; negative is before the line), facing along it. */
  poseAt: (distance: number) => TrackPose | null;
  /** Back to the start line, lap 1. */
  reset: () => void;
  dispose: () => void;
}

export type ModelTrackResult = { ok: true; track: ModelTrack; notes: string[] } | { ok: false; reason: string };

interface SurfaceGrid { minX: number; minZ: number; step: number; nx: number; nz: number; top: Float32Array; road: Float32Array; roadNamed: boolean }

const named = (o: THREE.Object3D | null, root: THREE.Object3D, words: readonly string[]): boolean => {
  for (let n: THREE.Object3D | null = o; n && n !== root; n = n.parent) {
    const text = (n.name || '').toLowerCase();
    if (words.some((w) => text.includes(w))) return true;
  }
  return false;
};
const materialNamed = (m: THREE.Material | undefined, words: readonly string[]): boolean => !!m && words.some((w) => (m.name || '').toLowerCase().includes(w));

/**
 * The model's surface on a grid seen from above: the highest point of every cell (the ground the car drives on) and, where
 * the highest point is a flat road face, the road. Rasterised triangle by triangle — no ray per cell, so a big model is fast.
 */
function surfaceGrid(root: THREE.Object3D, words: readonly string[]): SurfaceGrid {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
  const step = Math.max(0.5, Math.min(4, Math.max(sx, sz) / 256));
  const nx = Math.floor(sx / step) + 2, nz = Math.floor(sz / step) + 2;
  const top = new Float32Array(nx * nz).fill(Number.NaN);
  const roadTop = new Float32Array(nx * nz).fill(Number.NaN);
  const minX = box.min.x, minZ = box.min.z;
  let roadNamed = false;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry) meshes.push(o as THREE.Mesh); });
  // Is any part of the model named as the road? Then only those parts are road; otherwise every flat face may be.
  for (const mesh of meshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (named(mesh, root, words) || mats.some((m) => materialNamed(m, words))) { roadNamed = true; break; }
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const meshRoad = named(mesh, root, words);
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const g of groups) {
      const isRoad = !roadNamed || meshRoad || materialNamed(mats[g.materialIndex ?? 0], words);
      const end = Math.min(count, g.start + g.count);
      for (let t = g.start; t + 2 < end; t += 3) {
        const i0 = index ? index.getX(t) : t, i1 = index ? index.getX(t + 1) : t + 1, i2 = index ? index.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
        const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
        if (Math.abs(area) < 1e-9) continue;                       // a wall seen edge-on from above
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        const ny = uz * vx - ux * vz, nxn = uy * vz - uz * vy, nzn = ux * vy - uy * vx;
        const flat = Math.abs(ny) / Math.max(1e-12, Math.hypot(nxn, ny, nzn)) > 0.7;
        const gx0 = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - minX) / step)), gx1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - minX) / step));
        const gz0 = Math.max(0, Math.ceil((Math.min(a.z, b.z, c.z) - minZ) / step)), gz1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - minZ) / step));
        for (let gz = gz0; gz <= gz1; gz++) {
          const pz = minZ + gz * step;
          for (let gx = gx0; gx <= gx1; gx++) {
            const px = minX + gx * step;
            const w1 = ((px - a.x) * (c.z - a.z) - (c.x - a.x) * (pz - a.z)) / area;
            const w2 = ((b.x - a.x) * (pz - a.z) - (px - a.x) * (b.z - a.z)) / area;
            if (w1 < -1e-6 || w2 < -1e-6 || w1 + w2 > 1 + 1e-6) continue;
            const y = a.y + w1 * (b.y - a.y) + w2 * (c.y - a.y);
            const k = gz * nx + gx;
            if (!(top[k] >= y)) top[k] = y;
            if (isRoad && flat && !(roadTop[k] >= y)) roadTop[k] = y;
          }
        }
      }
    }
  }
  // A road cell is one whose road face is the top (or within a kerb of it): a road under a bridge deck is not drivable here.
  const road = new Float32Array(nx * nz).fill(Number.NaN);
  for (let k = 0; k < road.length; k++) if (roadTop[k] === roadTop[k] && roadTop[k] >= top[k] - 0.75) road[k] = roadTop[k];
  return { minX, minZ, step, nx, nz, top, road, roadNamed };
}

function sampler(grid: SurfaceGrid, field: Float32Array): (x: number, z: number) => number {
  return (x, z) => {
    const fx = (x - grid.minX) / grid.step, fz = (z - grid.minZ) / grid.step;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    let sum = 0, weight = 0;
    for (const [dx, dz, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]] as const) {
      const gx = x0 + dx, gz = z0 + dz;
      if (gx < 0 || gz < 0 || gx >= grid.nx || gz >= grid.nz) continue;
      const v = field[gz * grid.nx + gx];
      if (v === v && w > 0) { sum += v * w; weight += w; }
    }
    return weight > 0 ? sum / weight : 0;
  };
}

/**
 * The racing line, read from the road: from the middle of the road, look out in every direction and take the middle of the
 * road band each way — the centre line of any loop that goes all the way round (an oval, a rounded circuit, most real
 * tracks). Returns a reason instead when the road does not go all the way round, or there is no road to tell from the ground.
 */
function readRacingLine(grid: SurfaceGrid): { points: Array<{ x: number; z: number }> } | { reason: string } {
  const isRoad = (x: number, z: number): boolean => {
    const gx = Math.round((x - grid.minX) / grid.step), gz = Math.round((z - grid.minZ) / grid.step);
    if (gx < 0 || gz < 0 || gx >= grid.nx || gz >= grid.nz) return false;
    const v = grid.road[gz * grid.nx + gx];
    return v === v;
  };
  let cx = 0, cz = 0, n = 0;
  for (let gz = 0; gz < grid.nz; gz++) for (let gx = 0; gx < grid.nx; gx++) {
    const v = grid.road[gz * grid.nx + gx];
    if (v === v) { cx += grid.minX + gx * grid.step; cz += grid.minZ + gz * grid.step; n++; }
  }
  if (n < 20) return { reason: 'no flat road surface was found in the model' };
  cx /= n; cz /= n;
  const maxR = Math.hypot(grid.nx, grid.nz) * grid.step;
  const dr = grid.step / 2;
  const ANGLES = 128;
  const runs: Array<Array<[number, number]>> = [];
  let filled = 0;
  for (let i = 0; i < ANGLES; i++) {
    const ang = (i / ANGLES) * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    const found: Array<[number, number]> = [];
    let start = -1;
    for (let r = 0; r <= maxR; r += dr) {
      const on = isRoad(cx + dx * r, cz + dz * r);
      if (on && start < 0) start = r;
      if (!on && start >= 0) { found.push([start, r - dr]); start = -1; }
    }
    if (start >= 0) found.push([start, maxR]);
    if (found.length && found[0][0] < grid.step * 2) filled++;
    runs.push(found);
  }
  if (filled > ANGLES / 2) {
    return { reason: grid.roadNamed
      ? 'its road does not go all the way round a middle (a point-to-point road or an open area cannot be read automatically — give TRACK.line)'
      : 'the whole model is one open flat surface, so the road cannot be told from the ground (name the road parts "road" in the model, or give TRACK.line)' };
  }
  const missing = runs.findIndex((r) => r.length === 0);
  if (missing >= 0) return { reason: 'its road does not go all the way round (a point-to-point road, a city or a loop that crosses itself cannot be read automatically — give TRACK.line)' };
  const widest = runs.map((r) => r.reduce((best, x) => (x[1] - x[0] > best[1] - best[0] ? x : best)));
  const mids = widest.map((r) => (r[0] + r[1]) / 2).sort((p, q) => p - q);
  let prev = mids[Math.floor(mids.length / 2)];
  const chosen: number[] = [];
  for (const r of runs) {
    const pick = r.reduce((best, x) => (Math.abs((x[0] + x[1]) / 2 - prev) < Math.abs((best[0] + best[1]) / 2 - prev) ? x : best));
    const mid = (pick[0] + pick[1]) / 2;
    if (chosen.length && Math.abs(mid - prev) > Math.max(12, prev * 0.5)) return { reason: 'its road doubles back or crosses itself, so one racing line cannot be read from it' };
    chosen.push(mid); prev = mid;
  }
  if (Math.abs(chosen[0] - chosen[chosen.length - 1]) > Math.max(12, chosen[0] * 0.5)) return { reason: 'its road doubles back or crosses itself, so one racing line cannot be read from it' };
  let points = chosen.map((r, i) => { const ang = (i / ANGLES) * Math.PI * 2; return { x: cx + Math.cos(ang) * r, z: cz + Math.sin(ang) * r }; });
  for (let pass = 0; pass < 2; pass++) {
    points = points.map((p, i) => {
      const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
      return { x: a.x * 0.25 + p.x * 0.5 + b.x * 0.25, z: a.z * 0.25 + p.z * 0.5 + b.z * 0.25 };
    });
  }
  return { points };
}

/** A closed loop resampled every 2 m. */
function resample(points: ReadonlyArray<{ x: number; z: number }>): { pts: Array<{ x: number; z: number }>; cum: number[]; total: number } {
  const ring = [...points, points[0]];
  const cumIn = [0];
  for (let i = 1; i < ring.length; i++) cumIn.push(cumIn[i - 1] + Math.hypot(ring[i].x - ring[i - 1].x, ring[i].z - ring[i - 1].z));
  const total = cumIn[cumIn.length - 1];
  const count = Math.max(8, Math.round(total / 2));
  const pts: Array<{ x: number; z: number }> = [];
  let j = 1;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (j < cumIn.length - 1 && cumIn[j] < s) j++;
    const t = (s - cumIn[j - 1]) / Math.max(1e-9, cumIn[j] - cumIn[j - 1]);
    pts.push({ x: ring[j - 1].x + (ring[j].x - ring[j - 1].x) * t, z: ring[j - 1].z + (ring[j].z - ring[j - 1].z) * t });
  }
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) { const p = pts[i % pts.length], q = pts[i - 1]; cum.push(cum[i - 1] + Math.hypot(p.x - q.x, p.z - q.z)); }
  return { pts, cum, total: cum[cum.length - 1] };
}

/**
 * Make a track model raceable. The model is scaled (size / scale), centred on the origin with its lowest point at y = 0,
 * marked as the world's ground, and its racing line read (or taken from choice.line). Never throws: a model that cannot be
 * raced on comes back with the reason.
 */
export function createModelTrack(model: THREE.Object3D, choice: TrackChoice = {}): ModelTrackResult {
  try {
    const notes: string[] = [];
    const root = new THREE.Group();
    root.name = 'user track';
    const holder = new THREE.Group();
    holder.add(model);
    root.add(holder);
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return { ok: false, reason: 'the model is empty (it has nothing to drive on)' };
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.z);
    if (!Number.isFinite(longest) || longest < 1e-6) return { ok: false, reason: 'the model has no size' };
    let k = choice.size && choice.size > 0 ? choice.size / longest : choice.scale && choice.scale > 0 ? choice.scale : 1;
    if (!choice.size && !choice.scale && longest < 20) { k = 400 / longest; notes.push('The track model was only ' + longest.toFixed(1) + ' units across, so it was scaled up to 400 m (set TRACK.size to choose).'); }
    holder.scale.setScalar(k);
    holder.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const grid = surfaceGrid(root, choice.roadNames && choice.roadNames.length ? choice.roadNames.map((w) => String(w).toLowerCase()) : ROAD_WORDS);
    const heightAt = sampler(grid, grid.top);
    const roadHeight = sampler(grid, grid.road);
    let raw: Array<{ x: number; z: number }>;
    if (choice.line && choice.line.length) {
      raw = choice.line.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => ({ x: p[0], z: p[1] }));
      if (raw.length < 3) return { ok: false, reason: 'TRACK.line needs at least three [x, z] points' };
    } else {
      const read = readRacingLine(grid);
      if ('reason' in read) return { ok: false, reason: read.reason };
      raw = read.points;
    }
    if (choice.reverse) raw = [...raw].reverse();
    const path = resample(raw);
    if (!(path.total >= 60)) return { ok: false, reason: 'one lap would be only ' + Math.round(path.total) + ' m — too short to race (set TRACK.size to make the track bigger)' };
    const ys = path.pts.map((p) => { const r = roadHeight(p.x, p.z); return r || heightAt(p.x, p.z); });
    const n = path.pts.length;
    const at = (d: number): TrackPose | null => {
      if (!Number.isFinite(d)) return null;
      const s = ((d % path.total) + path.total) % path.total;
      let lo = 0, hi = n;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (path.cum[mid] <= s) lo = mid; else hi = mid; }
      const p = path.pts[lo], q = path.pts[(lo + 1) % n];
      const t = (s - path.cum[lo]) / Math.max(1e-9, path.cum[lo + 1] - path.cum[lo]);
      return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: ys[lo] + (ys[(lo + 1) % n] - ys[lo]) * t, heading: Math.atan2(q.x - p.x, q.z - p.z) };
    };
    const laps = Math.max(1, Math.min(99, Math.round(choice.laps ?? 3)));
    let index = 0, along = 0, distance = 0;
    const nearest = (x: number, z: number, from: number, span: number): { i: number; s: number; d: number } => {
      let best = { i: 0, s: 0, d: Infinity };
      for (let o = -span; o <= span; o++) {
        const i = (((from + o) % n) + n) % n;
        const p = path.pts[i], q = path.pts[(i + 1) % n];
        const ex = q.x - p.x, ez = q.z - p.z, len2 = Math.max(1e-9, ex * ex + ez * ez);
        const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / len2));
        const d = Math.hypot(p.x + ex * t - x, p.z + ez * t - z);
        if (d < best.d) best = { i, s: path.cum[i] + t * Math.sqrt(len2), d };
      }
      return best;
    };
    markWorldCollider(model, 'ground');
    const startPose = at(0) as TrackPose;
    const track: ModelTrack = {
      root, name: choice.name || 'Your track', length: path.total, laps, startPose, heightAt, line: path.pts,
      update(car) {
        let best = nearest(car.position.x, car.position.z, index, 30);
        if (best.d > 40) best = nearest(car.position.x, car.position.z, Math.floor(n / 2), Math.ceil(n / 2));
        let delta = best.s - along;
        if (delta > path.total / 2) delta -= path.total; else if (delta < -path.total / 2) delta += path.total;
        distance += delta; along = best.s; index = best.i;
        return { distance, lap: Math.max(0, Math.floor(distance / path.total)), segment: null, ended: false, rebased: null };
      },
      poseAt: at,
      reset() { index = 0; along = 0; distance = 0; },
      dispose() { root.removeFromParent(); },
    };
    return { ok: true, track, notes };
  } catch (error) {
    return { ok: false, reason: 'it could not be read (' + reasonOf(error) + ')' };
  }
}

/** Load the chosen track model and make it raceable — or the reason it cannot be. Never rejects. */
export async function loadModelTrack(choice: TrackChoice, load: RaceModelLoader = loadRaceModel): Promise<ModelTrackResult> {
  const name = typeof choice.model === 'string' ? choice.model.trim() : '';
  if (!name) return { ok: false, reason: 'no track model was named' };
  let model: THREE.Object3D;
  try { model = await load(name); } catch (error) { return { ok: false, reason: reasonOf(error) }; }
  return createModelTrack(model, choice);
}
`;
