// MAPS JOINED INTO ONE WORLD STAND EDGE TO EDGE (failedbr #2494 autopsy). "4 bade map jod ke ek bada giant world" became places
// spread kilometres apart, each on its own levelled ground at its own height — maps that never joined. The rule now sends a
// "join into one" wish (Hindi or English) to joined tiles of the first region (joinTo), and lands beside them with no distance;
// "aur maps jodo" / "map 50x bada" still add spread places. The kit itself is run on what the rule asks for. Synthetic only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_WORLD_RULE, OPEN_WORLD_HANDOFF } from '../src/server/AgentV3/gameKitSeed';

describe('🧩 the rule: "jod ke ek world" is edge to edge, "aur maps jodo" is still spread', () => {
  it('keys on the "into ONE" phrasing, Hindi and English, and says how', () => {
    for (const wish of ['jod ke ek (bada) map / world banao', 'ek hi map bana do', 'mila ke ek karo', 'chipka ke ek kar do', 'join / merge the maps into one world'])
      expect(GAME_WORLD_RULE, wish).toContain(wish);
    expect(GAME_WORLD_RULE).toMatch(/only when the maps are to BECOME ONE map/);
    expect(GAME_WORLD_RULE).toMatch(/EDGE TO EDGE, never kilometres apart/);
    expect(GAME_WORLD_RULE).toMatch(/joinTo: '<first region id>'/);
    expect(GAME_WORLD_RULE).toMatch(/land region JOINED to it, \{ id, kind: 'desert' …, joinTo: '<first region id>' \}/);
    expect(OPEN_WORLD_HANDOFF).toContain(GAME_WORLD_RULE);
  });
  it('keeps the universe and 50x behaviour: more places spread out, never a stretched map; duplicates are copies', () => {
    expect(GAME_WORLD_RULE).toMatch(/"Map N guna \/ N× bada karo", "universe banao", "aur maps jodo" → ADD regions/);
    expect(GAME_WORLD_RULE).toMatch(/"aur maps jodo" \/ "map bada karo" ADD spread places/);
    expect(GAME_WORLD_RULE).toMatch(/NEVER raise sizeMeters to make the map bigger/);
    expect(GAME_WORLD_RULE).toMatch(/duplicate karke jodo" → add copies of the existing regions with new ids/);
    expect(GAME_WORLD_RULE).toMatch(/Up to 1000 regions/);
  });
});

// The re-review (2026-11-23): the bare Hindi word "ek" (one / a) must never turn an ADD into a JOIN, and "aapas me road se
// jodo" (join them with roads) is roads between places, not moving them together.
describe('🧭 "ek" alone keeps the spread behaviour', () => {
  const join = GAME_WORLD_RULE.slice(GAME_WORLD_RULE.indexOf('JOINED INTO ONE'));
  const wishes = join.slice(0, join.indexOf('→'));
  const keepsSpread = join.slice(join.indexOf('The word "ek" alone NEVER means this'));
  for (const ask of ['ek aur map jodo', 'ek naya map jodo', 'ek desert map jodo']) it(ask, () => {
    expect(wishes).not.toContain(ask);
    expect(keepsSpread).toMatch(new RegExp(ask.split(' ').join('\\s+')));
    expect(keepsSpread).toMatch(/ADD one spread place or land/);
  });
  it('sab shehron ko aapas me road se jodo = roads between places', () => {
    expect(wishes).not.toMatch(/aapas me/);
    expect(keepsSpread).toMatch(/"sab shehron ko aapas me\s+road se jodo" means ROADS between the places/);
    expect(keepsSpread).toMatch(/not moving them edge to edge/);
  });
  it('no JOIN wish is keyed on a bare "ek": every one says "into one" in some form', () => {
    const listed = [...wishes.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThanOrEqual(5);
    for (const w of listed) expect(w, w).toMatch(/\bek\s+(?:\(bada\)\s+)?(?:hi\s+)?(?:map|world|karo|kar)|\binto one\b|ek\s*$/i);
  });
});

const DIR = join(__dirname, `.tmp-joined-${process.pid}`);
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
const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };

describe('🌍 what the rule asks for really is one joined world in the kit', () => {
  it('"4 map jod ke ek world": four joined tiles share one ground level, touch, and need no highway between them', () => {
    const world = OW.createOpenWorld(context(), { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: small },
      { id: 'map-2', kind: 'city', joinTo: 'main-city', toward: 'east' },
      { id: 'map-3', kind: 'city', joinTo: 'main-city', toward: 'south' },
      { id: 'map-4', kind: 'city', joinTo: 'main-city', city: { style: 'town' } },
    ] });
    expect(world.places.length).toBe(4);
    const ys = world.places.map((p: any) => world.heightAt(p.centre.x, p.centre.z));
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.01);                          // one level, not four plateaus
    const far = Math.max(...world.places.map((p: any) => Math.hypot(p.centre.x - world.places[0].centre.x, p.centre.z - world.places[0].centre.z)));
    expect(far).toBeLessThan(600);                                                           // edge to edge, not kilometres apart
    expect(world.highways.length).toBe(0);
    world.dispose();
  }, 120_000);
  it('a land asked for in the same breath, with no distance, is laid near the joined city and joined to it by a highway', () => {
    const joined = OW.createOpenWorld(context(), { seed: 7, regions: [
      { id: 'main-city', kind: 'city', city: small },
      { id: 'map-2', kind: 'city', joinTo: 'main-city', toward: 'east' },
      { id: 'desert', kind: 'desert', toward: 'west' },
    ] });
    const home = joined.places[0].centre, d = joined.lands[0];
    const gap = Math.hypot(d.centre.x - home.x, d.centre.z - home.z) - d.radius - joined.places[0].radius;
    expect(gap).toBeLessThan(1500);
    expect(joined.highways.length).toBe(1);
    joined.dispose();
  }, 120_000);
});
