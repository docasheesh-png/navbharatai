/**
 * 🎬 THE ACTION PLAYS ON THE CHARACTER THE USER CHOSE (admin 2026-11-24: "usi character jo abhi user ne select kiya woh karne
 * lage"). A library model, or the user's own .glb, with no clip for the action: play/actions.ts poses its skeleton's bones
 * (found by name) and puts what it picks up in the model's own hand bone. Real kit files, real three.js, a mocked loader.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE } from '../src/server/lib/GamePlayerBodyGenerator';
import { GAME_ACTIONS, GAME_ACTIONS_PATH } from '../src/server/lib/GameActionsGenerator';

function rigged() {
  const scene = new THREE.Group();
  const arm = new THREE.Bone(); arm.name = 'mixamorig:RightArm'; arm.position.set(-0.3, 1.5, 0);
  const fore = new THREE.Bone(); fore.name = 'mixamorig:RightForeArm'; fore.position.set(0, -0.3, 0);
  const hand = new THREE.Bone(); hand.name = 'mixamorig:RightHand'; hand.position.set(0, -0.28, 0);
  const tip = new THREE.Bone(); tip.name = 'mixamorig:RightHandIndex1'; tip.position.set(0, -0.1, 0);
  arm.add(fore); fore.add(hand); hand.add(tip); scene.add(arm);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)); body.position.y = 0.9; scene.add(body);
  return { scene, animations: [] as THREE.AnimationClip[] };
}
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { async loadAsync() { return rigged(); } } }));

const DIR = join(__dirname, `.tmp-chosen-action-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let ACT: any; let HM: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, 'src/game/player.ts'), GAME_PLAYER_FILE);
  writeFileSync(join(DIR, GAME_ACTIONS_PATH), GAME_ACTIONS);
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  ACT = await import(join(DIR, GAME_ACTIONS_PATH));
  HM = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const named = (root: THREE.Object3D, n: string) => { let f: THREE.Object3D | null = null; root.traverse((o) => { if (o.name === n) f = o; }); return f as unknown as THREE.Object3D; };

describe('🔴 a library model with no clip for it picks up the gun with its own hand', () => {
  it('the model is posed, and the gun ends in the model\'s RightHand bone', async () => {
    const scene = new THREE.Scene();
    const player = { object: new THREE.Group(), speed: 0, isGrounded: true };
    scene.add(player.object);
    const hero = HM.createHumanoid({ height: 1.75 });
    player.object.add(hero.root);
    const ctx: any = { scene, player, hero };
    const body = PB.applyPlayerChoice(ctx, { file: '/models/hero.glb' });
    await settle();
    expect(body.showing).toBe('model');
    const model = PB.playerModelRoot(ctx);
    expect(model).toBeTruthy();
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.5)); gun.name = 'gun'; gun.userData.pickup = true; gun.position.set(0.5, 0, 0.6);
    scene.add(gun);
    const arm = named(model, 'mixamorig:RightArm');
    const rest = arm.quaternion.clone();
    expect(ACT.performAction(ctx, 'pick-up')).toBe(true);
    let moved = false;
    for (let t = 0; t < 1.1; t += 1 / 60) { body.update(1 / 60); ACT.updateActions(ctx, 1 / 60); if (arm.quaternion.angleTo(rest) > 0.2) moved = true; }
    expect(moved).toBe(true);
    expect(gun.parent).toBe(named(model, 'mixamorig:RightHand'));
  });
});
