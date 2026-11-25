// ONE GROUND, NEVER LAYERS (admin 2026-11-22, failedbr #2499: "mujhe lag raha hai, maps me sabhi city/village ko ek plane me
// na bana kar vertical layers me banaya ja raha hai!"). The phone screenshots showed the hero swimming in the sea under a huge
// flat slab with street lamps, people and parked cars on it, and a slab tilted against a black sky with a car in the air.
//
// Reproduced in a real browser with the real kit: ONE ground edit with a value that is not a number (a region whose toward
// was not one of the eight directions made its spot NaN) was filed under "every point" in the pad index, so heightAt was NaN
// at EVERY point of the map. No terrain was drawn, the player dropped into the sea, and every city already planned hung at its
// own pad height — flat layers over the water. The kit's own geometry report then said "0 off": NaN compares false.
//
// The class is "one bad number poisons the whole ground, silently". Locked here:
//   1. every ground edit refuses a value that is not finite, where it enters (levelGround, setLand, addRoad) — heightAt stays whole;
//   2. a region's direction is read as one of the eight (aliases like 'northeast' or 'NE' too), and a distance as metres, or left out and said;
//   3. the geometry report counts ground that is not a number, and the builder is told so first;
//   4. ground changed after it was first drawn is redrawn in the open world by default, the player and what was place()d stand
//      on the new ground, and with the redraw switched off an edit a feature makes in setup() (after the first draw) is reported.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { geometryFindings } from '../src/server/AgentV3/gameGeometryProbe';

const DIR = join(__dirname, `.tmp-oneground-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any; let AW: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  AW = await import(join(DIR, 'src/game/athree/world.ts'));
  if (!hadWindow) g.window = {};
}, 120_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });

const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 1 };
const make = (regions: any[], extra: Record<string, unknown> = {}) => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  const world = OW.createOpenWorld(ctx, { seed: 7, regions, vegetation: false, ...extra });
  return { ctx, world };
};
const frames = (w: any, ctx: any, n: number) => { for (let i = 0; i < n; i++) w.frame(ctx, 1 / 60); };
/** heightAt on a 9 x 9 grid 3 km across around a point: how many answers are not a number. */
const holes = (heightAt: (x: number, z: number) => number, cx: number, cz: number) => {
  let bad = 0;
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) if (!Number.isFinite(heightAt(cx + i * 375, cz + j * 375))) bad++;
  return bad;
};
const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

describe('🧱 one bad number never poisons the ground', () => {
  it('levelGround, setLand and addRoad refuse a value that is not finite — heightAt stays a number everywhere, and it is said', () => {
    const err = quiet();
    const w = AW.createAthreeWorld({ seed: 7, profile: 'open-world' });
    expect(holes(w.heightAt, 0, 0)).toBe(0);
    const edits = w.editCount();
    w.levelGround(Number.NaN, 0, 100, 100, 60);                 // the failedbr #2499 shape: a spot that is NaN
    w.levelGround(0, 0, Number.NaN, 100, 60);
    w.levelGround(0, 0, 100, 100, Number.POSITIVE_INFINITY);
    w.setLand(Number.NaN, 0, 400, 'mountain');
    w.addRoad([{ x: 0, z: 0 }, { x: 500, z: 0 }], Number.NaN);
    expect(holes(w.heightAt, 0, 0)).toBe(0);
    expect(holes(w.heightAt, -3800, 3450)).toBe(0);
    expect(w.editCount()).toBe(edits);                           // nothing was laid
    expect(err.mock.calls.map((c) => String(c[0])).filter((m) => /not a number/.test(m)).length).toBe(5);
    // A refused pad at a real place answers the ground there; with no place at all, NaN (never a made-up height).
    expect(Number.isFinite(w.levelGround(10, 20, Number.NaN, 5, 5))).toBe(true);
    expect(Number.isNaN(w.levelGround(Number.NaN, 20, 5, 5, 5))).toBe(true);
    err.mockRestore();
  });

  it('a valid pad after a refused one still levels its ground', () => {
    const err = quiet();
    const w = AW.createAthreeWorld({ seed: 7, profile: 'open-world' });
    w.levelGround(Number.NaN, Number.NaN, 50, 50, 40);
    const y = w.levelGround(1000, 1000, 50, 50, 40, 42);
    expect(y).toBe(42);
    expect(w.heightAt(1000, 1000)).toBeCloseTo(42, 6);
    expect(w.heightAt(1030, 970)).toBeCloseTo(42, 6);
    err.mockRestore();
  });
});

describe('🧭 a region is read before it is laid', () => {
  it('directions: the eight as written, common spellings mapped, anything else left out and said; distance as metres', () => {
    const err = quiet();
    expect(OW.compassOf('north-east')).toBe('north-east');
    expect(OW.compassOf('northeast')).toBe('north-east');
    expect(OW.compassOf('North East')).toBe('north-east');
    expect(OW.compassOf('SW')).toBe('south-west');
    expect(OW.compassOf('sideways')).toBeUndefined();
    expect(OW.compassOf(42)).toBeUndefined();
    expect(OW.cleanRegion({ id: 'a', kind: 'town', toward: 'southwest' })).toEqual({ id: 'a', kind: 'town', toward: 'south-west' });
    expect(OW.cleanRegion({ id: 'b', kind: 'town', toward: 'up' })).toEqual({ id: 'b', kind: 'town' });
    expect(OW.cleanRegion({ id: 'c', kind: 'town', distance: 'far' })).toEqual({ id: 'c', kind: 'town' });
    expect(OW.cleanRegion({ id: 'd', kind: 'town', distance: '2500' })).toEqual({ id: 'd', kind: 'town', distance: 2500 });
    const same = { id: 'e', kind: 'town', toward: 'east', distance: 900 };
    expect(OW.cleanRegion(same)).toBe(same);                     // a clean region is the same object (nothing copied)
    expect(err.mock.calls.length).toBe(2);
    err.mockRestore();
  });

  it('THE REPORTED WORLD: a place asked toward "southwest" (not one of the eight) — the ground stays one ground, every place on it', () => {
    const err = quiet();
    const { world, ctx } = make([
      { id: 'delhi', kind: 'city', city: small },
      { id: 'delhi-2', kind: 'city', joinTo: 'delhi', toward: 'east' },
      { id: 'desert', kind: 'desert', toward: 'east' },
      { id: 'mumbai', kind: 'city', toward: 'southwest', distance: 1500, city: small },
      { id: 'pune', kind: 'town', toward: 'up', city: small },
      { id: 'agra', kind: 'village', distance: 'far', city: small },
    ]);
    frames(world, ctx, 5);
    const W = world.map.world;
    for (const p of world.places) {
      expect(Number.isFinite(p.centre.x) && Number.isFinite(p.centre.z), p.id).toBe(true);
      expect(Number.isFinite(W.heightAt(p.centre.x, p.centre.z)), p.id).toBe(true);
    }
    const mumbai = world.places.find((p: any) => p.id === 'mumbai');
    const home = world.places[0];
    expect(mumbai.centre.x).toBeLessThan(home.centre.x);         // it lies south-west, as asked
    expect(mumbai.centre.z).toBeGreaterThan(home.centre.z);
    expect(holes((x, z) => W.heightAt(x, z), home.centre.x, home.centre.z)).toBe(0);
    // The player stands on the ground at the start, and every built city's root stands on its pad.
    const at = world.playerWorld();
    expect(Math.abs(at.y - W.heightAt(at.x, at.z))).toBeLessThan(0.6);
    for (const t of world.regions) expect(Math.abs(t.centre.y - W.heightAt(t.centre.x, t.centre.z))).toBeLessThan(0.05);
    const r = g.window.__nbWorld.geometry();
    expect(r.terrain.notNumber).toBe(0);
    expect(r.terrain.off).toBe(0);
    world.dispose();
    err.mockRestore();
  }, 120_000);

  it('every place of a mixed 14-region world: centre, pad and player all on one ground (the player walked to each)', () => {
    const err = quiet();
    const { world, ctx } = make([
      { id: 'delhi', kind: 'city', city: small }, { id: 'delhi-2', kind: 'city', joinTo: 'delhi', toward: 'east', city: small },
      { id: 'sand', kind: 'desert', toward: 'east' }, { id: 'desert-town', kind: 'town', toward: 'east', distance: 1800, city: small },
      { id: 'woods', kind: 'jungle', toward: 'west' }, { id: 'jungle-village', kind: 'village', toward: 'west', distance: 1600, city: small },
      { id: 'peaks', kind: 'mountain', toward: 'north' }, { id: 'hill-village', kind: 'village', toward: 'north', distance: 1800, city: small },
      { id: 'snow', kind: 'snow', joinTo: 'peaks' }, { id: 'coast', kind: 'beach', toward: 'south' },
      { id: 'port', kind: 'town', toward: 'south', distance: 1600, city: small }, { id: 'rampur', kind: 'village', city: small },
      { id: 'maidan', kind: 'grassland', joinTo: 'delhi' }, { id: 'ground', kind: 'venue', venue: 'football-field', toward: 'west' },
    ], { liveCities: false });
    const W = world.map.world;
    for (const p of world.places) {
      const c = p.centre;
      ctx.player.reset(c.x - world.map.chunks.origin.x, W.heightAt(c.x, c.z) + 0.2, c.z - world.map.chunks.origin.z);
      frames(world, ctx, 12);
      const at = world.playerWorld();
      const land = W.heightAt(at.x, at.z);
      expect(Number.isFinite(land), p.id).toBe(true);
      expect(land, p.id).toBeGreaterThan(W.seaLevel);           // never in the sea under a place
      expect(Math.abs(at.y - land), p.id).toBeLessThan(1);
      const r = g.window.__nbWorld.geometry();
      expect(r.terrain.notNumber, p.id).toBe(0);
      expect(r.terrain.off, p.id).toBe(0);
    }
    for (const t of world.regions) expect(Math.abs(t.centre.y - W.heightAt(t.centre.x, t.centre.z))).toBeLessThan(0.05);
    world.dispose();
    err.mockRestore();
  }, 240_000);
});

describe('🔎 the report tells the truth about ground that is not a number', () => {
  it('geometry(): NaN ground is counted as off and as notNumber (it used to read 0 off), and the builder is told first', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }]);
    frames(world, ctx, 3);
    const real = world.map.world.heightAt;
    world.map.world.heightAt = () => Number.NaN;                 // the poisoned map, as #2499's was
    const r = g.window.__nbWorld.geometry();
    world.map.world.heightAt = real;
    expect(r.terrain.samples).toBeGreaterThan(0);
    expect(r.terrain.notNumber).toBeGreaterThan(0);
    expect(r.terrain.off).toBe(r.terrain.samples);
    const findings = geometryFindings(JSON.parse(JSON.stringify(r)));   // NaN arrives as null over the wire
    expect(findings[0]).toMatch(/NOT A NUMBER/);
    world.dispose();
  }, 120_000);

  it('geometryFindings: nothing is said for ground that is all numbers', () => {
    expect(geometryFindings({ terrain: { samples: 100, off: 0, worst: 0, notNumber: 0 } }).some((f) => /NOT A NUMBER/.test(f))).toBe(false);
    expect(geometryFindings({ terrain: { samples: 100, off: 0, worst: 0 } }).some((f) => /NOT A NUMBER/.test(f))).toBe(false);   // an older kit
  });
});

describe('✏️ ground changed after it was first drawn', () => {
  it('default (lateEdits left out): a pad laid under the player after the first frame is redrawn, and the player and a placed prop stand on it', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }]);
    frames(world, ctx, 20);
    const at = world.playerWorld();
    const sx = at.x + 400, sz = at.z + 400;
    const prop = new THREE.Group(); prop.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    world.place(prop, sx, sz);
    const top = world.map.world.heightAt(sx, sz) + 30;
    world.map.world.levelGround(sx, sz, 120, 120, 40, top);
    frames(world, ctx, 60);
    const r = g.window.__nbWorld.geometry();
    expect(r.terrain.off).toBe(0);
    expect(r.pending.dirty).toBe(0);
    expect(prop.position.y - 0.5).toBeCloseTo(top, 1);          // the box's bottom on the new ground
    world.dispose();
  }, 120_000);

  it('lateEdits: false — an edit a feature makes in setup(), after the terrain was first drawn but before the first frame, is reported', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }], { lateEdits: false });
    const at = world.playerWorld();
    world.map.world.levelGround(at.x, at.z, 120, 120, 40, world.map.world.heightAt(at.x, at.z) + 25);   // a feature's setup()
    frames(world, ctx, 10);
    expect(g.window.__nbWorld.geometry().pending.dirty).toBeGreaterThan(0);
    world.dispose();
  }, 120_000);
});
