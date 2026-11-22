// NOTHING PASSES THROUGH ANYTHING (admin 2026-11-22, verbatim: "jab bhi 2 object (kisi bhi game me) takrayenge to ek dusre
// ke aar paar nahi jane chahiye, takkar honi chahiye ... hero road par chal rahi gadiyo se takrata nahi hai, gadiyo ke aar
// paar chala jata hai, na hi gadiya apas me takrati hai").
//
// 🔴 THE ROOT CAUSE THIS LOCKS. The city traffic's "never drive into the player" check, and the crowd's, compared the
// player's WORLD position with the city plan's own coordinates. That is right only for a city standing at the scene origin.
// On the open-world map every city stands somewhere else (and the floating origin moves), so the check never matched: cars
// drove through the hero and people walked through him. These tests put the city far from the origin on purpose — put
// getWorldPosition back in citytraffic.ts and they fail.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D } from '../src/server/lib/Game3DGenerator';
import { GAME_COLLISION_RULE } from '../src/server/AgentV3/gameCollisionRule';
import { GAME_KIT_RULE } from '../src/server/AgentV3/systemPrompt';
import { projectGrowthRules } from '../src/server/AgentV3/gameKitSeed';
import { GAME_OPEN_WORLD_BRIDGE as GAME_OPEN_WORLD } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-no-pass-through-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let T: any; let K: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['citytraffic']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  T = await import(join(DIR, 'src/game/three/citytraffic.ts'));
  K = await import(join(DIR, 'src/game/three/collision.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

/** A city the way the open world places one: under a group far from the scene origin. */
function farCity(count = 16) {
  const scene = new THREE.Scene();
  const region = new THREE.Group(); region.position.set(4800, 3, -3100); scene.add(region);
  const city = C.createCity({ blocksX: 3, blocksZ: 3, seed: 2 });
  const traffic = T.createCityTraffic(city, { count, seed: 4 });
  region.add(city.root, traffic.root);
  scene.updateMatrixWorld(true);
  const player = new THREE.Object3D(); scene.add(player);
  return { scene, region, city, traffic, player };
}
const worldOf = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('💥 two things never pass through each other', () => {
  it('a player standing inside a car of a city far from the origin is pushed out of it', () => {
    const { traffic, player } = farCity();
    const car = traffic.cars[0];
    player.position.copy(worldOf(car.object));
    expect(traffic.pushOut(player, 0.45)).toBe(true);
    const local = traffic.root.worldToLocal(worldOf(player));
    const c = car.object.position, h = car.object.rotation.y;
    const dx = local.x - c.x, dz = local.z - c.z;
    const along = Math.abs(dx * Math.sin(h) + dz * Math.cos(h)), side = Math.abs(dx * Math.cos(h) - dz * Math.sin(h));
    expect(along >= car.length / 2 + 0.45 - 1e-6 || side >= 1.45 - 1e-6).toBe(true);
    // Far from every car, nothing is touched.
    player.position.set(0, 0, 0);
    expect(traffic.pushOut(player, 0.45)).toBe(false);
  });

  it('a car stops for a player standing in its lane in a city far from the origin, instead of driving through', () => {
    const { traffic, player } = farCity();
    const car = traffic.cars[0];
    // Twelve metres ahead of the car, in its lane.
    const h = car.object.rotation.y;
    const ahead = car.object.position.clone().add(new THREE.Vector3(Math.sin(h) * 12, 0, Math.cos(h) * 12));
    player.position.copy(traffic.root.localToWorld(ahead.clone()));
    let closest = Infinity;
    for (let i = 0; i < 600; i++) {
      traffic.update(1 / 60, [player]);
      const p = traffic.root.worldToLocal(worldOf(player));
      for (const c of traffic.cars) {
        const d = Math.hypot(p.x - c.object.position.x, p.z - c.object.position.z);
        closest = Math.min(closest, d);
      }
    }
    expect(closest).toBeGreaterThan(car.length / 2);
  });

  // The lane gap, the lights and the one-car-per-crossing hold already keep traffic apart (measured 2026-11-22: zero overlaps
  // with 40 cars) — this locks that, so a change to the traffic can never start letting cars drive through each other.
  it('cars never drive into one another: in two minutes no two car bodies overlap', () => {
    const { traffic } = farCity(40);
    let overlaps = 0;
    for (let i = 0; i < 2400; i++) {
      traffic.update(1 / 20, []);
      const cs = traffic.cars;
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
        const d = Math.hypot(cs[a].object.position.x - cs[b].object.position.x, cs[a].object.position.z - cs[b].object.position.z);
        if (d < 2.5) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it('keepApart separates any two moving things, whatever their parents, and leaves a fixed one where it is', () => {
    const scene = new THREE.Scene();
    const g = new THREE.Group(); g.position.set(100, 0, 50); g.rotation.y = 0.7; scene.add(g);
    const a = new THREE.Object3D(); scene.add(a); a.position.set(100, 0, 50);
    const b = new THREE.Object3D(); g.add(b); b.position.set(0.3, 0, 0);
    const wall = new THREE.Object3D(); scene.add(wall); wall.position.set(98.5, 0, 50);
    scene.updateMatrixWorld(true);
    const touched = K.keepApart([{ object: a, radius: 0.5 }, { object: b, radius: 1 }, { object: wall, radius: 0.5, fixed: true }]);
    expect(touched).toBeGreaterThanOrEqual(1);
    expect(wall.position.toArray()).toEqual([98.5, 0, 50]);
    scene.updateMatrixWorld(true);
    const pa = worldOf(a), pb = worldOf(b);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(K.keepApart([{ object: a, radius: 0.1 }, { object: wall, radius: 0.1, fixed: true }])).toBe(0);
  });

  it('the open world pushes the player (or the car they drive) out of traffic every frame', () => {
    expect(GAME_OPEN_WORLD).toMatch(/if \(seated\) t\.traffic\?\.pushOut\(seated, 1\.2\); else t\.traffic\?\.pushOut\(ctx\.player\.object, 0\.45\);/);
  });

  it('the builder is told the rule in every game build and every later turn of a game', () => {
    expect(GAME_COLLISION_RULE).toMatch(/keepApart/);
    expect(GAME_KIT_RULE).toContain(GAME_COLLISION_RULE);
    expect(projectGrowthRules({ 'src/game/core/loop.ts': 'x' })).toContain(GAME_COLLISION_RULE);
    expect(projectGrowthRules({ 'src/App.tsx': 'x' })).not.toContain(GAME_COLLISION_RULE);
  });
});
