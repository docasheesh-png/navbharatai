/**
 * 👥 EVERY CHARACTER IS SPAWNED, VERIFIED, TICKED AND KEPT APART (master audit 2026-11-25, Parts B, C, D).
 *
 * Reported: enemies sometimes never appear; a spawned enemy stands still; the player walks through other characters; a punch
 * passes through a body. Root cause, confirmed: the kit had every piece (ai.ts, combat.ts, humanoid.ts, play/character.ts)
 * and no assembler — each game wired them by hand and forgot a different step. These tests run the REAL kit files: the
 * real capsule walks on the real ground, the real AI decides, the real Health dies.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-entities-${process.pid}`);
let E: any; let EV: any; let C: any;
beforeAll(async () => {
  const files: Record<string, string> = {
    ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files,
  };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  C = await import(join(DIR, 'src/game/systems/combat.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A host like ctx: a scene, a player object, and onStep hooks this test drives. */
function host() {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Object3D() };
  scene.add(player.object);
  const hooks = new Set<(dt: number) => void>();
  return {
    scene, player,
    onStep: (fn: (dt: number) => void) => { hooks.add(fn); return () => { hooks.delete(fn); }; },
    step: (seconds: number, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) for (const f of [...hooks]) f(dt); },
    hooks,
  };
}
function on(name: string) { const seen: any[] = []; const off = EV.events.on(name, (p: any) => seen.push(p)); return { seen, off }; }
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

describe('B — a spawn is verified, never assumed', () => {
  it('a spawned character is in the scene, visible, at its point, and said with ENTITY_SPAWNED', () => {
    const h = host(); const spawned = on('ENTITY_SPAWNED');
    const npcs = new E.Entities(h);
    const e = npcs.spawn({ x: 5, z: -3 });
    expect(e).not.toBeNull();
    let inScene = false; for (let o: THREE.Object3D | null = e.object; o; o = o.parent) if (o === h.scene) inScene = true;
    expect(inScene).toBe(true);
    let meshes = 0; e.object.traverseVisible((o: any) => { if (o.isMesh) meshes++; });
    expect(meshes).toBeGreaterThan(0);
    expect(e.object.position.x).toBeCloseTo(5); expect(e.object.position.z).toBeCloseTo(-3);
    expect(spawned.seen.some((s) => s.id === e.id)).toBe(true);
    expect(npcs.report.spawned).toBe(1);
    spawned.off();
  });
  it('a bad spawn is rolled back and said — nothing half-built is left in the scene, never counted as spawned', () => {
    const h = host(); const failed = on('ENTITY_SPAWN_FAILED');
    const npcs = new E.Entities(h);
    const before = h.scene.children.length;
    expect(npcs.spawn({ x: NaN, z: 0 })).toBeNull();
    // A body with nothing to see (an empty group) is not a character the player can see.
    expect(npcs.spawn({ x: 0, z: 0, body: new THREE.Group() })).toBeNull();
    expect(h.scene.children.length).toBe(before);
    expect(npcs.alive()).toHaveLength(0);
    expect(npcs.report).toMatchObject({ spawned: 0, failed: 2 });
    expect(failed.seen.map((f) => f.reason)).toEqual(['position is not a number', 'the body has no visible mesh']);
    failed.off();
  });
  it('a library model body is accepted when it has a visible mesh', () => {
    const h = host();
    const npcs = new E.Entities(h);
    const model = new THREE.Group(); model.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)));
    const e = npcs.spawn({ x: 0, z: 4, body: model, kind: 'villager' });
    expect(e?.model).toBe(model); expect(e?.humanoid).toBeNull(); expect(e?.hostile).toBe(false);
  });
});

describe('C — it moves by itself: the AI ticks through onStep, nobody has to remember it', () => {
  it('a hostile enemy near the player closes in and attacks — the player\'s Health goes down', () => {
    const h = host();
    const playerHealth = new C.Health({ max: 100, invulnerable: 0, damagedEvent: 'PLAYER_DAMAGED', diedEvent: 'PLAYER_DIED' });
    const npcs = new E.Entities(h, { playerHealth });
    const e = npcs.spawn({ x: 0, z: 8 });
    const start = flat(e.object.position, h.player.object.position);
    h.step(4);
    expect(flat(e.object.position, h.player.object.position)).toBeLessThan(start - 4);
    expect(playerHealth.current).toBeLessThan(100);
  });
  it('🔁 reversion: without onStep (and no update call) the same enemy stands still — this is the reported bug', () => {
    const h = host();
    const npcs = new E.Entities({ scene: h.scene, player: h.player });
    const e = npcs.spawn({ x: 0, z: 8 });
    h.step(4);
    expect(e.object.position.z).toBeCloseTo(8, 3);
  });
  it('a non-hostile villager never chases the player', () => {
    const h = host();
    const npcs = new E.Entities(h);
    const e = npcs.spawn({ x: 0, z: 6, kind: 'villager', patrolRadius: 0 });
    h.step(3);
    expect(flat(e.object.position, h.player.object.position)).toBeGreaterThan(5);
  });
  it('goTo walks it to a point and says ENTITY_ARRIVED only when it is there', () => {
    const h = host(); const arrived = on('ENTITY_ARRIVED');
    const npcs = new E.Entities(h);
    const e = npcs.spawn({ x: 0, z: 0, kind: 'police', patrolRadius: 0 });
    let called = 0;
    e.goTo({ x: 12, z: 0 }, () => { called++; });
    h.step(0.5);
    expect(arrived.seen).toHaveLength(0);
    h.step(8);
    expect(called).toBe(1);
    expect(arrived.seen).toHaveLength(1);
    // …and it STAYS there (it used to walk back to where it spawned): the arrival point is its home now.
    expect(Math.hypot(e.object.position.x - 12, e.object.position.z)).toBeLessThanOrEqual(1.1);
    expect(e.state.home.x).toBeGreaterThan(10);
    arrived.off();
  });
});

describe('D — nobody walks through anybody', () => {
  it('the player walking into a character is pushed off it — the two never overlap', () => {
    const h = host();
    const npcs = new E.Entities(h);
    const e = npcs.spawn({ x: 0, z: 0, kind: 'villager', patrolRadius: 0 });
    for (let i = 0; i < 120; i++) { h.player.object.position.z = Math.min(h.player.object.position.z + 0.05, 0); if (i === 0) h.player.object.position.set(0, 0, -3); h.step(1 / 60); }
    expect(flat(e.object.position, h.player.object.position)).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });
  it('a crowd of enemies around the player never stands inside each other', () => {
    const h = host();
    const npcs = new E.Entities(h);
    for (let i = 0; i < 6; i++) npcs.spawn({ x: Math.cos(i) * 5, z: Math.sin(i) * 5 });
    h.step(4);
    const living = npcs.alive();
    for (let i = 0; i < living.length; i++) {
      expect(flat(living[i].object.position, h.player.object.position)).toBeGreaterThanOrEqual(0.8 - 0.02);
      for (let j = i + 1; j < living.length; j++) expect(flat(living[i].object.position, living[j].object.position)).toBeGreaterThanOrEqual(0.8 - 0.02);
    }
  });
  it('separate() is exact and symmetric', () => {
    const a = new THREE.Vector3(0, 0, 0); const b = new THREE.Vector3(0.3, 0, 0);
    expect(E.separate(a, 0.4, 1, b, 0.4, 1)).toBe(true);
    expect(b.x - a.x).toBeCloseTo(0.8); expect(a.x).toBeCloseTo(-0.25);
    const c = new THREE.Vector3(0, 0, 0); const d = new THREE.Vector3(0, 0, 0);
    E.separate(c, 0.4, 1, d, 0.4, 1); expect(flat(c, d)).toBeCloseTo(0.8);
  });
});

describe('a punch and a bullet hit the body, death clears it away', () => {
  it('melee hits the one IN FRONT and in reach — not the one behind, not the one too far', () => {
    const h = host();
    const npcs = new E.Entities(h);
    const front = npcs.spawn({ x: 0, z: 1.2, kind: 'villager', patrolRadius: 0 });
    const behind = npcs.spawn({ x: 0, z: -1.2, kind: 'villager', patrolRadius: 0 });
    const far = npcs.spawn({ x: 0, z: 6, kind: 'villager', patrolRadius: 0 });
    const hit = npcs.melee(new THREE.Vector3(0, 0, 0), 0, 30);
    expect(hit).toEqual([front]);
    expect(front.health.current).toBeLessThan(100);
    expect(behind.health.current).toBe(100);
    expect(far.health.current).toBe(100);
  });
  it('a wall between the fist and the body stops the blow (the world test bullets use)', () => {
    const h = host();
    const npcs = new E.Entities(h);
    const v = npcs.spawn({ x: 0, z: 1.2, kind: 'villager', patrolRadius: 0 });
    expect(npcs.melee(new THREE.Vector3(0, 0, 0), 0, 30, { world: () => 0.5 })).toEqual([]);
    expect(v.health.current).toBe(100);
    expect(npcs.melee(new THREE.Vector3(0, 0, 0), 0, 30, { world: () => null })).toEqual([v]);
  });
  it('bullets: targets() + applyHits() damage the body; a dead one is no longer a target, and is removed', () => {
    const h = host(); const died = on('ENTITY_DIED'); const removed = on('ENTITY_REMOVED');
    const npcs = new E.Entities(h, { corpseSeconds: 1 });
    const e = npcs.spawn({ x: 0, z: 10, health: 20, kind: 'villager', patrolRadius: 0 });
    const t = npcs.targets();
    expect(t).toHaveLength(1);
    expect(t[0].position.y).toBeGreaterThan(e.object.position.y + 0.5); // the chest, not the feet
    const killed = npcs.applyHits([{ target: t[0], point: t[0].position, damage: 50 }]);
    expect(killed).toEqual([e]);
    expect(e.alive).toBe(false);
    expect(npcs.targets()).toHaveLength(0);
    expect(died.seen).toHaveLength(1);
    h.step(1.2);
    expect(removed.seen).toHaveLength(1);
    expect(h.scene.children.includes(e.object)).toBe(false);
    expect(npcs.all).toHaveLength(0);
    died.off(); removed.off();
  });
  it('dispose removes every entity and stops ticking', () => {
    const h = host();
    const npcs = new E.Entities(h);
    npcs.spawn({ x: 1, z: 1 }); npcs.spawn({ x: -1, z: 1 });
    npcs.dispose();
    expect(npcs.all).toHaveLength(0);
    expect(h.hooks.size).toBe(0);
  });
});

describe('wired into the kit — not a module nobody calls', () => {
  it('the systems recipe emits it, with what it imports', () => {
    const only = generateGameSystems(['entities']).files;
    for (const p of [GAME_ENTITIES_PATH, 'src/game/systems/combat.ts', 'src/game/systems/ai.ts', 'src/game/systems/nav.ts', 'src/game/systems/projectile.ts']) expect(only[p]).toBeTruthy();
    expect(generateGameSystems().instructions).toContain('new Entities(ctx');
  });
  it('the shell gives ctx.onStep and runs it every step after update(), and clears it on dispose', () => {
    const game = generateGameShell().files['src/game/Game.ts'];
    expect(game).toMatch(/onStep: \(fn: \(delta: number\) => void\) => \(\) => void;/);
    const step = game.indexOf('this.asGame(() => this.options.update?.(this.context, delta));');
    const hooks = game.indexOf('for (const fn of [...this.stepHooks])');
    expect(step).toBeGreaterThan(0); expect(hooks).toBeGreaterThan(step);
    expect(game).toContain('this.stepHooks.clear();');
  });
});
