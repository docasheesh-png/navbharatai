// 🔫 A HELD GUN POINTS WHERE THE HERO FACES, GRIP IN THE PALM, AT ITS REAL SIZE (admin 2026-11-27 screenshot: the young-man
// hero's gun hung sideways at his hip, far too big). The model hand used to take the item with NO turn (a rigged hand's axes
// run along the fingers), its CENTRE in the palm, and one size for everything (a third of the body). fitInHand() fixes all
// three for the player and every character. Runs the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH } from '../src/server/lib/GamePlayerBodyGenerator';

const DIR = join(__dirname, `.tmp-held-gun-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any;
beforeAll(async () => {
  (globalThis as any).window = globalThis;
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
}, 120_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).__nbHeld; });

/** A body facing +Z with a right hand bone turned the way rigged hands are (fingers down, palm sideways). */
const rig = () => {
  const body = new THREE.Group();
  const hand = new THREE.Bone(); hand.name = 'mixamorig:RightHand';
  hand.position.set(-0.3, 1.0, 0.1);
  hand.rotation.set(Math.PI / 2, 0.4, -Math.PI / 2);
  body.add(hand);
  body.updateMatrixWorld(true);
  return { body, hand };
};
/** A 2 m long "rifle", barrel along +Z, its origin at its middle (a typical library model). */
const rifle = () => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 2)); g.add(m); return g; };
const forwardOf = (o: THREE.Object3D) => new THREE.Vector3(0, 0, 1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));

describe('🔫 fitInHand', () => {
  it('the barrel points where the body faces, even through a twisted hand bone', () => {
    const { body, hand } = rig(); const gun = rifle();
    PB.fitInHand(gun, hand, body, 0.95);
    body.updateMatrixWorld(true);
    const f = forwardOf(gun);
    expect(f.z).toBeGreaterThan(0.99);
    // turned body: the barrel follows it
    body.rotation.y = Math.PI / 2; body.updateMatrixWorld(true);
    expect(forwardOf(gun).x).toBeGreaterThan(0.99);
  });
  it('it is the real length, and its grip (the rear third) is in the palm — not its middle', () => {
    const { body, hand } = rig(); const gun = rifle();
    PB.fitInHand(gun, hand, body, 0.95);
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gun);
    const len = box.getSize(new THREE.Vector3()).z;
    expect(len).toBeCloseTo(0.95, 2);
    const palm = hand.getWorldPosition(new THREE.Vector3());
    // most of the barrel is in front of the hand (the grip is near the back), never centred on it
    expect(box.max.z - palm.z).toBeGreaterThan(0.6);
    expect(palm.z - box.min.z).toBeLessThan(0.35);
  });
  it('heldLength: a pistol is a pistol, a rifle a rifle, a sniper longer; anything unknown a third of the body', () => {
    expect(PB.heldLength('pistol', 1.75)).toBeCloseTo(0.22, 2);
    expect(PB.heldLength('rifle', 1.75)).toBeCloseTo(0.95, 2);
    expect(PB.heldLength('sniper rifle', 1.75)).toBeCloseTo(1.15, 2);
    expect(PB.heldLength('magic orb', 1.8)).toBeCloseTo(0.54, 2);
  });
  it('holdInHand (any character) uses the same grip', () => {
    const { body, hand } = rig(); const gun = rifle();
    expect(PB.holdInHand(body, gun, 'right', 'rifle')).toBe(true);
    body.updateMatrixWorld(true);
    expect(gun.parent?.userData?.nbHoldPivot).toBe(true);
    expect(gun.parent?.parent).toBe(hand);
    expect(forwardOf(gun).z).toBeGreaterThan(0.99);
  });
});
