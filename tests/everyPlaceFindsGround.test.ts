// EVERY PLACE ASKED FOR GETS GROUND (reviewer of #4472: a list of 1,000 villages planned only 399 — the rest looked for dry
// ground only in their own direction, found sea, and were left out). A place with no ground in its direction now waits until
// every other place has its own, then takes the nearest free, dry, level-enough ground around the first place, ring by ring,
// off every planned highway, inside the map; one road joins it to its nearest stop. Everything that found ground before —
// the places, their highways, the ground under them — is exactly what it was.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-everyplace-${process.pid}`);
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
  return { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
};
const make = (options: any) => {
  const said = vi.spyOn(console, 'error').mockImplementation(() => {});
  const world = OW.createOpenWorld(context(), { quality: 'phone', ...options });
  const text = said.mock.calls.flat().join('\n'); said.mockRestore();
  return { world, text };
};
const dry = (world: any, p: any) => world.map.world.heightAt(p.centre.x, p.centre.z) >= 2 && !world.map.world.waterAt(p.centre.x, p.centre.z);
const distToLine = (p: { x: number; z: number }, line: Array<{ x: number; z: number }>) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
};

describe('🧭 every place asked for gets ground', () => {
  it('a list of 1,000 villages plans all 1,000 — each on dry ground, none on another, said once in the console', () => {
    const regions = Array.from({ length: 1000 }, (_, i) => ({ id: 'v' + i, kind: 'village', city: { blocksX: 2, blocksZ: 2 } }));
    const { world, text } = make({ seed: 7, regions });
    expect(world.places.length).toBe(1000);
    expect(world.places.every((p: any) => dry(world, p))).toBe(true);
    const cells = new Map<string, any[]>();
    let overlaps = 0;
    for (const p of world.places) {
      const cx = Math.floor(p.centre.x / 2000), cz = Math.floor(p.centre.z / 2000);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of cells.get((cx + i) + ',' + (cz + j)) ?? []) if (Math.hypot(p.centre.x - q.centre.x, p.centre.z - q.centre.z) < p.radius + q.radius) overlaps++;
      (cells.get(cx + ',' + cz) || cells.set(cx + ',' + cz, []).get(cx + ',' + cz)!).push(p);
    }
    expect(overlaps).toBe(0);
    expect(Math.max(...world.places.map((p: any) => Math.hypot(p.centre.x - world.places[0].centre.x, p.centre.z - world.places[0].centre.z)))).toBeLessThan(45000);
    expect(text).toMatch(/\d+ place\(s\) had no dry ground in their own direction and stand on the nearest dry ground instead: "v\d+"/);
    expect(text.split('\n').filter((l) => /stand on the nearest dry ground/.test(l)).length).toBe(1);
    world.dispose();
  }, 180_000);
  const mixed = (n: number) => { const kinds = ['city', 'town', 'village', 'desert', 'jungle']; return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, kind: kinds[i % 5], ...(i % 4 === 1 ? { toward: 'north' } : {}) })); };
  for (const [seed, profile, n] of [[5, 'battle-royale', 60], [3, 'open-world', 140]] as const) {
    it(profile + ' (' + n + ' entries): the places that found ground before stand exactly where they stood, with exactly the same highways', () => {
      const regions = mixed(n);
      const a = make({ seed, profile, regions });
      const waited = rescuedIds(a);
      expect(waited.size).toBeGreaterThan(0);
      // The same list without the places that waited is how the map was planned before: they took no ground and no index.
      const before = make({ seed, profile, regions: regions.filter((r) => !waited.has(r.id)) });
      expect(before.text).not.toMatch(/nearest dry ground/);
      const k = before.world.places.length;
      expect(a.world.places.length).toBe(k + waited.size);
      expect(a.world.places.slice(0, k)).toEqual(before.world.places);
      expect(a.world.lands).toEqual(before.world.lands);
      expect(a.world.highways.slice(0, before.world.highways.length)).toEqual(before.world.highways);
      a.world.dispose(); before.world.dispose();
    }, 180_000);
  }
  it('a place that waited is on dry ground inside the island, never across a highway, and has a road of its own', () => {
    const a = make({ seed: 5, profile: 'battle-royale', regions: mixed(60) });
    const waited = rescuedIds(a);
    expect(waited.size).toBeGreaterThan(5);
    const firstPass = a.world.places.length - waited.size;
    const oldRoads = a.world.highways.slice(0, a.world.highways.length - waited.size);
    for (const p of a.world.places.slice(firstPass)) {
      expect(waited.has(p.id)).toBe(true);
      for (const line of oldRoads) expect(distToLine(p.centre, line)).toBeGreaterThan(p.radius);
      expect(dry(a.world, p)).toBe(true);
      expect(Math.hypot(p.centre.x, p.centre.z)).toBeLessThan(4000);   // inside the 8 km island
    }
    expect(a.world.highways.length).toBe(oldRoads.length + waited.size);
    a.world.dispose();
  }, 180_000);
  it('more places than the island holds: the rest are said and left out — never put in the sea', () => {
    const regions = Array.from({ length: 300 }, (_, i) => ({ id: 'c' + i, kind: 'city' }));
    const { world, text } = make({ seed: 5, profile: 'battle-royale', regions });
    expect(world.places.length).toBeLessThan(300);
    expect(world.places.every((p: any) => dry(world, p))).toBe(true);
    expect(text).toMatch(/no dry ground was found for "c\d+" anywhere on the map; it was left out/);
    world.dispose();
  }, 180_000);
});
/** The places that waited: the console says how many, and they are the last ones planned. */
function rescuedIds(made: { world: any; text: string }): Set<string> {
  const m = /(\d+) place\(s\) had no dry ground in their own direction/.exec(made.text);
  const n = m ? Number(m[1]) : 0;
  return new Set(n ? made.world.places.slice(-n).map((p: any) => p.id) : []);
}
