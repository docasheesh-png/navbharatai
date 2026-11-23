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
export type HouseLayout = 'living' | 'bedroom' | 'kitchen' | 'bathroom';
export interface EnterableHouseOptions {
  width?: number; depth?: number; storeys?: number;
  wallMaterial?: THREE.Material; floorMaterial?: THREE.Material; doorMaterial?: THREE.Material;
  /** Which room is inside. Neighbours in an action town get different rooms. */
  layout?: HouseLayout;
  /** Wall colour for a variant. Omit it and the house keeps the shared plaster. */
  wallColor?: number;
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
  const wall = options.wallMaterial ?? (options.wallColor != null
    ? new THREE.MeshStandardMaterial({ color: options.wallColor, roughness: 0.92 })
    : sharedMaterial('plaster', 0xf1e3c8));
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
  const roof = box(width, thickness, depth, 0, floorY + height + thickness / 2, 0, floor, 'ground');
  roof.material = (Array.isArray(roof.material) ? roof.material[0] : roof.material).clone();
  roof.userData.indoorRoof = true;
  root.userData.indoorRoof = roof;
  const layout: HouseLayout = options.layout ?? (['living', 'bedroom', 'kitchen', 'bathroom'] as const)[Math.abs(Math.round(width)) % 4];
  furnishHouse(root, width, depth, floorY, layout);
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
  root.userData.enterableHouse = { version: 1, width, depth, storeys, layout, entrance: [0, floorY, depth / 2] };
  return root;
}

/** Furniture sits on the left wall. The centre aisle and the right-hand stairs stay empty so a player can walk in. */
function furnishHouse(root: THREE.Group, width: number, depth: number, floorY: number, layout: HouseLayout): void {
  const pieces: THREE.Mesh[] = [];
  const add = (subject: string, w: number, h: number, d: number, x: number, z: number, color: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.position.set(x, floorY + h / 2, z);
    mesh.name = subject;
    mesh.userData.librarySubject = subject;
    mesh.userData.furniture = true;
    root.add(markWorldCollider(mesh));
    pieces.push(mesh);
  };
  const x = -width / 2 + 1.45;
  if (layout === 'bedroom') add('bed', 1.3, 0.5, 2, x, -depth * 0.12, 0x8d5a44);
  else if (layout === 'kitchen') {
    add('kitchen counter', 1.15, 0.9, 2, x, 0.2, 0xc4b8a4);
    add('fridge', 0.7, 1.5, 0.65, x, -depth * 0.28, 0xd8dde6);
  } else if (layout === 'bathroom') add('cabinet', 0.7, 0.75, 0.5, x, -depth * 0.15, 0xe8e4dc);
  else {
    add('sofa', 1.15, 0.65, 1.8, x, 0.15, 0x9a4a3c);
    add('lamp', 0.22, 1.05, 0.22, x, -depth * 0.28, 0xf0d78c);
  }
  root.userData.furniture = pieces;
  root.userData.layout = layout;
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

/** A solid library mesh is scenery. The walkable house is a hollow shell the size of its footprint. */
export function enterableShellFor(model: THREE.Object3D, options: EnterableHouseOptions = {}): THREE.Group {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  markWorldCollider(model, 'none');
  const clamp = (n: number, fallback: number, low: number, high: number) => Number.isFinite(n) && n > 0 ? Math.max(low, Math.min(high, n)) : fallback;
  const house = createEnterableHouse({
    ...options,
    width: clamp(size.x, 8, 5, 30),
    depth: clamp(size.z, 8, 4, 30),
    storeys: size.y > 4.5 ? 2 : 1,
  });
  house.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  return house;
}

/** While the player is indoors, the roof fades so the camera can see them. The pull-in still runs in the camera rig. */
export function updateIndoorCamera(scene: THREE.Object3D, camera: THREE.Camera, focus: THREE.Vector3): void {
  scene.traverse(root => {
    const info = root.userData.enterableHouse as { width: number; depth: number; storeys: number } | undefined;
    const roof = root.userData.indoorRoof as THREE.Mesh | undefined;
    if (!info || !roof) return;
    const local = root.worldToLocal(focus.clone());
    const inside = Math.abs(local.x) < info.width / 2 - 0.3 && Math.abs(local.z) < info.depth / 2 - 0.3 && local.y < info.storeys * 3 + 0.5;
    const mat = roof.material as THREE.MeshStandardMaterial;
    const above = camera.position.y > roof.getWorldPosition(new THREE.Vector3()).y - 0.4;
    if (inside && above) { mat.transparent = true; mat.opacity = 0.18; }
    else if (mat.transparent) { mat.opacity = 1; mat.transparent = false; }
  });
}

export interface ActionHouseDesign { model: string; colour: string; layout: HouseLayout; wallColor: number }
export interface ActionHousePlot {
  index: number; x: number; z: number; yaw: number; scale: number;
  village: number; col: number; row: number;
  design: ActionHouseDesign;
}
export interface ActionTown {
  readonly root: THREE.Group;
  readonly houses: readonly ActionHousePlot[];
  readonly nearMetres: number;
  update(playerX: number, playerZ: number): void;
  isLive(index: number): boolean;
  liveHouse(index: number): THREE.Group | null;
  drawCalls(): number;
}

const ACTION_DESIGNS: readonly ActionHouseDesign[] = [
  { model: 'lib12-small-house', colour: 'indigo', layout: 'living', wallColor: 0x3d4f86 },
  { model: 'lib12-small-house', colour: 'saffron', layout: 'bedroom', wallColor: 0xc47a32 },
  { model: 'lib12-bungalow', colour: 'forest', layout: 'kitchen', wallColor: 0x3e6b45 },
  { model: 'lib12-bungalow', colour: 'maroon', layout: 'bathroom', wallColor: 0x7a3b45 },
  { model: 'lib12-townhouse', colour: 'indigo', layout: 'bedroom', wallColor: 0x2c3f78 },
  { model: 'lib12-townhouse', colour: 'gold', layout: 'living', wallColor: 0xc6b48a },
  { model: 'lib12-porch-house', colour: 'saffron', layout: 'kitchen', wallColor: 0xb86a28 },
  { model: 'lib12-porch-house', colour: 'forest', layout: 'living', wallColor: 0x4d7a52 },
  { model: 'lib12-shop-house', colour: 'maroon', layout: 'bedroom', wallColor: 0x8a4450 },
  { model: 'lib12-shop-house', colour: 'indigo', layout: 'bathroom', wallColor: 0x44588f },
  { model: 'lib2-tavern', colour: 'gold', layout: 'kitchen', wallColor: 0xd2b48c },
  { model: 'lib2-tavern', colour: 'forest', layout: 'living', wallColor: 0x2f5a3c },
  { model: 'lib2-church', colour: 'saffron', layout: 'bedroom', wallColor: 0xe0a15a },
  { model: 'lib2-market', colour: 'maroon', layout: 'living', wallColor: 0x6e3340 },
  { model: 'lib5-bakery', colour: 'gold', layout: 'kitchen', wallColor: 0xefe6d2 },
  { model: 'lib5-school', colour: 'indigo', layout: 'bathroom', wallColor: 0x5c6e9a },
];

function townRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * At least 100 houses in four villages, on a seeded shuffle. The same model is never on an adjacent plot,
 * and the same model-plus-colour is never among the six nearest houses. Shells are instanced. The hollow
 * interior, door and floor exist only while the player is near.
 */
export function createActionTown(count = 100, seed = 1): ActionTown {
  const total = Math.max(100, Math.min(400, Math.floor(count)));
  const rng = townRandom(seed);
  const spacing = 14;
  const perSide = 5;
  const villages = [{ ox: -90, oz: -90 }, { ox: 90, oz: -90 }, { ox: -90, oz: 90 }, { ox: 90, oz: 90 }];
  const width = 7, depth = 6;
  const plots: ActionHousePlot[] = [];
  let n = 0;
  for (let v = 0; v < villages.length && n < total; v++) {
    for (let row = 0; row < perSide && n < total; row++) {
      for (let col = 0; col < perSide && n < total; col++) {
        const x = villages[v].ox + (col - 2) * spacing;
        const z = villages[v].oz + (row - 2) * spacing;
        const order = ACTION_DESIGNS.map((design, rollIndex) => ({ design, rollIndex, roll: rng() })).sort((a, b) => a.roll - b.roll);
        const fits = (candidate: { design: ActionHouseDesign }, layoutToo: boolean) => {
          const adjacent = plots.filter(p => p.village === v && Math.max(Math.abs(p.col - col), Math.abs(p.row - row)) === 1);
          if (adjacent.some(p => p.design.model === candidate.design.model)) return false;
          if (layoutToo && adjacent.some(p => p.design.layout === candidate.design.layout)) return false;
          const nearest = plots.map(p => ({ p, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d).slice(0, 6);
          return !nearest.some(item => item.p.design.model === candidate.design.model && item.p.design.colour === candidate.design.colour);
        };
        const chosen = order.find(candidate => fits(candidate, true)) ?? order.find(candidate => fits(candidate, false)) ?? order[0];
        const yaw = (row % 2) * Math.PI + (rng() - 0.5) * 0.18;
        plots.push({ index: n, x, z, yaw, scale: 0.94 + rng() * 0.1, village: v, col, row, design: chosen.design });
        n++;
      }
    }
  }
  const root = new THREE.Group();
  root.name = 'Action town';
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x6e7370, roughness: 1 });
  const road = (w: number, d: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), roadMat);
    mesh.position.set(x, 0.04, z);
    root.add(markWorldCollider(mesh, 'ground'));
  };
  road(220, 4, 0, -90); road(220, 4, 0, 90); road(4, 220, -90, 0); road(4, 220, 90, 0);
  const floorY = 0.15, thickness = 0.2, height = 3;
  const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate(x, y, z);
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial({ roughness: 0.9 }), plots.length);
    mesh.count = plots.length;
    root.add(mesh);
    return mesh;
  };
  const shells = [
    part(width, floorY, depth, 0, floorY / 2, 0),
    part(thickness, height, depth, -width / 2 + thickness / 2, height / 2 + floorY, 0),
    part(thickness, height, depth, width / 2 - thickness / 2, height / 2 + floorY, 0),
    part(width, height, thickness, 0, height / 2 + floorY, -depth / 2 + thickness / 2),
    part((width - 1.5) / 2, height, thickness, -(0.75 + (width - 1.5) / 4), height / 2 + floorY, depth / 2 - thickness / 2),
    part((width - 1.5) / 2, height, thickness, 0.75 + (width - 1.5) / 4, height / 2 + floorY, depth / 2 - thickness / 2),
    part(1.5, height - 2.4, thickness, 0, floorY + 2.4 + (height - 2.4) / 2, depth / 2 - thickness / 2),
    part(width, thickness, depth, 0, floorY + height + thickness / 2, 0),
    part(1.46, 2.37, 0.08, 0, floorY + 1.185, depth / 2 + 0.01),
  ];
  const hidden = new Set<number>();
  const live = new Map<number, THREE.Group>();
  const dummy = new THREE.Object3D();
  const colourOf = new Map(ACTION_DESIGNS.map(d => [d.colour, d.wallColor]));
  const writeInstance = (index: number, hide: boolean) => {
    const plot = plots[index];
    if (hide) { dummy.position.set(0, -80, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(0.0001, 0.0001, 0.0001); }
    else { dummy.position.set(plot.x, 0, plot.z); dummy.rotation.set(0, plot.yaw, 0); dummy.scale.set(plot.scale, plot.scale, plot.scale); }
    dummy.updateMatrix();
    for (const mesh of shells) {
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, new THREE.Color(colourOf.get(plot.design.colour) ?? plot.design.wallColor));
    }
  };
  plots.forEach((_, index) => writeInstance(index, false));
  for (const mesh of shells) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  const nearMetres = 18;
  const show = (index: number) => { hidden.delete(index); writeInstance(index, false); };
  const build = (index: number) => {
    if (live.has(index)) return;
    const plot = plots[index];
    const house = createEnterableHouse({ width, depth, storeys: 1, layout: plot.design.layout, wallColor: plot.design.wallColor });
    house.position.set(plot.x, 0, plot.z);
    house.rotation.y = plot.yaw;
    house.scale.setScalar(plot.scale);
    house.userData.libraryHouse = plot.design.model;
    house.userData.colourVariant = plot.design.colour;
    root.add(house);
    live.set(index, house);
    hidden.add(index);
    writeInstance(index, true);
  };
  const retire = (index: number) => {
    const house = live.get(index);
    if (!house) return;
    root.remove(house);
    live.delete(index);
    show(index);
  };
  const refreshMatrices = () => { for (const mesh of shells) mesh.instanceMatrix.needsUpdate = true; };
  return {
    root, houses: plots, nearMetres,
    update(playerX: number, playerZ: number) {
      plots.forEach((plot, index) => {
        const close = Math.hypot(plot.x - playerX, plot.z - playerZ) <= nearMetres;
        if (close) build(index);
        else if (live.has(index)) retire(index);
      });
      refreshMatrices();
    },
    isLive: (index: number) => live.has(index),
    liveHouse: (index: number) => live.get(index) ?? null,
    drawCalls: () => shells.length + root.children.filter(child => (child as THREE.Mesh).isMesh).length + live.size,
  };
}
`;
