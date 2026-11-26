/**
 * THE APP MAKER MAKES THE MOVEMENT ITSELF (admin 2026-11-26: "mujhe aisa app maker chahiye jo movement khud bana le", with a
 * screenshot of an open-world game saying "Your character has no punch move of its own. It is not animated when the game
 * asks for it.").
 *
 * Root cause: the kit made a missing move from the skeleton only when it found the arm bones by EXACT mixamo/Blender names;
 * any other rig ("Bip01 R UpperArm", "DEF-upper_arm.R", "Arm_R_012") and any model with no skeleton got that line instead
 * of a move, and a model with no walk clip walked as a statue. Now:
 *   • findBonesByShape reads the arm and leg chains from the skeleton's SHAPE (names still win);
 *   • a model with no bones for a move makes it with its WHOLE BODY (RIGID_MOVES);
 *   • walking and running are made when there is no clip (MADE_GAIT): legs and arms swing, or the body steps.
 * The kit file runs here with the real three.js.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE } from '../src/server/lib/GamePlayerBodyGenerator';
import { lackedMovesClause, playerMovesLine } from '../src/server/lib/playerMoves';

/** A 3ds Max "Biped" skeleton (names the kit has never heard of), standing 1.8 m, facing +Z; its right is -X. */
function biped(): THREE.Group {
  const scene = new THREE.Group();
  const mk = (name: string, x: number, y: number, z = 0) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); return b; };
  const pelvis = mk('Bip01 Pelvis', 0, 1.0);
  const spine = mk('Bip01 Spine', 0, 0.15); pelvis.add(spine);
  const chest = mk('Bip01 Spine2', 0, 0.3); spine.add(chest);
  chest.add(mk('Bip01 Neck', 0, 0.12));
  for (const side of [-1, 1]) {
    const tag = side < 0 ? 'R' : 'L';
    const clav = mk(`Bip01 ${tag} Clavicle`, side * 0.08, 0.08); chest.add(clav);
    const up = mk(`Bip01 ${tag} UpperArm`, side * 0.12, 0); clav.add(up);
    const fore = mk(`Bip01 ${tag} Forearm`, side * 0.28, 0); up.add(fore);
    const hand = mk(`Bip01 ${tag} Hand`, side * 0.26, 0); fore.add(hand);
    hand.add(mk(`Bip01 ${tag} Finger0`, side * 0.05, 0, 0.02), mk(`Bip01 ${tag} Finger1`, side * 0.06, 0, -0.02));
    const thigh = mk(`Bip01 ${tag} Thigh`, side * 0.1, -0.05); pelvis.add(thigh);
    const calf = mk(`Bip01 ${tag} Calf`, 0, -0.45); thigh.add(calf);
    const foot = mk(`Bip01 ${tag} Foot`, 0, -0.42); calf.add(foot);
    foot.add(mk(`Bip01 ${tag} Toe0`, 0, -0.05, 0.12));
  }
  scene.add(pelvis);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.25)); mesh.position.y = 0.9; scene.add(mesh);
  return scene;
}
function statue(): THREE.Group { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)); m.position.y = 0.9; g.add(m); return g; }
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { async loadAsync(url: string) { return { scene: url.includes('statue') ? statue() : biped(), animations: [new THREE.AnimationClip('Idle', 1, [])] }; } } }));

const DIR = join(__dirname, `.tmp-own-moves-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let E: any;
const hints: string[] = [];
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, 'src/game/player.ts'), GAME_PLAYER_FILE);
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  E.events.on('HINT', (p: { text: string }) => hints.push(p.text));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const named = (c: any, n: string) => { let h: THREE.Object3D | null = null; c.root.traverse((o: THREE.Object3D) => { if (o.name === n) h = o; }); return h as unknown as THREE.Object3D; };
const world = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };

describe('🦴 bones by the skeleton\'s shape', () => {
  it('a Biped rig: arms past the clavicle, legs from the pelvis, the right side on -X', () => {
    const b = PB.findBonesByShape(biped());
    expect(b.rightUpperArm?.name).toBe('Bip01 R UpperArm');
    expect(b.rightForeArm?.name).toBe('Bip01 R Forearm');
    expect(b.rightHand?.name).toBe('Bip01 R Hand');
    expect(b.leftHand?.name).toBe('Bip01 L Hand');
    expect(b.rightUpLeg?.name).toBe('Bip01 R Thigh');
    expect(b.rightLeg?.name).toBe('Bip01 R Calf');
    expect(b.leftUpLeg?.name).toBe('Bip01 L Thigh');
  });
  it('a few loose bones are not a skeleton: nothing is guessed', () => {
    const g = new THREE.Group(); for (let i = 0; i < 3; i++) g.add(new THREE.Bone());
    expect(PB.findBonesByShape(g)).toEqual({});
  });
});

describe('🔴 the screenshot: a character with no punch clip', () => {
  it('a Biped-rigged model punches from its skeleton: the fist goes forward and comes back', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/biped.glb' });
    await settle();
    const hand = named(c, 'Bip01 R Hand');
    const rest = world(hand).clone();
    expect(c.act('punch')).toBe(true);
    c.update(0.17);
    expect(world(hand).z - rest.z).toBeGreaterThan(0.2);
    for (let i = 0; i < 12; i++) c.update(0.05);
    expect(world(hand).distanceTo(rest)).toBeLessThan(1e-3);
    expect(hints).toContain('Your character has no punch move of its own, so NavBharatAI animates one from its skeleton.');
  });
  it('a model with NO skeleton punches with its whole body: it lunges forward and returns', async () => {
    const holder = new THREE.Group();
    const c = PB.createPlayerCharacter(holder, { file: '/models/statue.glb' });
    await settle();
    const top = () => { const b = new THREE.Box3().setFromObject(c.root); return b.max.z; };
    const rest = top();
    expect(c.act('punch')).toBe(true);
    c.update(0.17);
    expect(top() - rest).toBeGreaterThan(0.15);           // the body leaned and stepped into it
    for (let i = 0; i < 12; i++) c.update(0.05);
    expect(Math.abs(top() - rest)).toBeLessThan(1e-6);
    expect(hints).toContain('Your character has no punch move of its own, so NavBharatAI animates one with its whole body.');
    expect(hints.some((h) => /It is not animated when the game asks for it/.test(h))).toBe(false);
  });
});

describe('🚶 walking and running with no clip', () => {
  it('a rigged model swings its legs: the knee goes forward and back, and stands still again on idle', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/biped.glb' });
    await settle();
    const knee = named(c, 'Bip01 R Calf');
    const rest = world(knee).z;
    expect(c.move('walk')).toBe(true);
    const zs: number[] = [];
    for (let i = 0; i < 40; i++) { c.update(1 / 60); zs.push(world(knee).z - rest); }
    expect(Math.max(...zs)).toBeGreaterThan(0.08);
    expect(Math.min(...zs)).toBeLessThan(-0.08);
    c.move('idle'); c.update(1 / 60);
    expect(Math.abs(world(knee).z - rest)).toBeLessThan(1e-6);
    expect(hints).toContain('Your character has no walk move of its own, so NavBharatAI animates one.');
  });
  it('a model with no skeleton steps with its whole body (it bobs)', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/statue.glb' });
    await settle();
    const base = new THREE.Box3().setFromObject(c.root).min.y;
    c.move('run');
    let most = 0;
    for (let i = 0; i < 30; i++) { c.update(1 / 60); most = Math.max(most, new THREE.Box3().setFromObject(c.root).min.y - base); }
    expect(most).toBeGreaterThan(0.03);
  });
});

describe('the builder and the user are told the same truth', () => {
  it('walk and run are made too; no "moves without walking" any more', () => {
    expect(lackedMovesClause(['walk', 'punch', 'block'])).toMatch(/walk, punch are not in its own clips, so NavBharatAI makes them from its skeleton, or with its whole body .*; block is not animated/);
    expect(playerMovesLine([], [])).toMatch(/NavBharatAI animates its walk, run and actions for it/);
  });
});
