/** Opt-in explorable buildings. Legacy scenery factories remain unchanged. */
export const GAME_BUILDINGS = String.raw`import * as THREE from 'three';
import { markWorldCollider, worldColliders } from './collision';
import { sharedMaterial } from './materials';

export interface DoorOccupant { feet: THREE.Vector3; radius: number; height: number }
export interface HouseDoor {
  readonly hinge: THREE.Group;
  readonly leaf: THREE.Mesh;
  readonly isOpen: boolean;
  readonly targetOpen: boolean;
  readonly blocked: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  update(dt: number, occupants?: readonly DoorOccupant[]): void;
}
export interface EnterableHouseOptions {
  width?: number; depth?: number; storeys?: number;
  wallMaterial?: THREE.Material; floorMaterial?: THREE.Material; doorMaterial?: THREE.Material;
}
const doors = new WeakMap<THREE.Object3D, HouseDoor>();
export function houseDoor(root: THREE.Object3D): HouseDoor | undefined { return doors.get(root); }
const bounded = (n: number | undefined, fallback: number, low: number, high: number) =>
  Number.isFinite(n) ? Math.max(low, Math.min(high, n!)) : fallback;

/** One or two storeys, flat roof; origin at ground centre, entrance faces +Z. */
export function createEnterableHouse(options: EnterableHouseOptions = {}): THREE.Group {
  const storeys = bounded(options.storeys, 1, 1, 2) >= 1.5 ? 2 : 1;
  const width = bounded(options.width, 8, 5, 30);
  const depth = bounded(options.depth, storeys === 2 ? 10 : 6, storeys === 2 ? 8 : 4, 30);
  const height = storeys * 3, floorY = 0.15, thickness = 0.2;
  const wall = options.wallMaterial ?? sharedMaterial('plaster', 0xf1e3c8);
  const floor = options.floorMaterial ?? sharedMaterial('rock', 0xb8b0a4);
  const wood = options.doorMaterial ?? sharedMaterial('wood', 0xc08a5a);
  const root = new THREE.Group();
  root.name = 'Enterable house';
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material = wall, kind: 'solid' | 'ground' = 'solid') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    root.add(markWorldCollider(mesh, kind)); return mesh;
  };
  box(width, floorY, depth, 0, floorY / 2, 0, floor, 'ground');
  box(thickness, height, depth, -width / 2 + thickness / 2, height / 2 + floorY, 0);
  box(thickness, height, depth, width / 2 - thickness / 2, height / 2 + floorY, 0);
  box(width, height, thickness, 0, height / 2 + floorY, -depth / 2 + thickness / 2);
  const sideWidth = (width - 1.5) / 2;
  for (const sign of [-1, 1]) box(sideWidth, height, thickness,
    sign * (0.75 + sideWidth / 2), height / 2 + floorY, depth / 2 - thickness / 2);
  box(1.5, height - 2.4, thickness, 0, floorY + 2.4 + (height - 2.4) / 2, depth / 2 - thickness / 2);
  box(width, thickness, depth, 0, floorY + height + thickness / 2, 0, floor, 'ground');
  if (storeys === 2) {
    const stairWidth = 1.25, run = 4.5, count = 18;
    const stairX = width / 2 - thickness - stairWidth / 2;
    const back = -depth / 2 + thickness + 1.2;
    const front = back + run;
    for (let i = 0; i < count; i++) {
      const h = (i + 1) * 3 / count;
      box(stairWidth, h, run / count, stairX, floorY + h / 2, front - (i + 0.5) * run / count, floor, 'ground');
    }
    const leftEdge = stairX - stairWidth / 2;
    box(leftEdge + width / 2, floorY, depth, (-width / 2 + leftEdge) / 2, 3 + floorY / 2, 0, floor, 'ground');
    const backDepth = back + depth / 2;
    box(width / 2 - leftEdge, floorY, backDepth, (leftEdge + width / 2) / 2, 3 + floorY / 2, -depth / 2 + backDepth / 2, floor, 'ground');
    const frontDepth = depth / 2 - front;
    if (frontDepth > 0) box(width / 2 - leftEdge, floorY, frontDepth, (leftEdge + width / 2) / 2, 3 + floorY / 2, front + frontDepth / 2, floor, 'ground');
    box(0.08, 0.9, run, leftEdge - 0.04, 3.6, (front + back) / 2);
  }
  const hinge = new THREE.Group();
  hinge.position.set(-0.73, floorY, depth / 2 + 0.01);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1.46, 2.37, 0.08), wood);
  leaf.position.set(0.73, 1.185, 0); leaf.castShadow = true;
  hinge.add(markWorldCollider(leaf)); root.add(hinge);
  let targetOpen = false, blocked = false;
  const occupied = (occupants: readonly DoorOccupant[]) => {
    const bounds = new THREE.Box3().setFromObject(leaf);
    return occupants.some(actor => {
      if (!Number.isFinite(actor.radius) || !Number.isFinite(actor.height) || actor.radius < 0 || actor.height <= 0) return true;
      const p = actor.feet;
      if (![p.x, p.y, p.z].every(Number.isFinite)) return true;
      return bounds.intersectsBox(new THREE.Box3(
        new THREE.Vector3(p.x - actor.radius, p.y, p.z - actor.radius),
        new THREE.Vector3(p.x + actor.radius, p.y + actor.height, p.z + actor.radius)));
    });
  };
  const door: HouseDoor = {
    hinge, leaf,
    get isOpen() { return Math.abs(hinge.rotation.y + Math.PI / 2) < 1e-8; },
    get targetOpen() { return targetOpen; }, get blocked() { return blocked; },
    setOpen(open) { targetOpen = open; }, toggle() { targetOpen = !targetOpen; },
    update(dt, occupants = []) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const target = targetOpen ? -Math.PI / 2 : 0;
      const difference = target - hinge.rotation.y;
      blocked = false;
      if (difference === 0) return;
      const advance = Math.sign(difference) * Math.min(Math.abs(difference), 2.5 * Math.min(dt, 0.1));
      const steps = Math.max(1, Math.ceil(Math.abs(advance) / 0.01));
      for (let i = 0; i < steps; i++) {
        const previous = hinge.rotation.y;
        hinge.rotation.y += advance / steps; root.updateWorldMatrix(true, true);
        if (occupied(occupants)) {
          hinge.rotation.y = previous; root.updateWorldMatrix(true, true); blocked = true; return;
        }
      }
      if (Math.abs(target - hinge.rotation.y) < 1e-8) hinge.rotation.y = target;
      root.updateWorldMatrix(true, true);
    },
  };
  doors.set(root, door);
  root.userData.enterableHouse = { version: 1, width, depth, storeys, entrance: [0, floorY, depth / 2] };
  return root;
}

/** Occupants are world-space bodies. Supply NPC/remote bodies as well as the player. */
export function updateHouseDoors(scene: THREE.Object3D, dt: number, occupants: readonly DoorOccupant[] = []): void {
  scene.traverse(root => doors.get(root)?.update(dt, occupants));
}
export function interactHouseDoor(scene: THREE.Object3D, actor: DoorOccupant, range = 2.2): boolean {
  if (!Number.isFinite(range) || range <= 0) return false;
  scene.updateWorldMatrix(true, true);
  const eye = actor.feet.clone().add(new THREE.Vector3(0, actor.height * 0.6, 0));
  const candidates: { door: HouseDoor; distance: number }[] = [];
  const blockers = worldColliders(scene);
  scene.traverse(root => {
    const door = doors.get(root); if (!door) return;
    const target = door.leaf.getWorldPosition(new THREE.Vector3());
    const direction = target.clone().sub(eye), distance = direction.length();
    if (distance > range || distance === 0) return;
    const ray = new THREE.Raycaster(eye, direction.normalize(), 0, distance);
    const hit = ray.intersectObjects(blockers, false)[0];
    if (hit && hit.object !== door.leaf && hit.distance < distance - 0.05) return;
    candidates.push({ door, distance });
  });
  candidates.sort((a, b) => a.distance - b.distance);
  if (!candidates.length) return false;
  candidates[0].door.toggle(); return true;
}
`;
