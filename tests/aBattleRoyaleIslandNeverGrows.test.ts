// A BATTLE ROYALE ISLAND NEVER GROWS (map expansion plan, item 9; owner decision 2026-11-23: a battle royale stays an 8 km
// island, and no place may silently fall into the sea). A size asked for (spreadMeters) above the loop size used to RAISE the
// map's size even on a bounded island — a 200 km "island" with places 70 km out. A bounded map is now never made bigger: the
// places stand on the island's dry land, and the console says the size asked was not used. Looping worlds are unchanged.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-brisland-${process.pid}`);
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
const twenty = () => Array.from({ length: 20 }, (_, i) => ({ id: 'town-' + i, kind: 'city', city: small }));
const dry = (w: any, x: number, z: number) => w.map.world.heightAt(x, z) >= 2 && !w.map.world.waterAt(x, z);
const said = (err: any, re: RegExp) => err.mock.calls.some((c: any[]) => re.test(String(c[0])));

describe('🏝️ a battle royale island never grows', () => {
  it('a size of 200 km asked on the island: still 8 km, bounded; every place on its dry land, inside it; and it is said', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = OW.createOpenWorld(context(), { seed: 7, profile: 'battle-royale', regions: twenty(), spreadMeters: 200000 });
    expect(w.map.world.mode).toBe('bounded');
    expect(w.map.world.sizeMeters).toBe(8000);
    expect(w.places.length).toBeGreaterThan(0);
    for (const p of w.places) {
      expect(dry(w, p.centre.x, p.centre.z)).toBe(true);
      expect(Math.max(Math.abs(p.centre.x), Math.abs(p.centre.z))).toBeLessThanOrEqual(4000);
    }
    expect(said(err, /island of 8 km and is never made bigger/)).toBe(true);
    // every one of the 20 is on the map or named as left out — none silently lost
    const ids = new Set(w.places.map((p: any) => p.region?.id ?? p.id));
    for (let i = 0; i < 20; i++) if (!ids.has('town-' + i)) expect(said(err, new RegExp('"town-' + i + '"'))).toBe(true);
    err.mockRestore(); w.dispose();
  }, 240_000);

  it('20 places on the island with no size asked: all on dry land, and nothing new is said', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = OW.createOpenWorld(context(), { seed: 7, profile: 'battle-royale', regions: twenty() });
    expect(w.map.world.sizeMeters).toBe(8000);
    for (const p of w.places) expect(dry(w, p.centre.x, p.centre.z)).toBe(true);
    expect(said(err, /never made bigger/)).toBe(false);
    err.mockRestore(); w.dispose();
  }, 240_000);

  it('opposite class — a looping open world IS still raised to a size asked above its loop (unchanged)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const w = OW.createOpenWorld(context(), { seed: 7, regions: [{ id: 'main', kind: 'city', city: small }, { id: 'far', kind: 'city', city: small }], spreadMeters: 150000 });
    expect(w.map.world.mode).toBe('loop');
    expect(w.map.world.sizeMeters).toBe(150000);
    expect(said(err, /never made bigger/)).toBe(false);
    err.mockRestore(); w.dispose();
  }, 240_000);

  it('an explicit mode: bounded is honoured the same way; mode: loop on a royale profile still grows (the game asked for a loop)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = OW.createOpenWorld(context(), { seed: 3, mode: 'bounded', sizeMeters: 6000, regions: [{ id: 'main', kind: 'city', city: small }], spreadMeters: 120000 });
    expect(b.map.world.sizeMeters).toBe(6000);
    b.dispose();
    const l = OW.createOpenWorld(context(), { seed: 3, profile: 'battle-royale', mode: 'loop', regions: [{ id: 'main', kind: 'city', city: small }], spreadMeters: 120000 });
    expect(l.map.world.sizeMeters).toBe(120000);
    l.dispose(); err.mockRestore();
  }, 240_000);
});
