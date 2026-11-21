// THINGS FALL, ROLL AND RAGDOLL (admin 2026-11-21 plan: "real physics: objects that fall over, roll and ragdoll").
// Runs the REAL generated three/physics.ts on the real cannon-es and the kit's own humanoid: a dropped crate comes to rest
// on the ground, a stack stands, a blast topples it, a kit wall stops a rolling ball, the mesh follows its body, and a
// ragdolled character lands on the ground with every limb still attached.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';
import { GAME_PHYSICS_VERSION } from '../src/server/lib/GamePhysicsGenerator';
import { recipeDependenciesNeeded } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-physics-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let P: any; let H: any; let K: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['physics', 'humanoid']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  P = await import(join(DIR, 'src/game/three/physics.ts'));
  H = await import(join(DIR, 'src/game/three/humanoid.ts'));
  K = await import(join(DIR, 'src/game/three/collision.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const box = (w = 1, h = 1, d = 1) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
const run = (physics: any, seconds: number) => { for (let i = 0; i < seconds * 60; i++) physics.step(1 / 60); };

describe('🧱 physics ships only where it is used', () => {
  it('is a kit module that brings collision, and installs cannon-es only when it ships', () => {
    expect(GAME_3D_MODULES).toContain('physics');
    const g = generateGame3D(['physics']);
    expect(Object.keys(g.files)).toEqual(expect.arrayContaining(['src/game/three/physics.ts', 'src/game/three/collision.ts']));
    expect(g.dependencies).toContainEqual({ name: 'cannon-es', version: GAME_PHYSICS_VERSION });
    expect(generateGame3D(['city']).dependencies.map((d) => d.name)).not.toContain('cannon-es');
    expect(g.instructions).toMatch(/createPhysics\(scene\)/);
    // The builder installs it when a written file imports it, and not otherwise.
    const pkg0 = JSON.stringify({ dependencies: { three: '^0.180.0' }, devDependencies: { '@types/three': '^0.180.0' } });
    expect(recipeDependenciesNeeded(g.files, pkg0)).toContainEqual({ name: 'cannon-es', version: GAME_PHYSICS_VERSION, dev: false });
    expect(recipeDependenciesNeeded(generateGame3D(['city']).files, pkg0).map((d) => d.name)).not.toContain('cannon-es');
    // The version the kit installs is the version our own tests run against.
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));
    expect(pkg.devDependencies['cannon-es']).toBe(GAME_PHYSICS_VERSION);
  });
});

describe('🧱 rigid bodies', () => {
  it('a dropped crate falls, lands on the ground and comes to rest (the mesh follows its body)', () => {
    const scene = new THREE.Scene();
    const crate = box(); crate.position.set(0, 5, 0); scene.add(crate);
    const physics = P.createPhysics(scene);
    physics.add(crate, { mass: 5 });
    run(physics, 1);
    expect(crate.position.y).toBeLessThan(5);   // it moved, and the mesh shows it
    run(physics, 3);
    expect(crate.position.y).toBeCloseTo(0.5, 1);
    expect(physics.bodyOf(crate).velocity.length()).toBeLessThan(0.05);
  });

  it('a stack of five boxes stands on its own (no jitter, no drift)', () => {
    const scene = new THREE.Scene();
    const physics = P.createPhysics(scene);
    const stack = Array.from({ length: 5 }, (_, i) => { const b = box(); b.position.set(0, 0.5 + i, 0); scene.add(b); physics.add(b, { mass: 1 }); return b; });
    run(physics, 5);
    stack.forEach((b, i) => {
      expect(Math.abs(b.position.x)).toBeLessThan(0.05);
      expect(Math.abs(b.position.z)).toBeLessThan(0.05);
      expect(b.position.y).toBeCloseTo(0.5 + i, 1);
    });
  });

  it('a blast beside the stack topples it and throws the boxes away from the blast', () => {
    const scene = new THREE.Scene();
    const physics = P.createPhysics(scene);
    const stack = Array.from({ length: 5 }, (_, i) => { const b = box(); b.position.set(0, 0.5 + i, 0); scene.add(b); physics.add(b, { mass: 1 }); return b; });
    run(physics, 1);
    expect(physics.explode(new THREE.Vector3(-2, 1, 0), 15, 8)).toBe(5);
    run(physics, 4);
    expect(Math.max(...stack.map((b) => b.position.y))).toBeLessThan(2.5);   // nothing stands five high any more
    expect(stack.every((b) => b.position.x > 0)).toBe(true);                 // all thrown away from the blast
    expect(physics.explode(new THREE.Vector3(100, 0, 100), 15, 8)).toBe(0);  // out of range: nothing moves
  });

  it('a ball rolls, and a solid kit wall stops it', () => {
    const scene = new THREE.Scene();
    const wall = K.markWorldCollider(box(1, 3, 10)); wall.position.set(8, 1.5, 0); scene.add(wall);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial()); ball.position.set(0, 0.5, 0); scene.add(ball);
    const physics = P.createPhysics(scene);
    const body = physics.add(ball, { mass: 1 });
    expect(body.shapes[0].constructor.name).toBe('Sphere');
    body.velocity.set(10, 0, 0);
    run(physics, 0.3);
    const turned = new THREE.Euler().setFromQuaternion(ball.quaternion);
    expect(Math.abs(turned.z) + Math.abs(turned.x) + Math.abs(turned.y)).toBeGreaterThan(0.2);   // it rolls, not slides
    run(physics, 3);
    expect(ball.position.x).toBeLessThan(8 - 0.5 - 0.5 + 0.05);   // stopped at the wall's face
    expect(ball.position.x).toBeGreaterThan(2);
  });

  it('a mass of 0 never moves; remove and dispose leave nothing behind', () => {
    const scene = new THREE.Scene();
    const physics = P.createPhysics(scene);
    const fixed = box(); fixed.position.set(0, 3, 0); scene.add(fixed);
    physics.add(fixed, { mass: 0 });
    run(physics, 1);
    expect(fixed.position.y).toBe(3);
    physics.remove(fixed);
    expect(physics.bodyOf(fixed)).toBeNull();
    physics.dispose();
    expect(physics.world.bodies.length).toBe(0);
  });
});

describe('🧍 ragdoll', () => {
  it('a kit character goes limp, lands on the ground and keeps every limb attached', () => {
    const scene = new THREE.Scene();
    const hero = H.createHumanoid({ height: 1.8 }); hero.root.position.set(0, 0, 0); scene.add(hero.root);
    const physics = P.createPhysics(scene);
    const doll = physics.ragdoll(hero);
    expect(doll.bodies.length).toBe(11);
    const reach = (a: string, b: string) => hero.joints[a].getWorldPosition(new THREE.Vector3()).distanceTo(hero.joints[b].getWorldPosition(new THREE.Vector3()));
    const before = { arm: reach('leftShoulder', 'leftElbow'), shin: reach('leftKnee', 'leftHip'), neck: reach('chest', 'neck') };
    doll.push(new THREE.Vector3(3, 0, 0));
    run(physics, 4);
    hero.root.updateMatrixWorld(true);
    const head = hero.joints.head.getWorldPosition(new THREE.Vector3());
    expect(head.y).toBeLessThan(0.6);                            // it fell down
    expect(head.y).toBeGreaterThan(-0.05);                       // and not through the ground
    for (const b of doll.bodies) expect(b.position.y).toBeGreaterThan(-0.05);
    // Joints still held together: every bone length the same as standing (within 10%).
    expect(reach('leftShoulder', 'leftElbow')).toBeCloseTo(before.arm, 1);
    expect(reach('leftKnee', 'leftHip')).toBeCloseTo(before.shin, 1);
    expect(reach('chest', 'neck')).toBeCloseTo(before.neck, 1);
    expect(doll.bodies.every((b: any) => b.velocity.length() < 0.3)).toBe(true);   // and it came to rest
    // And the physical bones themselves are pinned: each joint's two pivots still meet.
    expect(physics.world.constraints.length).toBe(10);
    for (const c of physics.world.constraints as any[]) {
      const a = c.bodyA.pointToWorldFrame(c.pivotA), b = c.bodyB.pointToWorldFrame(c.pivotB);
      expect(a.vsub(b).length()).toBeLessThan(0.05);
    }
    doll.remove();
    expect(physics.world.bodies.length).toBe(1);   // only the ground left
  });
});
