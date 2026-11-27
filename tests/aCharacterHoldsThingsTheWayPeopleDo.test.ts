// A CHARACTER HOLDS THINGS THE WAY PEOPLE DO (admin 2026-11-27: "character apne hath me gun theek se nahi pakadta hai …
// cricket me ball and bats, action game me gun … jab bhi koi user apne hath me koi object hold kare, to woh style ek dam
// natural honi chahiye jaisa duniya me normal log pakadte hai! … kya navbharatai ko aap sikha sakte hai").
//
// The defect: a held thing was hung from the hand by its OWN origin, scaled to a third of the person's height, in whatever
// direction its model faced — a library pistol 0.6 m long, through the wrist, pointing sideways; nothing found its grip.
// Now every hold goes through humanoid.ts: gripFor (what it is: real size, how it is held), gripFrame (where the hand goes
// on THIS model, read from its shape), holdPose (how it sits in a fist), reachWith (the support hand on a rifle).
// Runs the REAL generated kit with the real three.js, on models built in the WRONG orientation with an origin far from the
// grip — the way library models arrive.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const DIR = join(__dirname, `.tmp-grip-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let HU: any; let PB: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  if (!hadWindow) g.window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  HU = await import(join(DIR, 'src/game/three/humanoid.ts'));
  PB = await import(join(DIR, 'src/game/play/playerBody.ts'));
}, 120_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });

const box = (w: number, h: number, d: number, x: number, y: number, z: number, name: string) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d)); m.position.set(x, y, z); m.name = name; return m; };
const at = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };
const worldLength = (o: THREE.Object3D) => { const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()); return Math.max(s.x, s.y, s.z); };

/**
 * A library-style pistol, 2 units long (not metres), its barrel along -X, its grip hanging along +Z (so "down" is +Z),
 * and its origin 3 units away from everything: nothing about it is in the kit's frame.
 */
function wrongWayPistol() {
  const root = new THREE.Group();
  root.add(box(2, 0.3, 0.12, 3, 0, 3.15, 'slide'));                        // barrel/slide along -X: x from 2 to 4 (muzzle at x=2)
  const grip = box(0.42, 0.12, 0.9, 3.55, 0, 0.75 + 3, 'grip');              // grip hangs toward +Z, near the rear (x≈3.55)
  root.add(grip);
  root.add(box(0.2, 0.06, 0.1, 2.25, 0, 3.0, 'muzzle tip'));                 // front sight / muzzle end at x≈2.2
  return { root, grip, muzzle: root.children[2] };
}
/** A bat along +Y: a thin handle at the bottom (y 0..0.9), a wide blade above (y 0.9..3), origin 1 unit to the side. */
function bat() {
  const root = new THREE.Group();
  const handle = box(0.12, 0.9, 0.12, 1, 0.45, 0, 'handle'); root.add(handle);
  const blade = box(0.42, 2.1, 0.16, 1, 1.95, 0, 'blade'); root.add(blade);
  return { root, handle, blade };
}

describe('🔫 a gun is held by its grip, along the forearm, at its real size', () => {
  it('🔴 a wrong-way library pistol in the kit person\'s hand: grip in the fist, barrel along the forearm, top toward the thumb, 20 cm', () => {
    const hero = HU.createHumanoid({ height: 1.75 });
    const p = wrongWayPistol();
    hero.hold(p.root, 'pistol');
    hero.root.updateWorldMatrix(true, true);
    const hand = hero.joints.rightHand as THREE.Object3D;
    expect(worldLength(p.root)).toBeCloseTo(0.2, 1);                             // a real pistol, not a third of the person
    expect(at(p.grip).distanceTo(at(hand))).toBeLessThan(0.05);                  // the fist closes on the grip
    const out = new THREE.Vector3(0, -1, 0).transformDirection(hand.matrixWorld); // out through the fist, along the forearm
    const barrel = at(p.muzzle).sub(at(p.root.children[0])).normalize();   // along the slide, rear to muzzle
    expect(barrel.dot(out)).toBeGreaterThan(0.95);
    const thumb = new THREE.Vector3(0, 0, 1).transformDirection(hand.matrixWorld);
    const top = at(p.root.children[0]).sub(at(p.grip)).normalize();            // the slide sits above the grip
    expect(top.dot(thumb)).toBeGreaterThan(0.3);
  });
  it('the kit\'s own weapon (createWeapon) keeps its real size and sits grip-in-fist', () => {
    const hero = HU.createHumanoid({ height: 1.75 });
    const w = new THREE.Group(); w.userData.nbGripFrame = 'pistol'; w.add(box(0.03, 0.12, 0.19, 0, 0.04, 0.08, 'pistol body'));
    hero.hold(w);
    hero.root.updateWorldMatrix(true, true);
    expect(w.scale.x).toBe(1);                                                   // made at real size: never rescaled
    expect(at(w).distanceTo(at(hero.joints.rightHand))).toBeLessThan(1e-6);
  });
});

describe('🏏 a handle runs through the fist, the blade past the thumb', () => {
  it('🔴 a bat built upside-down-in-units: its THIN end is in the hand, 86 cm long, blade toward the thumb', () => {
    const hero = HU.createHumanoid({ height: 1.75 });
    const b = bat();
    hero.hold(b.root, 'cricket bat');
    hero.root.updateWorldMatrix(true, true);
    const hand = hero.joints.rightHand as THREE.Object3D;
    expect(worldLength(b.root)).toBeCloseTo(0.86, 1);
    expect(at(b.handle).distanceTo(at(hand))).toBeLessThan(at(b.blade).distanceTo(at(hand)));
    const handleEndToHand = at(hand).distanceTo(at(b.handle));
    expect(handleEndToHand).toBeLessThan(0.15);
    const thumb = new THREE.Vector3(0, 0, 1).transformDirection(hand.matrixWorld);
    expect(at(b.blade).sub(at(hand)).normalize().dot(thumb)).toBeGreaterThan(0.85);
  });
  it('a ball sits in the palm at a ball\'s size', () => {
    const hero = HU.createHumanoid({ height: 1.75 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8)); ball.position.set(10, 0, 0);
    const holder = new THREE.Group(); holder.add(ball);
    hero.hold(holder, 'cricket ball');
    hero.root.updateWorldMatrix(true, true);
    expect(holder.scale.x * 6).toBeCloseTo(0.072, 3);                            // a 6-unit sphere becomes a 7.2 cm ball
    expect(at(ball).distanceTo(at(hero.joints.rightHand))).toBeLessThan(0.02);
  });
});

describe('🪖 a rifle takes both hands', () => {
  it('🔴 carried at the low ready: the left hand is ON the fore-grip, every frame of the walk', () => {
    const hero = HU.createHumanoid({ height: 1.75 });
    const rifle = new THREE.Group();
    rifle.add(box(0.06, 0.1, 0.9, 0, 0, 0, 'body'));                           // barrel along +Z (muzzle end slimmer below)
    rifle.add(box(0.05, 0.03, 0.2, 0, 0, 0.5, 'barrel'));
    rifle.add(box(0.04, 0.18, 0.06, 0, -0.12, -0.15, 'pistol grip'));
    rifle.add(box(0.05, 0.22, 0.25, 0, -0.04, -0.42, 'stock'));
    hero.hold(rifle, 'AK-47');
    for (let i = 0; i < 40; i++) {
      hero.update(1 / 30, 3, true);
      hero.root.updateWorldMatrix(true, true);
      const grip = hero.joints.rightHand.children.find((c: THREE.Object3D) => c.userData.nbGrip === 'rifle');
      expect(grip, 'the rifle is in the right hand').toBeTruthy();
      const support = grip.userData.nbSupport as THREE.Object3D;
      expect(at(hero.joints.leftHand).distanceTo(at(support)), `frame ${i}`).toBeLessThan(0.03);
    }
  });
  it('gripFor reads what people call things', () => {
    expect(HU.gripFor('AK-47')).toMatchObject({ style: 'rifle' });
    expect(HU.gripFor('red cricket ball')).toMatchObject({ style: 'palm', length: 0.072 });
    expect(HU.gripFor('Cricket Bat')).toMatchObject({ style: 'twoHand' });
    expect(HU.gripFor('tennis racket')).toMatchObject({ style: 'handle' });
    expect(HU.gripFor('dragon')).toBeNull();
  });
});

describe('🦴 a model character holds it in its hand bone the same way', () => {
  it('🔴 a rigged arm (mixamo names): the pistol\'s grip at the palm, barrel along the forearm, real size', () => {
    const body = new THREE.Group();
    const bone = (name: string, x: number, y: number, z: number, parent: THREE.Object3D) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); return b; };
    const hips = bone('mixamorig:Hips', 0, 1.0, 0, body);
    const upper = bone('mixamorig:RightArm', -0.2, 0.45, 0, hips);
    const fore = bone('mixamorig:RightForeArm', 0, -0.28, 0, upper);
    const hand = bone('mixamorig:RightHand', 0, -0.26, 0, fore);
    bone('mixamorig:RightHandMiddle1', 0, -0.09, 0, hand);
    bone('mixamorig:Head', 0, 0.75, 0, hips);
    body.add(box(0.3, 1.75, 0.2, 0, 0.875, 0, 'mesh'));                       // so the character measures 1.75 m tall
    const p = wrongWayPistol();
    expect(PB.holdInHand(body, p.root, 'right', 'pistol')).toBe(true);
    body.updateWorldMatrix(true, true);
    expect(worldLength(p.root)).toBeCloseTo(0.2, 1);
    const out = at(hand).sub(at(fore)).normalize();
    expect(at(p.grip).distanceTo(at(hand).add(out.clone().multiplyScalar(0.045 * 1.75)))).toBeLessThan(0.05);
    expect(at(p.muzzle).sub(at(p.root.children[0])).normalize().dot(out)).toBeGreaterThan(0.95);
  });
});

describe('🔒 every hold path goes through the grip', () => {
  it('the kit person, a model character and holdInHand all call gripFrame; nothing hangs an item by its own origin any more', () => {
    const body = recipeFilePool().get('src/game/play/playerBody.ts')?.content ?? '';
    const human = recipeFilePool().get('src/game/three/humanoid.ts')?.content ?? '';
    expect(human).toMatch(/const frame = item\.userData\.nbGrip \? item : gripFrame\(item, spec,/);
    expect((body.match(/gripFrame\(item, spec,/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(body).not.toMatch(/const want = 0\.3 \* tall(?:ness)?;/);
    expect(human).not.toMatch(/item\.rotation\.set\(Math\.PI \/ 2, 0, 0\);/);
  });
});
