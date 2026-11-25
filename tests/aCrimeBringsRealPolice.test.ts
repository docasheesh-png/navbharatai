/**
 * 🚓 A CRIME BRINGS REAL POLICE — NOT A SENTENCE (master audit 2026-11-25, Part I).
 *
 * Reported: "when any crime happens, police should arrive" made a game that said "Police aa gayi" and showed nobody. Root
 * cause, confirmed: the kit had no crime, wanted or dispatch system — nothing to call — so a builder wrote the sentence.
 * These tests run the REAL kit files: a real car driven by driveVehicle, real officers spawned by Entities, the real AI.
 * The rule they lock: "dispatched" and "arrived" are said ONLY after the thing exists / is there; a failure is said.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_DISPATCH_PATH } from '../src/server/lib/GameDispatchGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-dispatch-${process.pid}`);
let E: any; let D: any; let EV: any; let C: any;
beforeAll(async () => {
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  D = await import(join(DIR, GAME_DISPATCH_PATH));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  C = await import(join(DIR, 'src/game/systems/combat.ts'));
}, 60_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

function world(options: any = {}) {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Object3D() };
  scene.add(player.object);
  const hooks = new Set<(dt: number) => void>();
  const host = { scene, player, onStep: (fn: (dt: number) => void) => { hooks.add(fn); return () => { hooks.delete(fn); }; } };
  const playerHealth = new C.Health({ max: 100, invulnerable: 0, damagedEvent: 'PLAYER_DAMAGED', diedEvent: 'PLAYER_DIED' });
  const npcs = new E.Entities(host, { playerHealth });
  const dispatch = new D.Dispatch(host, npcs, options.dispatch ?? {});
  const wanted = new D.Wanted(host, npcs, dispatch, options.wanted ?? {});
  const log: Array<{ t: number; type: string; p: any }> = [];
  let clock = 0;
  const offs = ['DISPATCHED', 'DISPATCH_ARRIVED', 'DISPATCH_FAILED', 'WANTED_LEVEL_CHANGED', 'PLAYER_ARRESTED', 'HINT', 'ENTITY_SPAWNED']
    .map((type) => EV.events.on(type, (p: any) => log.push({ t: clock, type, p })));
  const step = (seconds: number, every?: () => void) => { for (let t = 0; t < seconds; t += 1 / 30) { clock += 1 / 30; every?.(); for (const f of [...hooks]) f(1 / 30); } };
  const done = () => { offs.forEach((o: any) => o()); wanted.dispose(); dispatch.dispose(); npcs.dispose(); };
  return { scene, player, npcs, dispatch, wanted, log, step, done, playerHealth };
}
const hints = (log: any[]) => log.filter((l) => l.type === 'HINT').map((l) => String(l.p.text));
const first = (log: any[], type: string, pred: (p: any) => boolean = () => true) => log.find((l) => l.type === type && pred(l.p));

describe('🔴 a crime the PLAYER commits brings real police — a car drives in, officers get out, walk to the player', () => {
  it('killing a villager: stars rise, real cars and officers exist, they arrive, and only then is "arrived" said', () => {
    // Arrest off here, so the arrival itself is what is looked at (the arrest has its own test below).
    const w = world({ wanted: { arrestSeconds: 999 } });
    const villager = w.npcs.spawn({ x: 0, z: 1.2, kind: 'villager', patrolRadius: 0, health: 10 });
    // The player's punch (Entities.melee with no attacker = the player).
    w.npcs.melee(new THREE.Vector3(0, 0, 0), 0, 50);
    expect(villager.alive).toBe(false);
    expect(w.wanted.level).toBe(2); // murder — ONE crime: the killing blow is not an assault as well
    const dispatched = w.log.filter((l) => l.type === 'DISPATCHED');
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    // A REAL car is in the scene, with its siren, and it starts away from the player (not on top of them).
    const cars = w.scene.children.filter((o) => o.name === 'police car');
    expect(cars.length).toBe(dispatched.length);
    expect(Math.hypot(cars[0].position.x, cars[0].position.z)).toBeGreaterThanOrEqual(34);
    // Nobody has arrived, so nobody says so.
    expect(hints(w.log).some((h) => /arrived/i.test(h))).toBe(false);
    w.step(40);
    const arrived = first(w.log, 'DISPATCH_ARRIVED');
    expect(arrived, JSON.stringify(w.log.map((l) => l.type))).toBeTruthy();
    // When it is said, real officers are at the player.
    const officers = w.npcs.alive('police');
    expect(officers.length).toBeGreaterThanOrEqual(2);
    const nearest = Math.min(...officers.map((o: any) => Math.hypot(o.object.position.x, o.object.position.z)));
    expect(nearest).toBeLessThan(3);
    // "arrived" was said AFTER the arrival event, never before (the reported bug: the sentence with nobody there).
    const arrivedHint = w.log.find((l) => l.type === 'HINT' && /arrived/i.test(l.p.text));
    expect(arrivedHint).toBeTruthy();
    expect(w.log.indexOf(arrivedHint!)).toBeGreaterThan(w.log.indexOf(arrived!));
    w.done();
  });

  it('a player who stays in reach is ARRESTED; the level clears and the police stand down and are cleared away', () => {
    const w = world();
    w.wanted.commit('theft');
    expect(w.wanted.level).toBe(1);
    w.step(45);
    expect(first(w.log, 'PLAYER_ARRESTED')).toBeTruthy();
    expect(w.wanted.level).toBe(0);
    w.step(20);
    expect(w.npcs.alive('police')).toHaveLength(0);
    expect(w.scene.children.filter((o) => o.name === 'police car')).toHaveLength(0);
    expect(w.dispatch.active).toHaveLength(0);
    w.done();
  });

  it('from 3 stars the officers fight — they attack and the player is hurt', () => {
    const w = world({ wanted: { arrestSeconds: 999 } });
    w.wanted.commit('killed-officer');
    expect(w.wanted.level).toBe(3);
    w.step(45);
    expect(w.npcs.alive('police').every((o: any) => o.hostile)).toBe(true);
    expect(w.playerHealth.current).toBeLessThan(100);
    w.done();
  });

  it('an enemy hurting a villager is NOT the player\'s crime', () => {
    const w = world();
    const villager = w.npcs.spawn({ x: 0, z: 5, kind: 'villager', patrolRadius: 0, health: 10 });
    w.npcs.applyHits([{ target: w.npcs.targets().find((t: any) => t.ref === villager), point: villager.object.position, damage: 50, ownerId: 'enemy-1' }]);
    expect(villager.alive).toBe(false);
    expect(w.wanted.level).toBe(0);
    expect(w.log.filter((l) => l.type === 'DISPATCHED')).toHaveLength(0);
    w.done();
  });
});

describe('a dispatch that cannot happen is SAID, never faked', () => {
  it('no valid spawn point: DISPATCH_FAILED and a "could not come" line — no "dispatched", no "arrived", no police', () => {
    const w = world({ dispatch: { isValidSpawn: () => false } });
    w.wanted.commit('theft');
    w.step(5);
    expect(first(w.log, 'DISPATCH_FAILED')?.p.reason).toBe('no valid spawn point near the target');
    const said = hints(w.log);
    expect(said.some((h) => /could not come/.test(h))).toBe(true);
    expect(said.some((h) => /dispatched|arrived/i.test(h))).toBe(false);
    expect(w.npcs.alive('police')).toHaveLength(0);
    expect(w.scene.children.filter((o) => o.name === 'police car')).toHaveLength(0);
    w.done();
  });
  it('an unknown service fails honestly', () => {
    const w = world();
    const call = w.dispatch.call('helicopter', { x: 0, z: 0 });
    expect(call.status).toBe('failed');
    expect(call.failure).toMatch(/unknown service/);
    w.done();
  });
  it('spawn points stay inside the map bounds', () => {
    const w = world({ dispatch: { bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 } } });
    w.player.object.position.set(30, 0, 30);
    const call = w.dispatch.call('police', { x: 30, z: 30 });
    expect(call.status).toBe('en-route');
    expect(Math.abs(call.car.position.x)).toBeLessThanOrEqual(40);
    expect(Math.abs(call.car.position.z)).toBeLessThanOrEqual(40);
    w.done();
  });
  it('out of the camera\'s view when such a point exists', () => {
    const w = world();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    camera.position.set(0, 2, 0); camera.lookAt(0, 2, 10); camera.updateMatrixWorld(true);
    const dispatch = new D.Dispatch({ ...w, camera, onStep: undefined }, w.npcs);
    const call = dispatch.call('police', { x: 0, z: 0 });
    // The camera looks along +Z: the car must not start in front of it.
    const p = call.car.position;
    const ahead = new THREE.Vector3(p.x, 0, p.z).normalize().dot(new THREE.Vector3(0, 0, 1));
    expect(ahead).toBeLessThanOrEqual(Math.cos(THREE.MathUtils.degToRad(45)) + 1e-9);
    dispatch.dispose(); w.done();
  });
});

describe('any service, the same honest path', () => {
  it('an ambulance drives to a point and its crew arrives', () => {
    const w = world();
    const call = w.dispatch.call('ambulance', { x: 0, z: 0 });
    expect(call.status).toBe('en-route');
    w.step(40);
    expect(call.status).toBe('arrived');
    expect(w.npcs.alive('paramedic').length).toBe(2);
    w.done();
  });
  it('guards come on foot (no car) and still arrive', () => {
    const w = world();
    const call = w.dispatch.call('security', { x: 0, z: 0 });
    expect(call.car).toBeNull();
    expect(w.npcs.alive('guard').length).toBe(2);
    w.step(30);
    expect(call.status).toBe('arrived');
    w.done();
  });
});

describe('wired into the kit', () => {
  it('the systems recipe emits dispatch.ts with entities.ts, and the instructions forbid the sentence', () => {
    const only = generateGameSystems(['dispatch']).files;
    expect(only[GAME_DISPATCH_PATH]).toBeTruthy();
    expect(only[GAME_ENTITIES_PATH]).toBeTruthy();
    expect(generateGameSystems().instructions).toMatch(/NEVER a line of text saying they came/);
  });
});
