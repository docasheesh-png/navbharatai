/**
 * Admin 2026-11-26 game-maker list (PR B), run on the REAL emitted kit code:
 *   #1  city people walked through the hero and a punch did nothing — now, when the user asks, the crowd is solid
 *       (pushOut) and hittable (hitAt: they fall, lie DOWN_SECONDS, and walk on);
 *   #1  a punch was only a pose — Entities now take the shell's PLAYER_PUNCHED (the first character in reach);
 *   #18 a car the player drives hurts what it hits, ONLY when the user asks (WORLD.runOver; VEHICLE_STRUCK);
 *   and none of it happens by default: a crowd is scenery and a car is not a weapon until the user says so.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGameRuntime } from '../src/server/lib/GameRuntimeGenerator';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { generateGameController } from '../src/server/lib/GameControllerGenerator';
import { generateGameSystems } from '../src/server/lib/GameSystemsGenerator';
import { GAME_ENTITIES_PATH } from '../src/server/lib/GameEntitiesGenerator';
import { citizensWanted, runOverWanted, gameWorldFileSource, GAME_OPEN_WORLD_BRIDGE } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-blows-${process.pid}`);
let E: any; let EV: any; let C: any; let P: any;
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  const files: Record<string, string> = { ...generateGameRuntime().files, ...generateGame3D().files, ...generateGameController().files, ...generateGameSystems().files };
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c); }
  E = await import(join(DIR, GAME_ENTITIES_PATH));
  EV = await import(join(DIR, 'src/game/core/events.ts'));
  C = await import(join(DIR, 'src/game/three/city.ts'));
  P = await import(join(DIR, 'src/game/three/citypeople.ts'));
}, 60_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

function host() {
  const scene = new THREE.Scene();
  const player = { object: new THREE.Object3D() };
  scene.add(player.object);
  return { scene, player, onStep: () => () => {} };
}

describe('#1 a punch is a blow: the first character in reach is hurt', () => {
  it('in front and in reach: hurt; behind or far: not; after dispose: nothing listens', () => {
    const h = host(); const crowd = new E.Entities(h);
    const front = crowd.spawn({ kind: 'npc', hostile: false, x: 0, z: 1.2, health: 30 });
    const behind = crowd.spawn({ kind: 'npc', hostile: false, x: 0, z: -1.2, health: 30 });
    const far = crowd.spawn({ kind: 'npc', hostile: false, x: 0, z: 8, health: 30 });
    EV.events.emit('PLAYER_PUNCHED', { position: { x: 0, y: 0, z: 0 }, yaw: 0, damage: 10, range: 1.6 });
    expect(front.health.current).toBe(20);
    expect(behind.health.current).toBe(30);
    expect(far.health.current).toBe(30);
    crowd.dispose();
    EV.events.emit('PLAYER_PUNCHED', { position: { x: 0, y: 0, z: 0 }, yaw: 0, damage: 10, range: 1.6 });
    expect(front.health.current).toBe(20);
  });

  it('#18 a car strike hurts everyone it touches (WORLD.runOver), and nobody further away', () => {
    const h = host(); const crowd = new E.Entities(h);
    const hit = crowd.spawn({ kind: 'enemy', x: 10, z: 10, health: 50 });
    const safe = crowd.spawn({ kind: 'enemy', x: 20, z: 10, health: 50 });
    EV.events.emit('VEHICLE_STRUCK', { position: { x: 10.5, y: 0, z: 10 }, radius: 1.8, damage: 60 });
    expect(hit.alive).toBe(false);
    expect(safe.health.current).toBe(50);
    crowd.dispose();
  });
});

describe('#1 the city crowd: scenery by default, solid and hittable when asked', () => {
  const crowdOf = (opts: Record<string, unknown>) => {
    const city = C.createCity({ blocksX: 2, blocksZ: 2, seed: 3 });
    const people = P.createCityPeople(city, { count: 10, seed: 5, tier: 'full', ...opts });
    const scene = new THREE.Scene(); scene.add(people.root);
    return people;
  };

  it('default: the player walks through people and a blow knocks nobody down', () => {
    const people = crowdOf({});
    const w = people.walkers[0];
    const pos = new THREE.Vector3(w.x + 0.1, 0, w.z);
    expect(people.pushOut(pos)).toBe(false);
    expect(people.hitAt({ x: w.x, y: 0, z: w.z }, 1)).toBe(0);
    expect(w.state).not.toBe('down');
  });

  it('solid: the player is kept a shoulder away from every standing person', () => {
    const people = crowdOf({ solid: true });
    const w = people.walkers[0];
    const pos = new THREE.Vector3(w.x + 0.1, 0, w.z);
    expect(people.pushOut(pos)).toBe(true);
    expect(Math.hypot(pos.x - w.x, pos.z - w.z)).toBeGreaterThanOrEqual(2 * P.PERSON_RADIUS - 1e-6);
  });

  it('hittable: a blow knocks the person down (they lie still), they get up after DOWN_SECONDS and walk on', () => {
    const people = crowdOf({ solid: true, hittable: true });
    const w = people.walkers[0];
    const x = w.x, z = w.z;
    expect(people.hitAt({ x, y: 0, z }, 0.3)).toBeGreaterThanOrEqual(1);
    expect(w.state).toBe('down');
    // A person lying down is not a wall.
    expect(people.pushOut(new THREE.Vector3(x + 0.05, 0, z))).toBe(people.walkers.some((o: any) => o !== w && o.state !== 'down' && Math.hypot(o.x - x, o.z - z) < 1));
    for (let t = 0; t < P.DOWN_SECONDS - 0.5; t += 0.25) people.update(0.25);
    expect(w.state).toBe('down');
    expect([w.x, w.z]).toEqual([x, z]);
    for (let t = 0; t < 1; t += 0.25) people.update(0.25);
    expect(w.state).not.toBe('down');
    for (let t = 0; t < 5; t += 0.25) people.update(0.25);
    expect(Math.hypot(w.x - x, w.z - z)).toBeGreaterThan(0.5);
  });

  it('the open world hands WORLD.citizens to every crowd, and its blows (punch, shot, car) reach them', () => {
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/createCityPeople\(city, \{ traffic, count: p\.preset\.people, tier: city\.tier, \.\.\.\(citizensOption \|\| \{\}\), \.\.\.\(peopleOption \|\| \{\}\) \}\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/events\.on\('PLAYER_PUNCHED'[\s\S]{0,600}c\.people\?\.hitAt\(at, r\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/events\.on\('SHOT_HIT'[\s\S]{0,120}c\.people\?\.hitAt\(p\.point, 0\.5\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/if \(!seated\) t\.people\?\.pushOut\(ctx\.player\.object\.position\)/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/struck = runOver && sp > RUN_OVER_SPEED/);
    expect(GAME_OPEN_WORLD_BRIDGE).toMatch(/for \(const off of offCrowdBlows\) off\(\);/);
  });
});

describe('the user\'s words decide it (#1, #18), and the first build carries them', () => {
  it('citizens: solid, hittable, neither', () => {
    expect(citizensWanted('city ke log solid hon, hero unke aar paar na jaye')).toEqual({ solid: true });
    expect(citizensWanted('log ko punch maar ke gira sake')).toEqual({ solid: true, hittable: true });
    expect(citizensWanted('people should fall when I shoot them')).toEqual({ solid: true, hittable: true });
    expect(citizensWanted('ek bada sheher banao')).toEqual({});
    expect(citizensWanted('punch wala fighting game')).toEqual({});
  });
  it('run over: only when asked, and a refusal is a refusal', () => {
    expect(runOverWanted('gaadi ki takkar se log mare')).toBe(true);
    expect(runOverWanted('car se enemies ko kuchal sake')).toBe(true);
    expect(runOverWanted('ek car racing game')).toBe(false);
    expect(runOverWanted('gaadi ki takkar se koi na mare, takkar nahi')).toBe(false);
  });
  it('world.ts says so only when asked; the seed passes both', () => {
    expect(gameWorldFileSource({})).not.toMatch(/citizens:|runOver:/);
    expect(gameWorldFileSource({ citizens: { solid: true, hittable: true }, runOver: true })).toContain('citizens: { solid: true, hittable: true },');
    expect(gameWorldFileSource({ runOver: true })).toContain('runOver: true,');
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world city jahan log solid ho aur gaadi ki takkar se log mare'))
      .toMatchObject({ citizens: { solid: true }, runOver: true });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek open world')).not.toHaveProperty('runOver');
  });
});
