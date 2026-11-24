/**
 * ✋ EVERY CHARACTER CAN HOLD THINGS, NOT ONLY THE PLAYER (admin 2026-11-24, question 1: "sabhi character apne hath me object
 * utha le"). holdItem only reached the player. holdInHand puts an item in the hand of ANY character: a library or uploaded
 * model by its hand bone, a kit person (createHumanoid) by its grip. Real kit files, real three.js.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_PLAYER_BODY_PATH, GAME_PLAYER_FILE } from '../src/server/lib/GamePlayerBodyGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-npc-hold-${process.pid}`);
let PB: any; let HM: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  writeFileSync(join(DIR, 'src/game/player.ts'), GAME_PLAYER_FILE);
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  HM = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function npcModel(withHand = true) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)); body.position.y = 0.9; root.add(body);
  if (withHand) {
    const arm = new THREE.Bone(); arm.name = 'mixamorig:RightArm'; arm.position.set(-0.3, 1.5, 0);
    const hand = new THREE.Bone(); hand.name = 'mixamorig:RightHand'; hand.position.set(0, -0.55, 0);
    arm.add(hand); root.add(arm);
  }
  return root;
}
const gun = () => new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.6));

describe('any character holds an item', () => {
  it('🔴 a library-model enemy holds the gun in its own hand bone, sized to it', () => {
    const enemy = npcModel();
    const item = gun();
    expect(PB.holdInHand(enemy, item)).toBe(true);
    let hand: THREE.Object3D | null = null; enemy.traverse((o) => { if (o.name === 'mixamorig:RightHand') hand = o; });
    expect(item.parent).toBe(hand);
    const size = new THREE.Box3().setFromObject(item).getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(0.54, 1); // about a third of 1.8 m
  });
  it('a kit person NPC holds it with its own grip (right, and left)', () => {
    const npc = HM.createHumanoid({ height: 1.75 });
    const a = gun(); const b = gun();
    expect(PB.holdInHand(npc, a)).toBe(true);
    expect(PB.holdInHand(npc, b, 'left')).toBe(true);
    expect(b.parent).toBe(npc.joints.leftHand);
    let inRoot = false; for (let p: THREE.Object3D | null = a; p; p = p.parent) if (p === npc.root) inRoot = true;
    expect(inRoot).toBe(true);
  });
  it('a model with no hand bone holds it at its side, and says false', () => {
    const statue = npcModel(false);
    const item = gun();
    expect(PB.holdInHand(statue, item)).toBe(false);
    expect(item.parent).toBe(statue);
  });
  it('the builder is told how', () => {
    expect(generateGameShell(['game']).instructions).toMatch(/holdInHand\(character, item\)/);
  });
});
