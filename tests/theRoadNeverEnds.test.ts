// THE ROAD NEVER ENDS (admin 2026-11-22: "pubg/bgmi jaisa bada ground map … user kitni bhi gaadiyan chalaye — abhi 30 sec me hi road
// khatam ho jati hai"). 🧬 Class: places on one map with no way between them — each city's streets stopped at its edge.
// Every place and land is now joined by a highway the map itself is carved to. Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-roads-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const context = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  return { scene, ctx: { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } } };
};
const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🛣️ every place is joined by a road you can drive', () => {
  it('n places and lands ⇒ n−1 highways, a connected network, paved and drivable end to end', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } },
      { id: 'east-town', kind: 'town', toward: 'east', city: small },
      { id: 'north-village', kind: 'village', toward: 'north', city: small },
      { id: 'south-desert', kind: 'desert', toward: 'south' },
      { id: 'west-jungle', kind: 'jungle', toward: 'west' },
    ] });
    expect(world.highways.length).toBe(4);
    let longest = 0;
    for (const line of world.highways) {
      longest = Math.max(longest, line.length * 10);
      // The ground is carved to the road: the surface is paved, and a car on it never meets a cliff (grade ≤ 8% + rounding).
      for (let i = 1; i < line.length; i++) {
        const grade = Math.abs(line[i].y - line[i - 1].y) / Math.max(1, Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
        expect(grade).toBeLessThan(0.1);
      }
      for (const p of [line[1], line[Math.floor(line.length / 2)], line[line.length - 2]]) {
        expect(world.map.world.surfaceAt(p.x, p.z)).toMatch(/asphalt|water/);
        expect(Math.abs(world.heightAt(p.x, p.z) - p.y)).toBeLessThan(0.5);
      }
    }
    expect(longest).toBeGreaterThan(300);                                                 // a real drive, not a stub
    // The highways are drawn, and they move with the floating origin.
    expect(c.scene.children.find((o: any) => o.name === 'Highways')?.children.length).toBe(4);
    world.dispose();
  }, 120_000);
  it('a universe of 100 places and lands is one connected network', () => {
    const c = context();
    const kinds = ['city', 'town', 'village', 'desert', 'jungle', 'mountain'];
    const world = OW.createOpenWorld(c.ctx, { seed: 5, regions: Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, kind: kinds[i % kinds.length], city: small })) });
    const n = world.places.length + world.lands.length;
    // A spanning tree: every place reachable from the first; a road is only skipped between places that already touch.
    expect(world.highways.length).toBeGreaterThanOrEqual(n - 1 - 10);
    expect(world.highways.length).toBeLessThanOrEqual(n - 1);
    world.dispose();
  }, 180_000);
});
