// 🧱 A COLONY HOUSE IS A WALL (Q-3761, the first honest limit of #4627: "houses have no physics collider"). The colonies were drawn but
// had no wall: the player, a driven car, the bots and the enemies walked and drove straight through every house. These run the REAL
// emitted kit — athree's colonies.ts with the game kit's play/character.ts (the walking capsule every player and kit character uses),
// three/objects.ts driveVehicle (every driven car) and systems/nav.ts (a bot's path) — on a real planned town, and each one first proves
// it measures something: with the walls taken away the same walk goes INTO the house.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { mapOptionsFor } from '../src/server/lib/athreeMap/athreeMapKinds';
import { GAME_WORLD_COLLIDER_KEY } from '../src/server/lib/GameAssetRuntimeGenerator';

const DIR = join(__dirname, `.tmp-colony-walls-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let A: any; let CH: any; let O: any; let NAV: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  A = await import(join(DIR, 'src/game/athree/index.ts'));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  O = await import(join(DIR, 'src/game/three/objects.ts'));
  NAV = await import(join(DIR, 'src/game/systems/nav.ts'));
}, 180_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const TOWN = { seed: 5, ...mapOptionsFor({ archetype: 'island', sizeKm: 2.2 }), roadStyle: 'grid', density: 'normal' };

/** A planned town drawn round a plot of this kind, its tile walls built; and the plot's building box. */
function townAt(kind: string, quality: 'phone' | 'mid' | 'desktop' = 'mid') {
  const map = A.createAthreeMap({ ...TOWN, quality, three: THREE, vegetation: false, sky: false });
  for (let i = 0; i < 100000 && !map.world.planned(); i++) map.update(0, 0, 0);
  const plots = map.world.colonies().plots.filter((p: any) => p.kind === kind && p.width >= 10);
  const plot = plots[Math.floor(plots.length / 2)];
  for (let i = 0; i < 40; i++) map.update(plot.x, plot.z, 0);
  const scene = new THREE.Scene();
  scene.add(map.chunks.group);
  // The ground under the walk: a flat collider at the pad's height (the open-world bridge lays the map's height the same way).
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  ground.position.set(plot.x - map.chunks.origin.x, plot.y, plot.z - map.chunks.origin.z);
  ground.userData[GAME_WORLD_COLLIDER_KEY] = 'ground';
  scene.add(ground);
  scene.updateMatrixWorld(true);
  const building = A.colonyColliderBoxes({ plots: [plot], trees: [] }, A.COLONY_TIERS[quality].detail)[0];
  return { map, plot, scene, building };
}
/** How far along a plot's inward axis (away from its road) a point is, from the plot centre. */
const inward = (plot: any, x: number, z: number): number => -((x - plot.x) * plot.facing.x + (z - plot.z) * plot.facing.z);
const frontOf = (plot: any, b: any): number => inward(plot, b.x, b.z) - b.d / 2;
const wallsOff = (map: any): void => { for (const w of map.colonyMesh.colliders()) w.userData[GAME_WORLD_COLLIDER_KEY] = 'none'; };

/** Walk a capsule from the plot's entrance straight in, for seconds; returns the deepest point reached along the inward axis. */
function walkIn(t: ReturnType<typeof townAt>, seconds = 6): number {
  const { plot, scene, map } = t;
  const player = new CH.CharacterController({});
  scene.add(player.object);
  const o = map.chunks.origin;
  player.reset(plot.entrance.x - o.x, plot.y + 0.05, plot.entrance.z - o.z);
  // Camera yaw 0: moveZ = -1 walks toward -z; turn the input so it walks along -facing (into the plot).
  let deepest = -Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    player.update(1 / 60, { moveX: -plot.facing.x, moveZ: -plot.facing.z, sprint: false, jumpPressed: false, jumpHeld: false }, 0);
    deepest = Math.max(deepest, inward(plot, player.object.position.x + o.x, player.object.position.z + o.z));
  }
  scene.remove(player.object);
  return deepest;
}

describe('🧱 a colony house is a wall', () => {
  it('a walker coming in from the footpath goes through the open gate and is stopped at the house; without the walls it walks in', () => {
    const t = townAt('house');
    expect(t.map.colonyMesh.stats().colliders).toBeGreaterThan(0);
    const front = frontOf(t.plot, t.building);
    const deepest = walkIn(t);
    // Through the gate (the compound wall is at the plot's front edge, -depth / 2) and up to the house, never inside it.
    expect(deepest, 'passes the compound wall through its open gate').toBeGreaterThan(-t.plot.depth / 2 + 0.6);
    expect(deepest, 'stops at the house front').toBeLessThan(front);
    expect(deepest, 'reaches the house front').toBeGreaterThan(front - 1.2);
    // Reversion: the same walk with the walls marked 'none' goes deep into the house.
    wallsOff(t.map);
    expect(walkIn(t)).toBeGreaterThan(front + 1.5);
  });

  it('a car driven at a shop from its road is stopped before the shop; without the walls it drives in', () => {
    const t = townAt('shop');
    const front = frontOf(t.plot, t.building);
    const drive = (): number => {
      const car = O.createCar({ detail: 'lite' });
      const o = t.map.chunks.origin;
      car.position.set(t.plot.entrance.x - o.x, t.plot.y, t.plot.entrance.z - o.z);
      // A car at heading 0 drives toward +z: turn it to face the shop (along -facing).
      car.rotation.y = Math.atan2(-t.plot.facing.x, -t.plot.facing.z);
      t.scene.add(car); t.scene.updateMatrixWorld(true);
      const opts = { ground: () => t.plot.y };
      const state = O.createVehicleState(car, opts);
      let deepest = -Infinity;
      for (let i = 0; i < 240; i++) {
        O.driveVehicle(car, state, { x: 0, y: -1 }, 1 / 60, opts);
        deepest = Math.max(deepest, inward(t.plot, car.position.x + o.x, car.position.z + o.z));
      }
      t.scene.remove(car);
      return deepest;
    };
    const stopped = drive();
    expect(stopped, 'the car never gets its centre past the shop front').toBeLessThan(front);
    wallsOff(t.map);
    expect(drive(), 'without the walls it drives into the shop').toBeGreaterThan(front + 2);
  });

  it('a bot is held by a house and its path goes round it (world.colonySolidAt on the nav grid)', () => {
    const t = townAt('flats');
    const { plot, building } = t;
    // Held: a kit character walks on the same capsule as the player.
    expect(walkIn(t)).toBeLessThan(frontOf(plot, building));
    expect(t.map.world.colonySolidAt(building.x, building.z)).toBe(true);
    expect(t.map.world.colonySolidAt(plot.entrance.x, plot.entrance.z)).toBe(false);
    // Routes: from in front of the building to behind it, the path never crosses a wall.
    const ux = -plot.facing.z, uz = plot.facing.x;
    const before = { x: building.x + plot.facing.x * (building.d / 2 + 3), z: building.z + plot.facing.z * (building.d / 2 + 3) };
    const behind = { x: building.x - plot.facing.x * (building.d / 2 + 3), z: building.z - plot.facing.z * (building.d / 2 + 3) };
    const nav = NAV.createNavGrid({ minX: plot.x - 60, minZ: plot.z - 60, maxX: plot.x + 60, maxZ: plot.z + 60, cell: 0.5, blocked: (x: number, z: number) => t.map.world.colonySolidAt(x, z, 0.3) });
    const path = NAV.findPath(nav, before, behind, 200000);
    expect(path, 'there is a way round').not.toBeNull();
    for (let i = 0; i + 1 < path.length; i++) {
      for (let s = 0; s <= 10; s++) {
        const x = path[i].x + (path[i + 1].x - path[i].x) * (s / 10), z = path[i].z + (path[i + 1].z - path[i].z) * (s / 10);
        expect(A.boxesTouch([building], x, z, 0), 'the path never goes through the building').toBe(false);
      }
    }
    void ux; void uz;
  });

  it('walls are streamed with the tiles: only near tiles carry one, a far camera drops them, and the wall boxes stay inside budget', () => {
    for (const quality of ['phone', 'mid', 'desktop'] as const) {
      const t = townAt('house', quality);
      const s = t.map.colonyMesh.stats();
      const tier = A.COLONY_TIERS[quality];
      expect(s.colliders, quality).toBeGreaterThan(0);
      // Every wall belongs to a drawn tile within the physics radius (plus its slack).
      const walls = t.map.colonyMesh.colliders();
      expect(walls.length).toBe(s.colliders);
      for (const w of walls) {
        const tile = w.parent;
        const x0 = tile.position.x, z0 = tile.position.z;
        const d = Math.hypot(Math.max(x0 - t.plot.x, 0, t.plot.x - x0 - A.COLONY_TILE), Math.max(z0 - t.plot.z, 0, t.plot.z - z0 - A.COLONY_TILE));
        expect(d, quality).toBeLessThanOrEqual(tier.physicsRadius * 1.15);
        expect(w.visible).toBe(false);
        expect(w.userData[GAME_WORLD_COLLIDER_KEY]).toBe('solid');
      }
      // Budget: a tile's wall is a few hundred boxes at most, ten triangles each — far fewer than what is drawn.
      expect(s.colliderBoxes / s.colliders, quality).toBeLessThan(400);
      // Moving away: no wall is left once the camera is far from every colony.
      for (let i = 0; i < 4; i++) t.map.update(t.plot.x + 5000, t.plot.z + 5000, 0);
      expect(t.map.colonyMesh.stats().colliders, quality).toBe(0);
    }
  });

  it('the wall is what is drawn: every solid box is one of the drawn boxes, and awnings, crowns, slabs and tanks are never solid', () => {
    const t = townAt('shop', 'desktop');
    const plots = t.map.world.colonies().plots.slice(0, 400);
    for (const p of plots) {
      const drawn: any[] = []; const solid: any[] = [];
      A.plotBoxes(p, 2, (b: any, _c: number, isSolid: boolean) => { drawn.push(b); if (isSolid) solid.push(b); });
      for (const b of solid) expect(drawn).toContain(b);
      for (const b of solid) expect(b.y0, `${p.kind} ${p.id}: a solid box starts at the ground, never above a head`).toBeLessThan(p.y + 0.5);
    }
    expect(A.COLONY_COLLIDER_KEY).toBe(GAME_WORLD_COLLIDER_KEY);
  });
});
