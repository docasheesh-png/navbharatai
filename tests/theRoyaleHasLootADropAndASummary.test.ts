// THE ROYALE HAS LOOT, A DROP AND A SUMMARY (template round R6, part 2). Runs the REAL emitted royale rules and practice
// adapter (kit construction stubbed as in originalRoyalePractice.test.ts; Three is real): crates heal or armour whoever
// walks over them, bots loot too, armour soaks bullets but not the zone, the feed and the end summary say what happened,
// and with the drop on you ride the plane, jump, steer the fall and land before the match clock starts.
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import { GAME_ROYALE_RULES } from '../src/server/lib/GameRoyaleFoundationGenerator';
import { GAME_ROYALE_PRACTICE, GAME_ROYALE_COMPONENT } from '../src/server/lib/GameRoyaleGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
function rules(): any {
  const output = ts.transpileModule(GAME_ROYALE_RULES, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Record<string, any> };
  new Function('exports', 'module', output)(module.exports, module);
  return module.exports;
}

describe('🎒 loot, armour, feed and placement in the rules', () => {
  it('a medkit heals (up to 100), armour soaks bullets, and a crate goes only once', () => {
    const r = rules(), m = r.initialMatch();
    expect(m.loot).toHaveLength(r.LOOT_SPOTS.length); expect(m.armor).toBe(0);
    const med = m.loot.find((c: any) => c.kind === 'medkit'), arm = m.loot.find((c: any) => c.kind === 'armor');
    m.health = 50; expect(r.pickUp(m, -1, med.x + 1, med.z)).toBe(med); expect(m.health).toBe(50 + r.MEDKIT_HEAL);
    expect(r.pickUp(m, -1, med.x, med.z)).toBeNull();
    r.pickUp(m, -1, arm.x, arm.z); expect(m.armor).toBe(r.ARMOR_POINTS);
    r.hitPlayer(m, 30, 0); expect(m.armor).toBe(20); expect(m.health).toBe(85);
    r.hitPlayer(m, 30, 1); expect(m.armor).toBe(0); expect(m.health).toBe(75);
    expect(m.feed.at(-1)).toMatch(/armour/);
  });
  it('the zone ignores armour and names itself as the cause; a bot names itself', () => {
    const r = rules(), z = r.initialMatch(); z.armor = 100;
    for (let i = 0; i < 200; i++) r.stepMatch(z, 0.1, 40);
    expect(z.result).toBe('lost'); expect(z.cause).toBe('zone'); expect(z.armor).toBe(100);
    const b = r.initialMatch(); for (let i = 0; i < 20; i++) r.hitPlayer(b, 7, 1);
    expect(b.result).toBe('lost'); expect(b.cause).toBe('bot 2'); expect(r.placement(b)).toBe(3);
    r.hitPlayer(b, 7, 0); expect(b.cause).toBe('bot 2');
  });
  it('bots loot too: armour makes a bot take an extra shot, and kills, damage and the feed add up', () => {
    const r = rules(), m = r.initialMatch(), arm = m.loot.find((c: any) => c.kind === 'armor');
    expect(r.pickUp(m, 0, arm.x, arm.z)).toBe(arm); expect(m.botArmor[0]).toBe(r.ARMOR_POINTS);
    let shots = 0;
    while (m.bots[0] > 0 && shots < 20) { for (let i = 0; i < 3; i++) r.stepMatch(m, 0.1, 0); r.fire(m, 0); shots++; }
    expect(shots).toBe(5);  // 50 armour + 100 health at 34 a shot
    expect(m.kills).toBe(1); expect(m.damageDealt).toBe(150); expect(m.feed.at(-1)).toBe('You eliminated bot 1');
    m.bots[1] = 0; expect(r.pickUp(m, 1, 0, 0)).toBeNull();
    r.stepMatch(m, 0.1, 0); expect(m.result).toBe('won'); expect(r.placement(m)).toBe(1);
  });
  it('bots only head for crates inside the safe zone; the zone warning says how far out you are', () => {
    const r = rules(), m = r.initialMatch();
    m.elapsed = 100;  // radius 16
    const c = r.nearestCrate(m, 30, 30);
    expect(c).not.toBeNull(); expect(Math.hypot(c.x, c.z)).toBeLessThanOrEqual(r.zoneRadius(100) - 2);
    for (const k of m.loot) k.taken = true; expect(r.nearestCrate(m, 0, 0)).toBeNull();
    expect(r.outsideBy(m, 20)).toBe(4); expect(r.outsideBy(m, 3)).toBe(0);
    expect(r.planeX(0)).toBeGreaterThan(-r.ARENA_HALF); expect(r.planeX(999)).toBeLessThan(r.ARENA_HALF);
  });
});

function harness(drop: boolean) {
  const moves: { moveX: number; moveZ: number }[][] = [[], []];
  let made = 0;
  class Controller {
    object = new THREE.Object3D(); speed = 0; isGrounded = true; index = made++;
    reset(x: number, y: number, z: number) { this.object.position.set(x, y, z); resets.push([x, y, z]); }
    setColliders() {}
    update(_dt: number, input: any) { if (this.index > 0 && this.index <= 2) moves[this.index - 1].push(input); }
  }
  const resets: number[][] = [];
  const emitted = ts.transpileModule(GAME_ROYALE_PRACTICE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  const kit: Record<string, unknown> = {
    three: THREE, './rules': rules(),
    '../three/world': { createTerrain: () => new THREE.Mesh(new THREE.PlaneGeometry(90, 90).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()) },
    '../three/buildings': { createEnterableHouse: () => new THREE.Group() },
    '../play/character': { CharacterController: Controller },
    '../three/humanoid': { createHumanoid: () => ({ root: new THREE.Group(), update() {}, dispose() {} }) },
  };
  new Function('require', 'exports', 'module', emitted)((name: string) => { if (!(name in kit)) throw Error(name); return kit[name]; }, module.exports, module);
  let status: any;
  const practice = module.exports.createPractice((s: any) => { status = s; }, { drop });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const player = new Controller(); scene.add(player.object);
  const pressed = new Set<string>();
  const ctx = { scene, camera, player, input: { wasPressed: (a: string) => pressed.has(a) } };
  practice.options.setup(ctx);
  return { practice, ctx, scene, player, moves, resets, get status() { return status; },
    tick(press?: string, dt = 0.1) { pressed.clear(); if (press) pressed.add(press); practice.options.update(ctx, dt); } };
}

describe('✈ the practice adapter', () => {
  it('rides the plane, drops on jump, falls while steering, and lands before the zone clock starts', () => {
    const h = harness(true);
    expect(h.scene.getObjectByName('Drop plane')).toBeDefined();
    h.tick(); h.tick();
    expect(h.status.phase).toBe('plane'); expect(h.player.object.position.y).toBe(30);
    const x0 = h.player.object.position.x; h.tick(); expect(h.player.object.position.x).toBeGreaterThan(x0);
    h.tick('jump'); expect(h.status.phase).toBe('falling');
    h.player.object.position.x = 5; h.player.object.position.z = -4;   // steering moved the body
    for (let i = 0; i < 40 && h.status.phase !== 'ground'; i++) h.tick();
    expect(h.status.phase).toBe('ground');
    expect(h.resets.at(-1)).toEqual([5, 0.2, -4]);
    expect(h.status.time).toBe(0); expect(h.status.health).toBe(100);
    h.practice.dispose();
  });
  it('the plane drops you anyway when it reaches the far side', () => {
    const h = harness(true);
    for (let i = 0; i < 85; i++) h.tick();
    expect(h.status.phase).not.toBe('plane');
    h.practice.dispose();
  });
  it('without the drop it starts on the ground as before; walking onto a crate takes it and hides it', () => {
    const h = harness(false);
    expect(h.scene.getObjectByName('Drop plane')).toBeUndefined();
    expect(h.status.phase).toBe('ground');
    const crates = h.scene.children.filter((c) => c.name === 'Loot crate');
    expect(crates).toHaveLength(6);
    const target = crates.find((c) => Math.abs(c.position.x - 14) < 0.01)!;
    h.player.object.position.set(14, 0.2, 8); h.tick();
    expect(target.visible).toBe(false); expect(h.status.armor).toBe(50); expect(h.status.crates).toHaveLength(5);
    expect(h.status.feed.at(-1)).toMatch(/armour/);
    h.practice.dispose();
  });
  it('far from you, bots head for the nearest crate; close by, they come for you', () => {
    const h = harness(false);
    h.tick();
    const toward = (i: number, gx: number, gz: number, from: [number, number]) => {
      const mv = h.moves[i].at(-1)!; const dx = gx - from[0], dz = gz - from[1], d = Math.hypot(dx, dz);
      return mv.moveX * dx / d + mv.moveZ * dz / d;
    };
    expect(toward(0, -12, -5, [-8, -15])).toBeGreaterThan(0.9);   // bot 1 at (-8,-15) → the medkit at (-12,-5)
    h.player.object.position.set(-6, 0.2, -10); h.tick();
    const last = h.moves[0].at(-1)!; expect(last.moveX).toBe(0); expect(last.moveZ).toBe(0);  // within 12 m: stands and fights
    h.practice.dispose();
  });
  it('the screen shows the drop, the zone warning, the map, the feed and the end summary', () => {
    for (const text of ['In the plane', 'Outside the zone', '<svg', 'feed.map', 'Out by', '{drop:true}', 'Practice complete!', 'Restart practice']) expect(GAME_ROYALE_COMPONENT).toContain(text);
  });
});
