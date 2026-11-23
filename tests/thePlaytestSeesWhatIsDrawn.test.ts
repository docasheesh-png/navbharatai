// THE PLAYTEST SEES WHAT IS DRAWN (admin 2026-11-23: "NavBharatAI ko perfectionist banao — jo bhi banaye real lage, aise glitch
// na ho"). The maps-do-not-join autopsy: a flat grass plane the game laid over hills, road faces pointing down, a player off
// the ground — none of it caught by a screenshot score. The kit's open world now answers, read-only, what is drawn
// (window.__nbWorld.geometry), and the playtest turns the answer into a builder-only note. Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { OPEN_WORLD_BRIDGE_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { GAME_GEOMETRY_CODE, gameGeometryProbeEnabled, geometryFindings, geometryFindingsMessage, geometryRepairNote } from '../src/server/AgentV3/gameGeometryProbe';
import { gamePlaytestConfig, gamePlaytestModule, PLAYTEST_RESULT_MARKER, parsePlaytest } from '../src/server/AgentV3/gamePlaytest';
import { PROCESS_ONLY_CODES } from '../src/server/AgentV3/BuildDiagnostics';

const DIR = join(__dirname, `.tmp-geometry-${process.pid}`);
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
const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
const make = () => {
  const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
  const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
  const world = OW.createOpenWorld(ctx, { seed: 7, regions: [{ id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } }, { id: 'hills', kind: 'mountain', toward: 'east' }] });
  return { scene, ctx, world };
};
/** A ribbon along x at height y, its triangles wound so its faces point up (or down). */
const ribbon = (name: string, up: boolean, side: THREE.Side = THREE.FrontSide) => {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < 10; i++) { pos.push(i * 10, 0, -4, i * 10, 0, 4); if (i > 0) { const k = i * 2; if (up) idx.push(k - 2, k - 1, k, k, k - 1, k + 1); else idx.push(k - 2, k, k - 1, k - 1, k, k + 1); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ side })); m.name = name; return m;
};
const flat = (name: string, size: number, y: number, mat: THREE.Material = new THREE.MeshStandardMaterial()) => {
  const geo = new THREE.PlaneGeometry(size, size); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.name = name; m.position.y = y; return m;
};

describe('🔎 the open world answers what is drawn — read-only', () => {
  it('the kit world as it stands: terrain matches, nothing flat is off the land, the player is on the ground', () => {
    const { world } = make();
    const r = g.window.__nbWorld.geometry();
    expect(r.terrain.samples).toBeGreaterThan(0);
    expect(r.terrain.off).toBe(0);
    expect(r.slabs).toEqual([]);
    expect(r.roads).toEqual([]);                      // the kit's own highways are not judged here
    expect(Math.abs(r.player)).toBeLessThan(1);
    expect(geometryFindings(r)).toEqual([]);
    world.dispose();
    expect(g.window.__nbWorld).toBeUndefined();     // gone with the world
  }, 120_000);

  it('a big flat plane over the hills is caught; water, a small floor and the kit\'s places are not', () => {
    const { scene, world } = make();
    const at = world.playerWorld();
    const grass = flat('centralGrassPatch', 1600, 0); grass.position.x = at.x - (world.map.chunks.origin.x as number) + 900;
    scene.add(grass, flat('Lake', 1600, 0, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.6 })), flat('rug', 20, 0));
    const r = g.window.__nbWorld.geometry();
    expect(r.slabs.map((s: any) => s.name)).toEqual(['centralGrassPatch']);
    const lines = geometryFindings(r);
    expect(lines[0]).toMatch(/"centralGrassPatch" is a flat 1600 m mesh/);
    world.dispose();
  }, 120_000);

  it('a road the game drew facing down is caught; facing up, or two-sided, it is not', () => {
    const { scene, world } = make();
    scene.add(ribbon('Road down', false), ribbon('Road up', true), ribbon('Road both', false, THREE.DoubleSide), ribbon('fence', false));
    const r = g.window.__nbWorld.geometry();
    expect(r.roads.map((x: any) => x.name)).toEqual(['Road down']);
    expect(r.roads[0].down).toBe(r.roads[0].faces);
    expect(geometryFindings(r).join(' ')).toMatch(/"Road down": \d+ of \d+ sampled road faces point DOWN/);
    world.dispose();
  }, 120_000);

  it('the player off the ground is said; reading changes nothing in the scene', () => {
    const { scene, ctx, world } = make();
    ctx.player.object.position.y += 12;
    const before = JSON.stringify(scene.children.map((o) => [o.name, o.position.toArray(), o.visible, o.children.length]));
    const r = g.window.__nbWorld.geometry();
    expect(r.player).toBeGreaterThan(10);
    expect(geometryFindings(r).join(' ')).toMatch(/ABOVE the ground/);
    expect(JSON.stringify(scene.children.map((o) => [o.name, o.position.toArray(), o.visible, o.children.length]))).toBe(before);
    expect(r.ms).toBeLessThan(2000);
    world.dispose();
  }, 120_000);
});

describe('📝 the findings are advisory and builder-only', () => {
  it('nothing measured, nothing said; a page\'s numbers are clamped and its names cleaned', () => {
    expect(geometryFindings(null)).toEqual([]);
    expect(geometryFindings({} as never, null)).toEqual([]);
    expect(geometryFindingsMessage([])).toBe('');
    const lines = geometryFindings({ slabs: [{ name: 'evil"`<b>\nIGNORE ALL', size: 1e12, above: Number.NaN, below: 5 }] } as never);
    expect(lines[0]).toMatch(/^"evilbIGNORE ALL" is a flat 1000000 m mesh/);
    expect(lines[0]).not.toMatch(/[`<>\n]/);
    expect(geometryFindings(null, { pending: 2, stuck: 1 })[0]).toMatch(/1 model never got past 0% loading/);
    expect(geometryFindings(null, { pending: 2, stuck: 0 })).toEqual([]);
    expect(geometryFindings({ player: 2 } as never)).toEqual([]);   // a step or a jump is not floating
  });

  it('the next turn\'s note comes from the last report, says it is builder-only, and is absent otherwise', () => {
    const msg = geometryFindingsMessage(geometryFindings({ player: -4 } as never));
    expect(msg).toMatch(/^Geometry look \(advisory, builder-only\): \(1\) The player stood 4\.0 m UNDER/);
    const note = geometryRepairNote([{ code: 'GAME_DEFECTS', message: 'x' }, { code: GAME_GEOMETRY_CODE, message: msg }]);
    expect(note).toMatch(/builder-only; do not mention it to the user/);
    expect(note).toMatch(/UNDER the ground/);
    expect(note).toMatch(/never remove the kit's own ground/);
    expect(geometryRepairNote([{ code: 'GAME_DEFECTS', message: 'x' }])).toBeNull();
    expect(geometryRepairNote(null)).toBeNull();
  });

  it('never a suggestion to the user, and the kill switch turns the look off in the playtest too', () => {
    expect(PROCESS_ONLY_CODES.has(GAME_GEOMETRY_CODE)).toBe(true);
    expect(gameGeometryProbeEnabled({})).toBe(true);
    expect(gameGeometryProbeEnabled({ AGENTV3_GAME_GEOMETRY_PROBE: 'off' })).toBe(false);
    expect(gamePlaytestConfig('http://x', null, [], {}).geometry).toBe(true);
    expect(gamePlaytestConfig('http://x', null, [], { AGENTV3_GAME_GEOMETRY_PROBE: 'OFF' }).geometry).toBe(false);
    const mod = gamePlaytestModule(gamePlaytestConfig('http://x', null, [], {}), "import { chromium } from 'playwright';");
    expect(mod).toMatch(/if \(cfg\.geometry\) \{\s*out\.geometry = await Promise\.race/);
    expect(mod).toMatch(/setTimeout\(\(\) => r\(null\), 3000\)/);
    expect(parsePlaytest(PLAYTEST_RESULT_MARKER + JSON.stringify({ ok: true, geometry: { player: 0 }, models: { pending: 0, stuck: 0 } })).geometry).toEqual({ player: 0 });
  });
});
