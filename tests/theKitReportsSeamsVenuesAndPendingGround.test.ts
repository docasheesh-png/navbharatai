// THE KIT REPORTS SEAMS, VENUES AND PENDING GROUND (map expansion plan, item 12 part 2). The playtest's geometry look (#4495)
// learned to read seams between joined places, each venue's pad against the land, and ground changed after it was drawn — but
// the kit's window.__nbWorld.geometry() did not answer them yet. It now does, read-only and within its 150 ms budget, and the
// builder-only findings turn a real problem into one line. Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { geometryFindings } from '../src/server/AgentV3/gameGeometryProbe';

const DIR = join(__dirname, `.tmp-kitreports-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CH: any;
const g = globalThis as any;
const hadWindow = 'window' in g;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, OPEN_WORLD_BRIDGE_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  if (!hadWindow) g.window = {};
}, 120_000);
afterAll(() => { if (!hadWindow) delete g.window; rmSync(DIR, { recursive: true, force: true }); });
const small = { blocksX: 2, blocksZ: 2, traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
const make = (regions: any[], extra: Record<string, unknown> = {}) => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  const world = OW.createOpenWorld(ctx, { seed: 7, regions, ...extra });
  return { ctx, world };
};
const frames = (w: any, ctx: any, n: number) => { for (let i = 0; i < n; i++) w.frame(ctx, 1 / 60); };

describe('🔎 the kit answers seams, venues and pending ground', () => {
  it('a grown city: its joined tiles are sampled where they meet, and they meet level — nothing is said', () => {
    const { world } = make([{ id: 'main', kind: 'city', city: small }, { id: 'main-2', kind: 'city', joinTo: 'main', toward: 'east' }, { id: 'main-3', kind: 'city', joinTo: 'main', toward: 'south' }]);
    const r = g.window.__nbWorld.geometry();
    expect(r.seams.samples).toBeGreaterThan(0);
    expect(r.seams.worst).toBeLessThan(0.5);
    expect(geometryFindings(r).some((f) => /step in the ground/.test(f))).toBe(false);
    world.dispose();
  }, 120_000);

  it('a venue: its pad is read against the land under it, and it stands level — nothing is said', () => {
    const { world } = make([{ id: 'main', kind: 'city', city: small }, { id: 'ground', kind: 'venue', venue: 'football-field', toward: 'east' }]);
    const r = g.window.__nbWorld.geometry();
    expect(r.venues.map((v: any) => v.name)).toEqual(['ground']);
    expect(r.venues[0].off).toBeLessThan(0.5);
    expect(geometryFindings(r).some((f) => /off the land drawn under it/.test(f))).toBe(false);
    world.dispose();
  }, 120_000);

  it('opposite class — a pad laid under the player after the first frame, without lateEdits: the drawn chunks there are pending, and it is said', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }], { lateEdits: false });   // the open world redraws by default (failedbr #2499)
    frames(world, ctx, 30);
    expect(g.window.__nbWorld.geometry().pending.dirty).toBe(0);                     // nothing changed yet
    const at = world.playerWorld();
    world.map.world.levelGround(at.x + 600, at.z + 600, 120, 120, 40, world.map.world.heightAt(at.x + 600, at.z + 600) + 25);
    frames(world, ctx, 30);
    const r = g.window.__nbWorld.geometry();
    expect(r.pending.dirty).toBeGreaterThan(0);
    expect(geometryFindings(r).some((f) => /not redrawn/.test(f))).toBe(true);
    world.dispose();
  }, 120_000);

  it('the same pad laid BEFORE the first frame is drawn as it is: nothing pending', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }]);
    const at = world.playerWorld();
    world.map.world.levelGround(at.x + 600, at.z + 600, 120, 120, 40, world.map.world.heightAt(at.x + 600, at.z + 600) + 25);
    frames(world, ctx, 30);
    expect(g.window.__nbWorld.geometry().pending.dirty).toBe(0);
    world.dispose();
  }, 120_000);

  it('with lateEdits the pad is being redrawn, so nothing is said as pending', () => {
    const { world, ctx } = make([{ id: 'main', kind: 'city', city: small }], { lateEdits: true });
    frames(world, ctx, 30);
    const at = world.playerWorld();
    world.map.world.levelGround(at.x + 600, at.z + 600, 120, 120, 40, world.map.world.heightAt(at.x + 600, at.z + 600) + 25);
    frames(world, ctx, 2);
    expect(g.window.__nbWorld.geometry().pending.dirty).toBe(0);
    world.dispose();
  }, 120_000);
});
