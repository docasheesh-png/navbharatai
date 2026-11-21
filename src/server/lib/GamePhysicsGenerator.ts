/**
 * REAL PHYSICS (admin 2026-11-21 plan: "objects that fall over, roll and ragdoll"). The kit had none: a crate a car hit
 * stopped it but never moved, a stack of boxes could not topple, a character's death was a canned animation. Writing a
 * rigid-body engine is how games get jittering stacks and objects exploding through floors, so this is built on
 * cannon-es (MIT, no dependencies, the maintained fork of cannon.js) — and only a game that imports this module ships it.
 *
 *   const physics = createPhysics(scene);           // gravity, a ground at y = 0, the scene's solid walls as obstacles
 *   physics.add(crate, { mass: 5 });                // a box or sphere sized from the mesh itself
 *   physics.explode(at, 30, 6);                     // everything near is thrown outward
 *   const doll = physics.ragdoll(humanoid);         // a kit character goes limp and falls, joints held together
 *   // every frame: physics.step(dt)
 *
 * String.raw: no backticks and no dollar-brace sequences inside the module text.
 */
/** The exact cannon-es the kit installs (pinned: a physics engine's behaviour must not change under a published game). */
export const GAME_PHYSICS_VERSION = '0.20.0';

export const GAME_PHYSICS = String.raw`import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { worldColliders } from './collision';

export interface BodyOptions {
  /** 0 = never moves (a wall). Default 1. */
  mass?: number;
  /** 'auto' (default) picks a sphere for round meshes, else a box, from the mesh's own size. */
  shape?: 'auto' | 'box' | 'sphere';
  /** Bounciness 0–1 (default 0.2) and grip 0–1 (default 0.4). */
  restitution?: number;
  friction?: number;
}

export interface Ragdoll {
  readonly bodies: CANNON.Body[];
  /** Give the ragdoll a shove (a hit, a blast). */
  push(impulse: THREE.Vector3): void;
  remove(): void;
}

export interface Physics {
  world: CANNON.World;
  add(mesh: THREE.Object3D, options?: BodyOptions): CANNON.Body;
  remove(mesh: THREE.Object3D): void;
  bodyOf(mesh: THREE.Object3D): CANNON.Body | null;
  /** Throw everything within radius away from a point (strength = impulse at the centre, falling off to 0 at radius). */
  explode(at: THREE.Vector3, strength: number, radius: number): number;
  /** A kit humanoid (createHumanoid) goes limp and falls. */
  ragdoll(humanoid: { root: THREE.Object3D; joints: Record<string, THREE.Object3D> }): Ragdoll;
  /** Advance at a fixed 60 Hz and move every mesh to its body. */
  step(dt: number): void;
  dispose(): void;
}

export interface PhysicsOptions {
  gravity?: number;
  /** The ground's height (default 0), or false for none. */
  ground?: number | false;
  /** Add the scene's solid world colliders (kit buildings, walls, city blocks) as fixed obstacles. Default true. */
  sceneObstacles?: boolean;
}

const v3 = (v: THREE.Vector3) => new CANNON.Vec3(v.x, v.y, v.z);

/** A physics world for this scene: things fall, roll, stack, topple and come to rest. */
export function createPhysics(scene: THREE.Object3D, options: PhysicsOptions = {}): Physics {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, options.gravity ?? -9.82, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.SAPBroadphase(world);
  (world.solver as CANNON.GSSolver).iterations = 12;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.2;
  const meshes = new Map<THREE.Object3D, CANNON.Body>();
  const fixed: CANNON.Body[] = [];
  if (options.ground !== false) {
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.position.y = typeof options.ground === 'number' ? options.ground : 0;
    world.addBody(ground); fixed.push(ground);
  }
  if (options.sceneObstacles !== false) {
    scene.updateMatrixWorld(true);
    for (const mesh of worldColliders(scene, [], undefined, false)) {
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
      if (size.x * size.y * size.z > 1e6) continue;   // a whole-city merged mesh would be one giant box: skip it
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)) });
      body.position.copy(v3(centre));
      world.addBody(body); fixed.push(body);
    }
  }

  const shapeFor = (mesh: THREE.Object3D, kind: BodyOptions['shape']): CANNON.Shape => {
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    const round = Math.max(size.x, size.y, size.z) - Math.min(size.x, size.y, size.z) < 0.15 * Math.max(size.x, size.y, size.z)
      && (mesh as THREE.Mesh).geometry?.type?.includes('Sphere');
    if (kind === 'sphere' || (kind !== 'box' && round)) return new CANNON.Sphere(Math.max(size.x, size.y, size.z) / 2);
    return new CANNON.Box(new CANNON.Vec3(Math.max(0.01, size.x / 2), Math.max(0.01, size.y / 2), Math.max(0.01, size.z / 2)));
  };

  const add = (mesh: THREE.Object3D, o: BodyOptions = {}): CANNON.Body => {
    const old = meshes.get(mesh);
    if (old) return old;
    mesh.updateWorldMatrix(true, false);
    const rotation = mesh.quaternion.clone();
    mesh.quaternion.identity(); mesh.updateMatrixWorld(true);   // size the shape in the mesh's own frame
    const shape = shapeFor(mesh, o.shape ?? 'auto');
    const centre = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    mesh.quaternion.copy(rotation); mesh.updateMatrixWorld(true);
    const material = new CANNON.Material();
    const body = new CANNON.Body({ mass: Math.max(0, o.mass ?? 1), material, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.6 });
    body.addShape(shape, v3(centre.sub(mesh.position)));
    body.position.copy(v3(mesh.getWorldPosition(new THREE.Vector3())));
    const wq = mesh.getWorldQuaternion(new THREE.Quaternion());
    body.quaternion.set(wq.x, wq.y, wq.z, wq.w);
    material.friction = o.friction ?? 0.4; material.restitution = o.restitution ?? 0.2;
    world.addBody(body);
    meshes.set(mesh, body);
    return body;
  };

  const remove = (mesh: THREE.Object3D) => {
    const b = meshes.get(mesh);
    if (b) { world.removeBody(b); meshes.delete(mesh); }
  };

  const explode = (at: THREE.Vector3, strength: number, radius: number): number => {
    let hit = 0;
    const centre = v3(at);
    for (const body of [...meshes.values(), ...ragdollBodies]) {
      if (body.mass <= 0) continue;
      const d = body.position.vsub(centre);
      const dist = d.length();
      if (dist > radius) continue;
      const push = strength * (1 - dist / radius);
      const dir = dist > 1e-4 ? d.scale(1 / dist) : new CANNON.Vec3(0, 1, 0);
      dir.y += 0.35;   // a blast lifts as well as pushes
      body.wakeUp();
      body.applyImpulse(dir.scale(push));
      hit++;
    }
    return hit;
  };

  // ── Ragdoll: one box per bone between a joint and the next, held at the joints ──
  const ragdollBodies = new Set<CANNON.Body>();
  const ragdolls = new Set<() => void>();
  const ragdoll = (humanoid: { root: THREE.Object3D; joints: Record<string, THREE.Object3D> }): Ragdoll => {
    const J = humanoid.joints;
    humanoid.root.updateMatrixWorld(true);
    const at = (name: string) => J[name].getWorldPosition(new THREE.Vector3());
    // Each bone: the joint it hangs from, the joint (or point) it reaches, its thickness.
    const top = at('head').clone().add(new THREE.Vector3(0, 0.22, 0));
    const handOf = (side: string) => J[side + 'Hand'] ? at(side + 'Hand') : at(side + 'Elbow');
    const footOf = (side: string) => at(side + 'Knee').clone().add(at(side + 'Knee').clone().sub(at(side + 'Hip')));
    const bones: Array<{ joint: string; from: THREE.Vector3; to: THREE.Vector3; r: number; parent: number }> = [
      { joint: 'hips', from: at('hips'), to: at('chest'), r: 0.16, parent: -1 },
      { joint: 'chest', from: at('chest'), to: at('neck'), r: 0.17, parent: 0 },
      { joint: 'head', from: at('neck'), to: top, r: 0.12, parent: 1 },
      { joint: 'leftShoulder', from: at('leftShoulder'), to: at('leftElbow'), r: 0.06, parent: 1 },
      { joint: 'leftElbow', from: at('leftElbow'), to: handOf('left'), r: 0.05, parent: 3 },
      { joint: 'rightShoulder', from: at('rightShoulder'), to: at('rightElbow'), r: 0.06, parent: 1 },
      { joint: 'rightElbow', from: at('rightElbow'), to: handOf('right'), r: 0.05, parent: 5 },
      { joint: 'leftHip', from: at('leftHip'), to: at('leftKnee'), r: 0.08, parent: 0 },
      { joint: 'leftKnee', from: at('leftKnee'), to: footOf('left'), r: 0.07, parent: 7 },
      { joint: 'rightHip', from: at('rightHip'), to: at('rightKnee'), r: 0.08, parent: 0 },
      { joint: 'rightKnee', from: at('rightKnee'), to: footOf('right'), r: 0.07, parent: 9 },
    ];
    const bodies: CANNON.Body[] = [];
    const rest: Array<{ jointWorld: THREE.Quaternion; bodyWorld: THREE.Quaternion }> = [];
    const constraints: CANNON.Constraint[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of bones) {
      const axis = b.to.clone().sub(b.from);
      const len = Math.max(0.05, axis.length());
      const q = new THREE.Quaternion().setFromUnitVectors(up, axis.clone().normalize());
      const body = new CANNON.Body({ mass: b.joint === 'hips' || b.joint === 'chest' ? 8 : 2, angularDamping: 0.6, linearDamping: 0.05 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(b.r, len / 2, b.r)));
      const mid = b.from.clone().add(b.to).multiplyScalar(0.5);
      body.position.copy(v3(mid));
      body.quaternion.set(q.x, q.y, q.z, q.w);
      world.addBody(body); bodies.push(body); ragdollBodies.add(body);
      rest.push({ jointWorld: J[b.joint].getWorldQuaternion(new THREE.Quaternion()), bodyWorld: q.clone() });
    }
    // Joints: each bone is pinned to its parent at the joint it hangs from.
    bones.forEach((b, i) => {
      if (b.parent < 0) return;
      const pa = bodies[b.parent], ch = bodies[i];
      const pivot = b.from;
      const local = (body: CANNON.Body) => body.pointToLocalFrame(v3(pivot));
      const c = new CANNON.PointToPointConstraint(pa, local(pa), ch, local(ch));
      world.addConstraint(c); constraints.push(c);
    });
    // Each frame: every joint takes its bone's rotation; the hips also take its position.
    const sync = () => {
      bones.forEach((b, i) => {
        const body = bodies[i];
        const bq = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        const world = bq.multiply(rest[i].bodyWorld.clone().invert()).multiply(rest[i].jointWorld);
        const node = J[b.joint];
        const parentQ = node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        node.quaternion.copy(parentQ.invert().multiply(world));
        if (i === 0) {
          // The hips joint's world position follows its bone's lower end.
          const lower = new THREE.Vector3(0, -(b.to.distanceTo(b.from)) / 2, 0)
            .applyQuaternion(new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w))
            .add(new THREE.Vector3(body.position.x, body.position.y, body.position.z));
          const parent = node.parent;
          if (parent) { parent.updateMatrixWorld(true); node.position.copy(parent.worldToLocal(lower)); }
        }
        node.updateMatrixWorld(true);
      });
    };
    ragdolls.add(sync);
    return {
      bodies,
      push: (impulse) => { for (const b of bodies) { b.wakeUp(); b.applyImpulse(v3(impulse).scale(b.mass / 8)); } },
      remove: () => {
        ragdolls.delete(sync);
        for (const c of constraints) world.removeConstraint(c);
        for (const b of bodies) { world.removeBody(b); ragdollBodies.delete(b); }
      },
    };
  };

  return {
    world, add, remove, explode, ragdoll,
    bodyOf: (mesh) => meshes.get(mesh) ?? null,
    step: (dt) => {
      if (!(dt > 0)) return;
      world.step(1 / 60, Math.min(dt, 0.1), 6);   // fixed 60 Hz substeps from the game's own dt (fixedStep reads the wall clock)
      for (const [mesh, body] of meshes) {
        if (body.mass <= 0) continue;
        const target = new THREE.Vector3(body.position.x, body.position.y, body.position.z);
        if (mesh.parent) { mesh.parent.updateMatrixWorld(true); mesh.parent.worldToLocal(target); }
        mesh.position.copy(target);
        const wq = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
        const pq = mesh.parent ? mesh.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
        mesh.quaternion.copy(pq.invert().multiply(wq));
      }
      for (const sync of ragdolls) sync();
    },
    dispose: () => {
      for (const sync of [...ragdolls]) ragdolls.delete(sync);
      for (const b of [...world.bodies]) world.removeBody(b);
      for (const c of [...world.constraints]) world.removeConstraint(c);
      meshes.clear(); ragdollBodies.clear();
    },
  };
}
`;
