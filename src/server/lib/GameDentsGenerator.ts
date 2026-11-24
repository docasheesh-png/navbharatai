// A CRASH THAT LEAVES A MARK (admin 2026-11-24, question 9: "cars ke accident ko realistic banao, car me dent padna chahiye").
//
// The kit already hears every crash (objects.ts onVehicleCrash: where the nose hit, which vehicle, how much speed it lost)
// and makes it felt (shake, sound). It never changed the car. This kit file dents it: the vertices of the car's meshes near
// the point of impact are pushed in, deeper for a harder crash and up to a limit, the paint there is scuffed darker, and
// the car keeps a damage total (userData.damage, 0..1) and says VEHICLE_DAMAGED so a game can smoke, slow or wreck it.
// Works on the kit car and on any library or uploaded car model; a shared geometry is copied once before it is changed,
// so one car's dent never appears on another. Pure generator — the kit file is a string.

export const GAME_DENTS_PATH = 'src/game/three/dents.ts';

export const GAME_DENTS = String.raw`// Dents from crashes — enableVehicleDents() once, and every car that crashes is dented where it hit.
//
//   enableVehicleDents();                         // every vehicle the kit drives (driveVehicle)
//   enableVehicleDents({ strength: 1.5 });        // deeper dents; maxDepth caps how far a surface is pushed in
//   const off = enableVehicleDents(); off();      // stop
//   events.on('VEHICLE_DAMAGED', ({ vehicle, damage }) => { if (damage > 0.8) wreck(vehicle); });
//   repairVehicle(car);                            // back as new
import * as THREE from 'three';
import { onVehicleCrash } from './objects';
import { events } from '../core/events';

export interface DentOptions {
  /** How deep a crash pushes in, per m/s of speed lost (metres). Default 0.012. */
  strength?: number;
  /** The deepest any one point is pushed in (metres). Default 0.25. */
  maxDepth?: number;
  /** How far around the impact the surface moves (metres). Default 0.9. */
  radius?: number;
}

const _p = new THREE.Vector3(), _local = new THREE.Vector3(), _centre = new THREE.Vector3(), _dir = new THREE.Vector3();

/** The original positions, kept so a repair can put them back. */
const originals = new WeakMap<THREE.BufferGeometry, Float32Array>();

function ownGeometry(mesh: THREE.Mesh): THREE.BufferGeometry | null {
  const g = mesh.geometry as THREE.BufferGeometry | undefined;
  const pos = g && g.getAttribute('position');
  if (!g || !pos) return null;
  if (!mesh.userData.dentOwned) {
    // A geometry may be shared by every car of the same model: copy it once, so the dent is this car's alone.
    const copy = g.clone();
    mesh.geometry = copy;
    mesh.userData.dentOwned = true;
    originals.set(copy, Float32Array.from((copy.getAttribute('position') as THREE.BufferAttribute).array as ArrayLike<number>));
    if (!Array.isArray(mesh.material) && mesh.material) mesh.material = (mesh.material as THREE.Material).clone();
    return copy;
  }
  return g;
}

/** Dent one vehicle at a world point, by a speed lost (m/s). Returns the vehicle's damage total (0..1). */
export function dentVehicle(vehicle: THREE.Object3D, at: THREE.Vector3, impact: number, options: DentOptions = {}): number {
  const strength = options.strength ?? 0.012;
  const maxDepth = options.maxDepth ?? 0.25;
  const radius = Math.max(0.05, options.radius ?? 0.9);
  const depth = Math.min(maxDepth, Math.max(0, impact) * strength);
  if (depth <= 0) return Number(vehicle.userData.damage) || 0;
  vehicle.updateMatrixWorld(true);
  new THREE.Box3().setFromObject(vehicle).getCenter(_centre);
  let moved = 0;
  vehicle.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noDent || /wheel|tyre|tire/i.test(mesh.name)) return;
    const g = ownGeometry(mesh);
    if (!g) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const inverse = mesh.matrixWorld.clone().invert();
    let touched = false;
    for (let i = 0; i < pos.count; i++) {
      _p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const d = _p.distanceTo(at);
      if (d > radius) continue;
      const fall = 1 - d / radius;                                  // deepest at the impact, nothing at the edge
      _dir.copy(_centre).sub(at).normalize().multiplyScalar(depth * fall * fall);
      _local.copy(_p).add(_dir).applyMatrix4(inverse);
      pos.setXYZ(i, _local.x, _local.y, _local.z);
      touched = true; moved++;
    }
    if (touched) {
      pos.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m && !Array.isArray(m) && m.color) { m.color.lerp(new THREE.Color(0x2a2a2a), Math.min(0.35, depth * 1.4)); if ('roughness' in m) m.roughness = Math.min(1, (m.roughness ?? 0.5) + 0.05); }
    }
  });
  if (!moved) return Number(vehicle.userData.damage) || 0;
  const damage = Math.min(1, (Number(vehicle.userData.damage) || 0) + depth / maxDepth / 4);
  vehicle.userData.damage = damage;
  events.emit('VEHICLE_DAMAGED', { vehicle, damage, at: at.clone(), impact });
  return damage;
}

/** Put a dented vehicle back as new: every moved surface back where it was, the damage total to 0. */
export function repairVehicle(vehicle: THREE.Object3D): void {
  vehicle.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const g = mesh.isMesh ? (mesh.geometry as THREE.BufferGeometry) : null;
    const before = g ? originals.get(g) : undefined;
    if (!g || !before) return;
    (g.getAttribute('position') as THREE.BufferAttribute).copyArray(before);
    g.getAttribute('position').needsUpdate = true;
    g.computeVertexNormals();
  });
  vehicle.userData.damage = 0;
  events.emit('VEHICLE_DAMAGED', { vehicle, damage: 0, repaired: true });
}

/** Dent every vehicle that crashes, from now on. Returns a function that stops it. */
export function enableVehicleDents(options: DentOptions = {}): () => void {
  return onVehicleCrash((at, vehicle, impact) => { dentVehicle(vehicle, at, impact, options); });
}
`;
