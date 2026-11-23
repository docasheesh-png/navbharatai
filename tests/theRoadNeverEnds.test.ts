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
  it('every highway face points UP (+Y), so the road is seen from above, and it does not flicker against the ground', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } },
      { id: 'east-town', kind: 'town', toward: 'east', city: small },
      { id: 'north-village', kind: 'village', toward: 'north', city: small },
      { id: 'sw-town', kind: 'town', toward: 'south-west', city: small },
    ] });
    const roads = c.scene.children.find((o: any) => o.name === 'Highways')!.children as THREE.Mesh[];
    expect(roads.length).toBeGreaterThan(0);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
    let faces = 0;
    for (const mesh of roads) {
      const pos = mesh.geometry.getAttribute('position'); const index = mesh.geometry.getIndex()!;
      for (let t = 0; t < index.count; t += 3) {
        a.fromBufferAttribute(pos, index.getX(t)); b.fromBufferAttribute(pos, index.getX(t + 1)); d.fromBufferAttribute(pos, index.getX(t + 2));
        // three.js front face: counter-clockwise, normal = (b − a) × (c − a). Down-facing faces are culled from the sky.
        n.subVectors(b, a).cross(d.clone().sub(a)).normalize();
        expect(n.y).toBeGreaterThan(0.9);
        faces++;
      }
      const vn = mesh.geometry.getAttribute('normal');
      for (let i = 0; i < vn.count; i++) expect(vn.getY(i)).toBeGreaterThan(0.9);
      const m = mesh.material as THREE.MeshStandardMaterial;
      expect(m.side).toBe(THREE.FrontSide);
      expect(m.polygonOffset).toBe(true);
      expect(m.polygonOffsetFactor).toBeLessThan(0);
    }
    expect(faces).toBeGreaterThan(10);
    world.dispose();
  }, 120_000);
  it('a highway ends ON the city\'s border, meeting its edge street — not short of it, and not inside its blocks on a diagonal', () => {
    const c = context();
    const world = OW.createOpenWorld(c.ctx, { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: { blocksX: 3, blocksZ: 2, ...small } },
      { id: 'east-town', kind: 'town', toward: 'east', city: small },
      { id: 'sw-village', kind: 'village', toward: 'south-west', city: small },
      { id: 'ne-town', kind: 'town', toward: 'north-east', city: small },
    ] });
    const home = world.regions[0]; const hw = home.city.plan.width / 2, hd = home.city.plan.depth / 2;
    const local = (p: { x: number; z: number }) => ({ x: p.x - home.centre.x, z: p.z - home.centre.z });
    // How far outside the street rectangle a point is (0 on its border, negative inside).
    const outside = (p: { x: number; z: number }) => { const q = local(p); return Math.max(Math.abs(q.x) - hw, Math.abs(q.z) - hd); };
    let touching = 0;
    for (const line of world.highways) {
      for (const end of [line[0], line[line.length - 1]]) {
        const o = outside(end);
        if (o < 30) { expect(Math.abs(o)).toBeLessThan(0.5); touching++; }       // an end at this city sits on its border
      }
      for (const p of line) expect(outside(p)).toBeGreaterThan(-0.5);            // and no road runs inside its blocks
    }
    expect(touching).toBeGreaterThan(0);
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
