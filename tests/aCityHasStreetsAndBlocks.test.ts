// CITY BLOCKS (admin 2026-11-20 game-gap audit: a "city" game was one straight road with houses beside it, because
// the kit had nothing else; builders hand-placed boxes, and buildings stood in the road). These run the REAL generated
// three/city.ts: the plan's promises (every lot on a street, nothing in the road, routes along streets in the LEFT
// lane) and the meshes (streets are ground, buildings are solid, a few meshes per block).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { generateGame3D, GAME_3D_MODULES } from '../src/server/lib/Game3DGenerator';

const DIR = join(__dirname, `.tmp-city-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let C: any; let K: any;
beforeAll(async () => {
  for (const [p, c] of Object.entries(generateGame3D(['city']).files)) {
    mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), c);
  }
  C = await import(join(DIR, 'src/game/three/city.ts'));
  K = await import(join(DIR, 'src/game/three/collision.ts'));
});
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const PLANS = [
  {}, { seed: 7 }, { blocksX: 6, blocksZ: 3, seed: 3 }, { style: 'town', block: 30, seed: 11 },
  { style: 'downtown', block: 70, road: 14, seed: 5 }, { blocksX: 1, blocksZ: 1 }, { block: 24, sidewalk: 6 },
];

describe('🏙️ city blocks', () => {
  it('ships in the 3D kit with what it imports, and the instructions say how to use it', () => {
    expect(GAME_3D_MODULES).toContain('city');
    const r = generateGame3D(['city']);
    expect(Object.keys(r.files).sort()).toEqual(['src/game/three/city.ts', 'src/game/three/collision.ts']);
    expect(r.instructions).toMatch(/createCity\(/);
    expect(r.instructions).toMatch(/city\.solidAt/);
    expect(generateGame3D(['objects']).instructions).not.toMatch(/createCity\(/);
  });

  it('every lot stands inside the city, off the street, and faces a street a few steps from its door', () => {
    for (const o of PLANS) {
      const plan = C.planCity(o);
      expect(plan.lots.length + plan.parks.length).toBeGreaterThan(0);
      for (const lot of plan.lots) {
        for (const [dx, dz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x = lot.x + dx * lot.width / 2, z = lot.z + dz * lot.depth / 2;
          expect(C.onStreet(plan, x, z), `lot ${lot.id} corner on a street`).toBe(false);
          expect(Math.abs(x)).toBeLessThanOrEqual(plan.width / 2);
          expect(Math.abs(z)).toBeLessThanOrEqual(plan.depth / 2);
        }
        // The door is on the pavement, and the street is just beyond it.
        expect(C.onStreet(plan, lot.entrance.x, lot.entrance.z)).toBe(false);
        expect(C.citySolidAt(plan, lot.entrance.x, lot.entrance.z, 0.2)).toBe(false);
        const kerb = { x: lot.entrance.x + lot.facing.x * (plan.sidewalk / 2 + 0.5), z: lot.entrance.z + lot.facing.z * (plan.sidewalk / 2 + 0.5) };
        expect(C.onStreet(plan, kerb.x, kerb.z), `lot ${lot.id} has no street in front`).toBe(true);
        // The building stays inside its lot.
        const f = C.buildingFootprint(lot);
        expect(Math.abs(f.x - lot.x) + f.w / 2).toBeLessThanOrEqual(lot.width / 2 + 1e-9);
        expect(Math.abs(f.z - lot.z) + f.d / 2).toBeLessThanOrEqual(lot.depth / 2 + 1e-9);
        expect(lot.floors).toBeGreaterThanOrEqual(1);
      }
      // No two lots overlap.
      for (let a = 0; a < plan.lots.length; a++) for (let b = a + 1; b < plan.lots.length; b++) {
        const p = plan.lots[a], q = plan.lots[b];
        const overlap = Math.abs(p.x - q.x) < (p.width + q.width) / 2 - 1e-9 && Math.abs(p.z - q.z) < (p.depth + q.depth) / 2 - 1e-9;
        expect(overlap, `lots ${p.id} and ${q.id} overlap`).toBe(false);
      }
    }
  });

  it('is the same city for the same seed, a different one for another seed, and has the asked-for mix', () => {
    expect(C.planCity({ seed: 9 })).toEqual(C.planCity({ seed: 9 }));
    expect(C.planCity({ seed: 9 }).lots.map((l: any) => l.kind)).not.toEqual(C.planCity({ seed: 10 }).lots.map((l: any) => l.kind));
    const kinds = (o: object) => new Set(C.planCity(o).lots.map((l: any) => l.kind));
    expect(kinds({ style: 'town', blocksX: 6, blocksZ: 6 }).has('office')).toBe(false);
    expect(kinds({ style: 'downtown', blocksX: 6, blocksZ: 6 }).has('office')).toBe(true);
    const tall = C.planCity({ style: 'downtown', blocksX: 6, blocksZ: 6, maxFloors: 30 }).lots;
    expect(Math.max(...tall.map((l: any) => l.floors))).toBeGreaterThan(15);
    expect(Math.max(...tall.map((l: any) => l.floors))).toBeLessThanOrEqual(30);
    expect(Math.max(...C.planCity({ maxFloors: 2, blocksX: 6, blocksZ: 6 }).lots.map((l: any) => l.floors))).toBeLessThanOrEqual(2);
    expect(C.planCity({ parks: 0, blocksX: 6, blocksZ: 6 }).parks).toEqual([]);
    const allParks = C.planCity({ parks: 0.5, blocksX: 2, blocksZ: 1, seed: 1 });
    expect(allParks.lots.length).toBeGreaterThan(0);
    // Silly sizes are bounded, not obeyed.
    const big = C.planCity({ blocksX: 1000, blocksZ: Number.NaN, block: 1, road: -5 });
    expect(big.blocksX).toBe(12); expect(big.blocksZ).toBe(4); expect(big.block).toBe(24); expect(big.road).toBe(6);
  });

  it('every shop has a signboard on its front, facing the street', () => {
    const plan = C.planCity({ blocksX: 6, blocksZ: 6, style: 'town' });
    const shops = plan.lots.filter((l: any) => l.kind === 'shop');
    expect(shops.length).toBeGreaterThan(0);
    for (const s of shops) {
      expect(s.sign).toBeDefined();
      const f = C.buildingFootprint(s);
      expect(Math.sign(s.sign.z - f.z)).toBe(Math.sign(s.facing.z));
      expect(Math.abs(s.sign.z - f.z)).toBeGreaterThan(f.d / 2);
      expect(s.sign.y).toBeGreaterThan(3);
    }
    expect(plan.lots.filter((l: any) => l.kind !== 'shop').every((l: any) => l.sign === undefined)).toBe(true);
  });

  it('spawns on a street, in the left lane, clear of everything', () => {
    for (const o of PLANS) {
      const plan = C.planCity(o);
      expect(C.onStreet(plan, plan.spawn.x, plan.spawn.z)).toBe(true);
      expect(C.citySolidAt(plan, plan.spawn.x, plan.spawn.z, 1.5)).toBe(false);
      // Heading 0 is +Z; the driver's left there is +X, so the spawn is on the +X side of its street.
      const street = plan.streetsX.reduce((a: number, b: number) => (Math.abs(b - plan.spawn.x) < Math.abs(a - plan.spawn.x) ? b : a));
      expect(plan.spawn.x - street).toBeCloseTo(plan.road / 4, 9);
    }
  });

  it('a route stays on the streets, turns only at crossings, keeps LEFT, and ends at the door', () => {
    const plan = C.planCity({ blocksX: 5, blocksZ: 5, seed: 4 });
    const targets = [plan.lots[0].entrance, plan.lots[plan.lots.length - 1].entrance, { x: plan.streetsX[0], z: plan.streetsZ[2] }];
    const starts = [plan.spawn, { x: plan.streetsX[5] - 1, z: 0 }, plan.lots[3].entrance];
    for (const from of starts) for (const to of targets) {
      const route = C.cityRoute(plan, from, to);
      const offStreetEnd = !C.onStreet(plan, to.x, to.z);
      const driven = offStreetEnd ? route.slice(0, -1) : route;
      expect(driven.length).toBeGreaterThanOrEqual(1);
      for (let k = 0; k < driven.length; k++) {
        expect(C.onStreet(plan, driven[k].x, driven[k].z), `waypoint ${k} off the street`).toBe(true);
        if (k === 0) continue;
        const a = driven[k - 1], b = driven[k];
        // Straight along a street, never diagonally across a block.
        expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.z - b.z) < 1e-6, 'diagonal segment').toBe(true);
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          expect(C.onStreet(plan, x, z), 'the route cuts through a block').toBe(true);
        }
        // Left lane: travelling (dx, dz), the street's centre line is to the RIGHT, a quarter road away.
        const dx = Math.sign(b.x - a.x), dz = Math.sign(b.z - a.z);
        if (dz !== 0) {
          const street = plan.streetsX.reduce((p: number, q: number) => (Math.abs(q - a.x) < Math.abs(p - a.x) ? q : p));
          expect(a.x - street).toBeCloseTo(dz * plan.road / 4, 6);
        } else if (dx !== 0) {
          const street = plan.streetsZ.reduce((p: number, q: number) => (Math.abs(q - a.z) < Math.abs(p - a.z) ? q : p));
          expect(a.z - street).toBeCloseTo(-dx * plan.road / 4, 6);
        }
      }
      if (offStreetEnd) expect(route[route.length - 1]).toEqual({ x: to.x, z: to.z });
    }
    // Without lanes, the route runs on the centre lines.
    const centre = C.cityRoute(plan, plan.spawn, plan.lots[0].entrance, { lane: false }).slice(0, -1);
    for (const p of centre) expect(plan.streetsX.includes(p.x) || plan.streetsZ.includes(p.z)).toBe(true);
  });

  it('knows the ground and the walls: road height, pavement height, and solid buildings for cars', () => {
    const plan = C.planCity({ seed: 2 });
    expect(C.cityHeightAt(plan, plan.spawn.x, plan.spawn.z)).toBeCloseTo(C.CITY_ROAD_Y, 9);
    const lot = plan.lots[0];
    expect(C.cityHeightAt(plan, lot.entrance.x, lot.entrance.z)).toBeCloseTo(C.CITY_ROAD_Y + C.CITY_KERB, 9);
    expect(C.cityHeightAt(plan, plan.width, 0)).toBe(0);
    const f = C.buildingFootprint(lot);
    expect(C.citySolidAt(plan, f.x, f.z)).toBe(true);
    // A car 1 m from the wall, radius 1.2, is touching it; radius 0.5 is not.
    expect(C.citySolidAt(plan, f.x, f.z + lot.facing.z * (f.d / 2 + 1), 1.2)).toBe(true);
    expect(C.citySolidAt(plan, f.x, f.z + lot.facing.z * (f.d / 2 + 1), 0.5)).toBe(false);
    expect(C.lotAt(plan, lot.x, lot.z)).toBe(lot);
    expect(C.lotAt(plan, plan.spawn.x, plan.spawn.z)).toBeNull();
  });

  it('builds streets you stand on and buildings you cannot walk through, in a few meshes per block', () => {
    const city = C.createCity({ blocksX: 4, blocksZ: 4, seed: 6 });
    const scene = new THREE.Scene();
    scene.add(city.root);
    const meshes: THREE.Mesh[] = [];
    city.root.traverse((o: THREE.Object3D) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBeLessThanOrEqual(5 * 16 + 2);   // a few draw calls per block, never one per box
    const named = (n: string) => meshes.filter((m) => m.name === n);
    expect(named('City streets').length).toBe(1);
    expect(named('buildings').length).toBeGreaterThan(0);
    const colliders = K.worldColliders(scene);
    expect(colliders).toContain(named('City streets')[0]);
    for (const b of named('buildings')) expect(colliders).toContain(b);
    for (const w of named('windows')) expect(colliders).not.toContain(w);
    // A ray down at the spawn lands on the asphalt; one down at a lot lands on its roof.
    const down = new THREE.Vector3(0, -1, 0);
    const ray = new THREE.Raycaster(new THREE.Vector3(city.spawn.x, 200, city.spawn.z), down);
    expect(ray.intersectObjects(colliders, false)[0].point.y).toBeCloseTo(C.CITY_ROAD_Y, 3);
    const lot = city.plan.lots.find((l: any) => l.kind === 'apartment') ?? city.plan.lots[0];
    const f = C.buildingFootprint(lot);
    const roof = new THREE.Raycaster(new THREE.Vector3(f.x, 200, f.z), down).intersectObjects(colliders, false)[0];
    expect(roof.point.y).toBeGreaterThanOrEqual(C.CITY_ROAD_Y + C.CITY_KERB + lot.height - 1e-3);
    // Vertex colours: every lot does not come out the same colour.
    const colours = new Set<string>();
    const c = named('buildings')[0].geometry.getAttribute('color');
    for (let i = 0; i < c.count; i += 36) colours.add(`${c.getX(i).toFixed(3)}${c.getY(i).toFixed(3)}`);
    expect(colours.size).toBeGreaterThan(2);
    // The route comes back in world space at road height.
    const route = city.route(city.spawn, city.lotsOf('shop')[0]?.entrance ?? city.plan.lots[0].entrance);
    expect(route[0]).toBeInstanceOf(THREE.Vector3);
    expect(route[0].y).toBeCloseTo(C.CITY_ROAD_Y, 9);
    // dispose: off the scene, geometry freed.
    let freed = 0;
    for (const m of meshes) m.geometry.addEventListener('dispose', () => { freed += 1; });
    city.dispose();
    expect(city.root.parent).toBeNull();
    expect(freed).toBe(meshes.length);
  });

  it('street lights can be left out', () => {
    expect(C.planCity({}).lights.length).toBe(4 * 16);
    expect(C.planCity({ streetLights: false }).lights).toEqual([]);
    const lit = C.createCity({ blocksX: 2, blocksZ: 2 });
    const dark = C.createCity({ blocksX: 2, blocksZ: 2, streetLights: false });
    const lamps = (c: any) => { let n = 0; c.root.traverse((o: any) => { if (o.name === 'lamps') n += 1; }); return n; };
    expect(lamps(lit)).toBe(4);
    expect(lamps(dark)).toBe(0);
    lit.dispose(); dark.dispose();
  });
});

describe('🏙️ the builder is told the city is there', () => {
  it('the 3D kit handoff names createCity only when city.ts was written', async () => {
    const { gameKitHandoffBlock } = await import('../src/server/AgentV3/gameKitSeed');
    const withCity = gameKitHandoffBlock([{ recipe: 'generate_game_3d', ok: true, content: 'Created src/game/three/city.ts\nCreated src/game/three/collision.ts' }]);
    expect(withCity).toMatch(/createCity\(\) from src\/game\/three\/city\.ts/);
    const without = gameKitHandoffBlock([{ recipe: 'generate_game_3d', ok: true, content: 'Created src/game/three/objects.ts' }]);
    expect(without).not.toMatch(/createCity/);
  });
});
