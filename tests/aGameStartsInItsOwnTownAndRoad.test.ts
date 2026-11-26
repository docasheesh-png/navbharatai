// 🏘️🏁 EVERY NEW GAME STARTS IN ITS OWN TOWN AND ON ITS OWN ROAD, AND KEEPS THEM (Q-3373, admin-approved 2026-11-26).
//
// 🔑 THE CLASS (the same one #4541 fixed for WORLD.seed, the car paint and the player): a starting choice the platform makes for
// every game was a constant — createActionTown(count, seed = 1) and the race road's DEFAULT_TRACK_PLAN (map 1, land seed 11) —
// so every action game had the same town and every race opened on the same straight. The calls are written by the BUILDER, so
// the kit cannot know the project id: the seed is written ONCE by the platform into the game's own src/game/gameSeed.ts (from
// projectVariety — no private hash), the kit reads it by itself, and a game made before this keeps the kit defaults.
// Runs the REAL ToolDispatcher recipes and the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ActuatorPort } from '../src/server/AgentV3/ports';
import { gameKitPlan, gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { isPlatformSeededFile } from '../src/server/AgentV3/platformAuthored';
import { GAME_SEED_FILE_PATH, gameSeedFileSource, isUneditedGameSeedFile, varietySeed, withGameSeedFacets } from '../src/server/lib/projectVariety';
import { recipeFilePool, GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

const IDS = ['ws-alpha-01', 'ws-bravo-02', 'ws-charlie-03', 'ws-delta-04', 'ws-echo-05', 'ws-foxtrot-06'];
const TOWN_FILE = 'src/game/three/buildings.ts', RACE_STARTER = 'src/game/RacingRoadGame.tsx';

class MemorySandbox implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string) { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string) { this.files.set(p, c); }
  async listFiles() { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_w: string, port: number) { return `https://s-${port}.example.dev`; }
}
function dispatcher(id: string, act = new MemorySandbox()) {
  if (!act.files.has('package.json')) act.files.set('package.json', JSON.stringify({ name: 'g', dependencies: { three: '0.170.0' }, devDependencies: { '@types/three': '0.170.0', vitest: '^3.2.4' } }));
  const stream = new AgentEventStream();
  return { act, d: new ToolDispatcher(act, id, new WorkspaceState(stream), stream) };
}
const RACE = 'make a 3D car racing game';
const raceShellInput = () => gameKitRecipeInput('generate_game_shell', gameKitPlan(RACE, 'vite-react'), RACE) ?? {};
const numberOf = (src: string | undefined, key: string) => Number(new RegExp(`^ {2}${key}: (\\d+),$`, 'm').exec(String(src))?.[1]);

describe('🎲 the seed file: fixed by the project, spread across projects, never a private hash', () => {
  it('six projects: not all the same town, road or start map; the same project always gets the same file', () => {
    const files = IDS.map((id) => gameSeedFileSource(id, ['town', 'road']));
    expect(new Set(files.map((f) => numberOf(f, 'town'))).size).toBeGreaterThan(1);
    expect(new Set(files.map((f) => numberOf(f, 'road'))).size).toBeGreaterThan(1);
    expect(new Set(files.map((f) => numberOf(f, 'roadStart'))).size).toBeGreaterThan(1);
    for (const id of IDS) expect(gameSeedFileSource(id, ['town', 'road'])).toBe(gameSeedFileSource(id, ['town', 'road']));
    expect(numberOf(files[0], 'town')).toBe(varietySeed(IDS[0], 'town'));
    for (const f of files) { const s = numberOf(f, 'roadStart'); expect(s).toBeGreaterThanOrEqual(1); expect(s).toBeLessThanOrEqual(12); }
  });

  it('a facet is only ever ADDED: the lines already there stay byte for byte; a reshaped file is left alone', () => {
    const roadOnly = gameSeedFileSource(IDS[1], ['road']);
    const both = withGameSeedFacets(roadOnly, IDS[1], ['town', 'road'])!;
    expect(both.startsWith(roadOnly.slice(0, roadOnly.indexOf('};')))).toBe(true);
    expect(numberOf(both, 'town')).toBe(varietySeed(IDS[1], 'town'));
    expect(numberOf(both, 'road')).toBe(numberOf(roadOnly, 'road'));
    expect(withGameSeedFacets(both, IDS[1], ['town', 'road'])).toBeNull();                       // nothing to add
    expect(withGameSeedFacets('export const SEEDS = [1, 2];\n', IDS[1], ['town'])).toBeNull();   // the user's own shape
  });

  it('an untouched seed file is the platform\'s (not the builder\'s code); one edited number makes it the user\'s', () => {
    const f = withGameSeedFacets(gameSeedFileSource(IDS[2], ['road']), IDS[2], ['town'])!;
    expect(isUneditedGameSeedFile(f)).toBe(true);
    expect(isPlatformSeededFile(GAME_SEED_FILE_PATH, f)).toBe(true);
    const edited = f.replace(/town: \d+,/, 'town: 42, // my town');
    expect(isPlatformSeededFile(GAME_SEED_FILE_PATH, edited)).toBe(false);
    expect(isPlatformSeededFile('src/game/other.ts', f)).toBe(false);
  });
});

describe('🏘️ the 3D layer writes the town seed once, when it creates the town', () => {
  it('six new 3D games: each gets src/game/gameSeed.ts with its own town; not all the same', async () => {
    const towns: number[] = [];
    for (const id of IDS) {
      const { act, d } = dispatcher(id);
      const res = await d.dispatch({ id: 't', name: 'generate_game_3d', input: {} }, 'architect');
      expect(res.is_error).toBeFalsy();
      expect(String(res.content)).toContain(`wrote ${GAME_SEED_FILE_PATH}`);
      expect(act.files.get(GAME_SEED_FILE_PATH)).toBe(gameSeedFileSource(id, ['town']));
      towns.push(numberOf(act.files.get(GAME_SEED_FILE_PATH), 'town'));
    }
    expect(new Set(towns).size).toBeGreaterThan(1);
  }, 120_000);

  it('re-edited ("ek dukaan jodo" runs the layer again): the seed file is identical, byte for byte', async () => {
    const { act, d } = dispatcher(IDS[3]);
    await d.dispatch({ id: 't', name: 'generate_game_3d', input: {} }, 'architect');
    const first = act.files.get(GAME_SEED_FILE_PATH);
    const again = await d.dispatch({ id: 't2', name: 'generate_game_3d', input: {} }, 'architect');
    expect(String(again.content)).not.toContain(`wrote ${GAME_SEED_FILE_PATH}`);
    expect(act.files.get(GAME_SEED_FILE_PATH)).toBe(first);
  }, 120_000);

  it('a game made before the seed file (its town file already there) gets none: its town never moves', async () => {
    const { act, d } = dispatcher('ws-old-game');
    act.files.set(TOWN_FILE, '// the town this game has had all along\n');
    await d.dispatch({ id: 't', name: 'generate_game_3d', input: {} }, 'architect');
    expect(act.files.has(GAME_SEED_FILE_PATH)).toBe(false);
  }, 120_000);
});

describe('🏁 the shell writes the road seed once, when it creates the race starter', () => {
  it('six new races: each gets a road and a start map of its own; not all the same', async () => {
    const starts: number[] = [];
    const roads: number[] = [];
    for (const id of IDS) {
      const { act, d } = dispatcher(id);
      await d.dispatch({ id: 't', name: 'generate_game_3d', input: {} }, 'architect');
      const res = await d.dispatch({ id: 't2', name: 'generate_game_shell', input: raceShellInput() }, 'architect');
      expect(res.is_error).toBeFalsy();
      const seed = act.files.get(GAME_SEED_FILE_PATH);
      expect(numberOf(seed, 'town')).toBe(varietySeed(id, 'town'));        // the town written by the layer is kept
      starts.push(numberOf(seed, 'roadStart')); roads.push(numberOf(seed, 'road'));
      expect(isPlatformSeededFile(GAME_SEED_FILE_PATH, seed!)).toBe(true);
    }
    expect(new Set(starts).size).toBeGreaterThan(1);
    expect(new Set(roads).size).toBeGreaterThan(1);
  }, 120_000);

  it('the same race re-edited: the file is identical; an older race (starter already there) gets no road seed', async () => {
    const { act, d } = dispatcher(IDS[4]);
    await d.dispatch({ id: 't', name: 'generate_game_shell', input: raceShellInput() }, 'architect');
    const first = act.files.get(GAME_SEED_FILE_PATH);
    expect(numberOf(first, 'roadStart')).toBeGreaterThan(0);
    await d.dispatch({ id: 't2', name: 'generate_game_shell', input: raceShellInput() }, 'architect');
    expect(act.files.get(GAME_SEED_FILE_PATH)).toBe(first);
    const old = dispatcher('ws-old-race');
    old.act.files.set(RACE_STARTER, '// an older race starter\n');
    old.act.files.set(TOWN_FILE, '// its town\n');
    await old.d.dispatch({ id: 't', name: 'generate_game_shell', input: raceShellInput() }, 'architect');
    expect(old.act.files.has(GAME_SEED_FILE_PATH)).toBe(false);
  }, 120_000);

  it('a shooter\'s shell writes no road (it has no race starter)', async () => {
    const shooter = 'make a 3D zombie shooter game';
    const { act, d } = dispatcher('ws-shooter');
    await d.dispatch({ id: 't', name: 'generate_game_3d', input: {} }, 'architect');
    await d.dispatch({ id: 't2', name: 'generate_game_shell', input: gameKitRecipeInput('generate_game_shell', gameKitPlan(shooter, 'vite-react'), shooter) ?? {} }, 'architect');
    expect(act.files.get(GAME_SEED_FILE_PATH)).not.toMatch(/^ {2}road/m);
  }, 120_000);
});

// ── THE KIT reads the game's own file by itself ─────────────────────────────────────────────────────────────────────────
const DIR = join(__dirname, `.tmp-ownstart-${process.pid}`);
const BARE = join(__dirname, `.tmp-ownstart-bare-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let B: any; let O: any; let BB: any; let OB: any;
const SEEDED = IDS[5];
beforeAll(async () => {
  for (const dir of [DIR, BARE]) for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), f.content); }
  writeFileSync(join(DIR, GAME_SEED_FILE_PATH), gameSeedFileSource(SEEDED, ['town', 'road']));
  B = await import(join(DIR, TOWN_FILE)); O = await import(join(DIR, 'src/game/three/objects.ts'));
  BB = await import(join(BARE, TOWN_FILE)); OB = await import(join(BARE, 'src/game/three/objects.ts'));
}, 120_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); rmSync(BARE, { recursive: true, force: true }); });
const layout = (town: any) => JSON.stringify(town.houses.map((p: any) => [p.design.model, p.design.colour, p.design.layout, Math.round(p.yaw * 1000)]));

describe('🏘️ createActionTown() is this game\'s own town', () => {
  it('six projects\' town seeds lay out different towns', () => {
    const towns = IDS.map((id) => { const t = B.createActionTown(100, varietySeed(id, 'town')); return layout(t); });
    expect(new Set(towns).size).toBeGreaterThan(1);
  });

  it('with no seed passed, the kit takes the game\'s own (src/game/gameSeed.ts); a game without the file keeps seed 1', () => {
    expect(B.projectGameSeed().town).toBe(varietySeed(SEEDED, 'town'));
    expect(layout(B.createActionTown())).toBe(layout(B.createActionTown(100, varietySeed(SEEDED, 'town'))));
    expect(BB.projectGameSeed()).toEqual({});
    expect(layout(BB.createActionTown())).toBe(layout(BB.createActionTown(100, 1)));
    expect(layout(B.createActionTown())).not.toBe(layout(BB.createActionTown()));
  });
});

describe('🏁 the race road is this game\'s own', () => {
  it('projectRoadPlan: the start map and the land come from the file; no file is exactly the old default', () => {
    const own = B.projectGameSeed();
    const plan = O.projectRoadPlan();
    expect(plan.pieces[0].mapId).toBe(own.roadStart);
    expect(plan.seed).toBe(own.road);
    expect(new Set(plan.pieces.map((p: any) => p.mapId)).size).toBe(12);                        // all twelve maps, rotated
    expect(OB.projectRoadPlan()).toBe(OB.DEFAULT_TRACK_PLAN);
    expect(OB.DEFAULT_TRACK_PLAN.pieces[0].mapId).toBe(1);
  });

  it('six projects do not all open on the same map', () => {
    const firsts = IDS.map((id) => {
      const start = Number(/roadStart: (\d+)/.exec(gameSeedFileSource(id, ['road']))![1]);
      return O.projectRoadPlan({ roadStart: start, road: varietySeed(id, 'road') }).pieces[0].mapId;
    });
    expect(new Set(firsts).size).toBeGreaterThan(1);
  });

  it('the race starter and createTrackStream() with no plan take the game\'s own road', () => {
    const shell = GAME_RECIPES.generate_game_shell().files as Record<string, string>;
    expect(shell[RACE_STARTER]).toMatch(/createTrackStream\(config\.current\.plan \?\? projectRoadPlan\(\)/);
    const objects = recipeFilePool().get('src/game/three/objects.ts')!.content;
    expect(objects).toMatch(/export function createTrackStream\(planIn: TrackPlan = projectRoadPlan\(\)/);
  });
});
