// 🎲 A NEW GAME GETS ITS OWN LOOK, AND KEEPS IT (external Game Maker audit, admin-approved 2026-11-25: six new games must not
// all get the same car and the same city; "ek dukaan jodo" must never change the map or the car).
//
// 🧬 THE CLASS: a starting choice the platform made for every new game was a constant (car paint 0xb42b2b, WORLD.seed 7,
// city seed 11 + 17n). The fix is one rule (projectVariety.ts): a choice fixed by the project's own id, written once into the
// project's own file, and everything else derived from that file — so different projects differ and an edit changes nothing.
// Runs the REAL ToolDispatcher recipes and the REAL generated kit.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import type { ActuatorPort } from '../src/server/AgentV3/ports';
import { gameKitPlan, gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { CAR_FILE_PATH, raceCarFile, setCarModel } from '../src/server/AgentV3/carSwap';
import { isPlatformSeededFile } from '../src/server/AgentV3/platformAuthored';
import { STARTER_CAR_PAINTS, pickVariant, starterCarPaint, varietyIndex } from '../src/server/lib/projectVariety';
import { GAME_WORLD_FILE_PATH, gameWorldFileSource } from '../src/server/lib/GameOpenWorldGenerator';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';

const IDS = ['ws-alpha-01', 'ws-bravo-02', 'ws-charlie-03', 'ws-delta-04', 'ws-echo-05', 'ws-foxtrot-06'];

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
const raceShellInput = () => gameKitRecipeInput('generate_game_shell', gameKitPlan(RACE, 'react-vite'), RACE);
const paintOf = (src: string | undefined) => /color: (0x[0-9a-f]{6})/.exec(String(src))?.[1];
const seedOf = (src: string | undefined) => Number(/seed: (\d+)/.exec(String(src))?.[1]);

describe('🎲 one rule: fixed by the project, spread across the pool', () => {
  it('the same project always gets the same pick; six projects do not all get the same one', () => {
    for (const id of IDS) expect(starterCarPaint(id)).toBe(starterCarPaint(id));
    expect(new Set(IDS.map(starterCarPaint)).size).toBeGreaterThan(1);
    expect(new Set(IDS.map((id) => varietyIndex(id, 'any-facet', 7))).size).toBeGreaterThan(1);
    expect(STARTER_CAR_PAINTS).toContain(pickVariant('x', 'car-paint', STARTER_CAR_PAINTS));
    expect(() => pickVariant('x', 'f', [])).toThrow();
  });
});

describe('🏁 a new race gets its own car paint, written once into src/game/car.ts', () => {
  it('six new races: the car file exists, and not every car has the same paint', async () => {
    expect((raceShellInput()?.include as string[])).toContain('racingroadgame');
    const paints: string[] = [];
    for (const id of IDS) {
      const { act, d } = dispatcher(id);
      const res = await d.dispatch({ id: 't', name: 'generate_game_shell', input: raceShellInput() ?? {} }, 'architect');
      expect(res.is_error).toBeFalsy();
      expect(String(res.content)).toContain(`created ${CAR_FILE_PATH}`);
      const car = act.files.get(CAR_FILE_PATH);
      expect(car).toBe(raceCarFile(null, starterCarPaint(id)));
      expect(isPlatformSeededFile(CAR_FILE_PATH, car!)).toBe(true);           // an untouched car file is ours, not the user's code
      paints.push(paintOf(car)!);
    }
    expect(new Set(paints).size).toBeGreaterThan(1);
  }, 120_000);

  it('an edit never repaints it: the shell run again keeps the user\'s car file byte for byte', async () => {
    const { act, d } = dispatcher(IDS[2]);
    await d.dispatch({ id: 't', name: 'generate_game_shell', input: raceShellInput() ?? {} }, 'architect');
    const theirs = setCarModel(act.files.get(CAR_FILE_PATH), 'sports car');
    expect(theirs.ok).toBe(true);
    if (theirs.ok) act.files.set(CAR_FILE_PATH, theirs.source);
    const before = act.files.get(CAR_FILE_PATH);
    const again = await d.dispatch({ id: 't2', name: 'generate_game_shell', input: raceShellInput() ?? {} }, 'architect');
    expect(String(again.content)).not.toContain(`created ${CAR_FILE_PATH}`);
    expect(act.files.get(CAR_FILE_PATH)).toBe(before);
    expect(paintOf(before)).toBe(paintOf(raceCarFile(null, starterCarPaint(IDS[2]))));
  }, 120_000);

  it('only a race the seed knows is a race: a non-race shell, or a shell with no include, writes no car file', async () => {
    const shooter = 'make a 3D zombie shooter game';
    const { act, d } = dispatcher('ws-shooter');
    await d.dispatch({ id: 't', name: 'generate_game_shell', input: gameKitRecipeInput('generate_game_shell', gameKitPlan(shooter, 'react-vite'), shooter) ?? {} }, 'architect');
    expect(act.files.has(CAR_FILE_PATH)).toBe(false);
    const bare = dispatcher('ws-bare');
    await bare.d.dispatch({ id: 't', name: 'generate_game_shell', input: {} }, 'architect');
    expect(bare.act.files.has(CAR_FILE_PATH)).toBe(false);
  }, 120_000);
});

describe('🗺️ a new open world gets its own map seed, written once into src/game/world.ts', () => {
  it('six projects: not every world has the same seed; the same project gets the same file; no id keeps the old seed', () => {
    const seeds = IDS.map((id) => seedOf(gameWorldFileSource({ city: true, workspaceId: id })));
    expect(new Set(seeds).size).toBeGreaterThan(1);
    for (const id of IDS) expect(gameWorldFileSource({ city: true, workspaceId: id })).toBe(gameWorldFileSource({ city: true, workspaceId: id }));
    expect(seedOf(gameWorldFileSource({ city: true }))).toBe(7);
  });

  it('the recipe writes it once with this project\'s seed and never over the user\'s map', async () => {
    const { act, d } = dispatcher(IDS[0]);
    act.files.set('src/game/athree/index.ts', 'export {};\n');                // the map this starter stands on
    const res = await d.dispatch({ id: 't', name: 'generate_open_world', input: { mount: true, city: true } }, 'architect');
    expect(res.is_error).toBeFalsy();
    expect(act.files.get(GAME_WORLD_FILE_PATH)).toBe(gameWorldFileSource({ city: true, workspaceId: IDS[0] }));
    const edited = act.files.get(GAME_WORLD_FILE_PATH)!.replace("  regions: [\n", "  regions: [\n    { id: 'shop-street', kind: 'town' },\n");
    act.files.set(GAME_WORLD_FILE_PATH, edited);
    act.files.set('src/App.tsx', 'export default function App() { return null; }');
    await d.dispatch({ id: 't2', name: 'generate_open_world', input: { mount: true, city: true } }, 'architect');
    expect(act.files.get(GAME_WORLD_FILE_PATH)).toBe(edited);
  }, 120_000);
});

// ── THE KIT: the places' look comes from the map's seed ─────────────────────────────────────────────────────────────────
const DIR = join(__dirname, `.tmp-variety-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let OW: any; let CITY: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  OW = await import(join(DIR, 'src/game/play/openWorld.ts'));
  CITY = await import(join(DIR, 'src/game/three/city.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const lotsOf = (look: { seed: number; style?: string }) => JSON.stringify(CITY.planCity({ blocksX: 4, blocksZ: 4, style: 'mixed', ...look }).lots.map((l: any) => [l.kind, l.floors ?? l.height ?? 0]));

describe('🏙️ the kit derives each place\'s buildings from the map, and never moves them on an edit', () => {
  it('a map on the old seed 7 keeps exactly the city it had (seed 11 + 17n, no style change)', () => {
    for (let n = 0; n < 5; n++) expect(OW.placeLook(7, 'city', n)).toEqual({ seed: 11 + n * 17 });
    expect(OW.placeLook(undefined, 'city', 0)).toEqual({ seed: 11 });
    expect(OW.parkedPaintShift(7, 6)).toBe(0);
  });

  it('six projects\' maps: the first city\'s buildings are not all the same', () => {
    const seeds = IDS.map((id) => seedOf(gameWorldFileSource({ city: true, workspaceId: id })));
    const cities = seeds.map((s) => lotsOf(OW.placeLook(s, 'city', 0)));
    expect(new Set(cities).size).toBeGreaterThan(1);
    // A town or a village keeps its own style; only its lots vary.
    for (const s of seeds) expect(OW.placeLook(s, 'town', 1).style).toBeUndefined();
  });

  it('"add a shop street": the REAL kit world with one more place keeps its first city exactly as it was', async () => {
    const THREE = await import('three');
    const CH = await import(join(DIR, 'src/game/play/character.ts'));
    const g = globalThis as any; const hadWindow = 'window' in g; if (!hadWindow) g.window = {};
    try {
      const s = seedOf(gameWorldFileSource({ city: true, workspaceId: IDS[3] }));
      const small = { traffic: { count: 1 }, people: { count: 1 }, parkedCars: 0 };
      const firstCity = (regions: unknown[]) => {
        const scene = new THREE.Scene(); const player = new CH.CharacterController({}); scene.add(player.object);
        const ctx = { scene, player, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500), vehicles: { add: () => {}, seated: null } };
        const world = OW.createOpenWorld(ctx, { seed: s, regions });
        const city = world.city?.city ?? world.regions?.[0]?.city;
        const out = city ? JSON.stringify({ seed: city.plan.seed, style: city.plan.style, lots: city.plan.lots.length }) : null;
        world.dispose();
        return out;
      };
      const before = firstCity([{ id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } }]);
      const after = firstCity([{ id: 'main-city', kind: 'city', city: { blocksX: 2, blocksZ: 2, ...small } }, { id: 'shop-street', kind: 'village', city: small }]);
      expect(before).not.toBeNull();
      expect(after).toBe(before);
      expect(JSON.parse(before!).seed).toBe(OW.placeLook(s, 'city', 0).seed);
    } finally { if (!hadWindow) delete g.window; }
  }, 120_000);
});

// 🧬 ONE SEED RULE, NOT FOUR COPIES (reconciled with #4535, 2026-11-26). The player's starter look, the realistic outfit and
// the world seed each carried a private copy of the same sha256 pick; they now all call projectVariety.ts. The picks are
// byte-identical to the copies they replaced, so no existing project's hero, outfit or map changes.
describe('🧬 every per-project pick goes through projectVariety.ts', () => {
  it('the shared rule gives exactly what the replaced private copies gave (no existing game changes)', async () => {
    const { createHash } = await import('node:crypto');
    const { gamePlayerFileSource, GAME_PLAYER_FILE_VARIANTS } = await import('../src/server/lib/GamePlayerBodyGenerator');
    const { REALISTIC_HUMANS } = await import('../src/server/AgentV3/gameAssets/realisticHumans');
    const { varietySeed } = await import('../src/server/lib/projectVariety');
    const old = (facet: string, id: string) => createHash('sha256').update(facet + ':' + id).digest().readUInt32BE(0);
    for (const id of [...IDS, 'x', '']) {
      expect(gamePlayerFileSource(id)).toBe(GAME_PLAYER_FILE_VARIANTS[old('player', id) % GAME_PLAYER_FILE_VARIANTS.length]);
      expect(pickVariant(id, 'human', REALISTIC_HUMANS)).toBe(REALISTIC_HUMANS[old('human', id) % REALISTIC_HUMANS.length]);
      expect(varietySeed(id, 'world')).toBe(old('world', id) || 1);
      if (id) expect(seedOf(gameWorldFileSource({ workspaceId: id }))).toBe(old('world', id) || 1);
    }
    expect(new Set(IDS.map((id) => gamePlayerFileSource(id))).size).toBeGreaterThan(1);
    expect(new Set(IDS.map((id) => pickVariant(id, 'human', REALISTIC_HUMANS).id)).size).toBeGreaterThan(1);
  });

  it('census: no server file but projectVariety.ts hashes a facet and a project id by itself', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync("git grep -nE \"createHash\\('sha256'\\)\\.update\\('[a-z-]+:' *\\+\" -- 'src/server/**/*.ts' ':!*.test.ts' || true", { cwd: join(__dirname, '..'), encoding: 'utf8' })
      .split('\n').filter(Boolean);
    expect(hits, 'use pickVariant / varietySeed from src/server/lib/projectVariety.ts').toEqual([]);
  });
});
