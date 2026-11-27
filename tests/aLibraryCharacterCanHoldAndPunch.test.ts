/**
 * Admin 2026-11-24, question 1: "library ke character ke hath me gun do, to navbharatai bolta hai character ke pas yeh move
 * nahi hai, punch move nahi hai". A library model is a baked file and the kit only played its own clips.
 *
 * Now, from the model's SKELETON, the same way for every rig: an item goes into the hand bone (it follows every clip), and a
 * move the model has no clip for (punch, kick, swing, throw, fire, use) is made by turning its arm/leg bones in WORLD space.
 * It is said on screen once that the move is made from the skeleton. A model without the bones keeps the honest line.
 * The kit file is written to disk and run with the real three.js, as theUsersCharacterJoinsEveryGame does.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE } from '../src/server/lib/GamePlayerBodyGenerator';

/** A 1.8 m figure with a mixamo-style right arm hanging down (shoulder → elbow → wrist → finger tip), and no clips. */
function rigged(withArm = true) {
  const scene = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3));
  body.position.y = 0.9;
  scene.add(body);
  if (withArm) {
    const arm = new THREE.Bone(); arm.name = 'mixamorig:RightArm'; arm.position.set(-0.3, 1.5, 0);
    const fore = new THREE.Bone(); fore.name = 'mixamorig:RightForeArm'; fore.position.set(0, -0.3, 0);
    const hand = new THREE.Bone(); hand.name = 'mixamorig:RightHand'; hand.position.set(0, -0.28, 0);
    const tip = new THREE.Bone(); tip.name = 'mixamorig:RightHandIndex1'; tip.position.set(0, -0.1, 0);
    arm.add(fore); fore.add(hand); hand.add(tip); scene.add(arm);
  }
  // One idle clip (2026-11-26): a model with NO clips at all gets the single "NavBharatAI animates its moves for it" line
  // instead of one line per made move (tests/theUsersCharacterJoinsEveryGame), so the per-move lines are read on this one.
  return { scene, animations: [new THREE.AnimationClip('Idle', 1, [])] };
}
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({ GLTFLoader: class { async loadAsync(url: string) { return rigged(!url.includes('statue')); } } }));

const DIR = join(__dirname, `.tmp-hold-and-punch-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let E: any;
const hints: Array<{ id: string; text: string }> = [];
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, 'src/game/player.ts'), GAME_PLAYER_FILE);
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  E = await import(join(DIR, 'src/game/core/events.ts'));
  E.events.on('HINT', (p: { id: string; text: string }) => hints.push(p));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const handOf = (c: any) => { let h: THREE.Object3D | null = null; c.root.traverse((o: THREE.Object3D) => { if (o.name === 'mixamorig:RightHand') h = o; }); return h as unknown as THREE.Object3D; };
const world = (o: THREE.Object3D) => { o.updateWorldMatrix(true, false); return o.getWorldPosition(new THREE.Vector3()); };

describe('bones are found by name on any common rig', () => {
  it('mixamo, Blender and Unity-style names', () => {
    expect(PB.boneKey('mixamorig:RightForeArm')).toBe('rightforearm');
    expect(PB.boneKey('Hand.R')).toBe('handr');
    expect(PB.boneKey('hand_r')).toBe('handr');
    const root = new THREE.Group();
    for (const n of ['UpperArm.R', 'LowerArm.R', 'Hand.R']) { const b = new THREE.Bone(); b.name = n; root.add(b); }
    expect(Object.keys(PB.findBones(root)).sort()).toEqual(['rightForeArm', 'rightHand', 'rightUpperArm']);
  });
  it('never a guess: an unrelated name is not a hand', () => {
    const root = new THREE.Group(); const b = new THREE.Bone(); b.name = 'Handle'; root.add(b);
    expect(PB.findBones(root).rightHand).toBeUndefined();
  });
});

describe('🔴 a library character with no punch clip punches, made from its skeleton', () => {
  it('the hand moves FORWARD during the move and comes back after it; the user is told once', async () => {
    const holder = new THREE.Group();
    const c = PB.createPlayerCharacter(holder, { file: '/models/hero.glb' });
    await settle();
    const hand = handOf(c);
    const rest = world(hand).clone();
    expect(c.act('punch')).toBe(true);
    c.update(0.17);                                        // mid-move
    const mid = world(hand);
    expect(mid.z - rest.z).toBeGreaterThan(0.2);           // the fist went forward (+Z is the character's forward)
    for (let i = 0; i < 10; i++) c.update(0.05);           // the move ends
    c.update(0.016);
    expect(world(hand).distanceTo(rest)).toBeLessThan(1e-3);
    expect(hints.some((h) => /no punch move of its own, so NavBharatAI animates one from its skeleton/.test(h.text))).toBe(true);
  });
  // PIN UPDATED 2026-11-26 (admin: "mujhe aisa app maker chahiye jo movement khud bana le"): a model with no arm bones no
  // longer stands still under a "not animated" line — it punches with its whole body (RIGID_MOVES,
  // tests/aCharacterMakesItsOwnMoves.test.ts), and says so.
  it('a model with no arm bones punches with its whole body, and says so', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/statue.glb' });
    await settle();
    expect(c.act('punch')).toBe(true);
    expect(hints.some((h) => /no punch move of its own, so NavBharatAI animates one with its whole body/.test(h.text))).toBe(true);
  });
});

describe('🔴 the character holds an item in its hand', () => {
  it('a gun is parented to the hand bone and sized to the character', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/hero.glb' });
    await settle();
    const gun = new THREE.Mesh(new THREE.BoxGeometry(2, 0.5, 0.2));
    expect(c.hold(gun)).toBe(true);
    expect((gun.parent?.userData?.nbHoldPivot ? gun.parent.parent : gun.parent)?.name).toBe('mixamorig:RightHand');   // through fitInHand's holder (grip, turn)
    const size = new THREE.Box3().setFromObject(gun).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(0.4); expect(size.x).toBeLessThan(0.7);   // about a third of 1.75 m
  });
  it('without a hand bone it is held at the side, and said', async () => {
    const c = PB.createPlayerCharacter(new THREE.Group(), { file: '/models/statue.glb' });
    await settle();
    expect(c.hold(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)))).toBe(true);
    expect(hints.some((h) => /no right hand bone, so the item is held at its side/.test(h.text))).toBe(true);
  });
  it('the player file documents holds', () => {
    expect(GAME_PLAYER_FILE).toMatch(/holds: \{ right: 'pistol' \}/);
  });
});

describe('🔒 one sentence for a missing move, everywhere', () => {
  it('the server list of made moves equals the kit table', async () => {
    const { MADE_FROM_SKELETON } = await import('../src/server/lib/playerMoves');
    expect([...MADE_FROM_SKELETON].sort()).toEqual(Object.keys(PB.MADE_MOVES).sort());
  });
  it('the builder line and the done message both use it', async () => {
    const { playerMovesLine } = await import('../src/server/lib/playerMoves');
    expect(playerMovesLine(['idle', 'walk'], ['punch', 'block'])).toMatch(/punch is not in its own clips, so NavBharatAI makes it from its skeleton.*; block is not animated/);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(__dirname, '..', 'src/server/AgentV3/platformDoneTurn.ts'), 'utf8')).toMatch(/lackedMovesClause\(moves\.lacks\)/);
  });
});
