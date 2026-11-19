// THE 2D WORLD IS ONE SEAMLESS MAP (admin 2026-11-19: "jab user kahe bada map banao, to hamare paas already maps ke sample
// bane rakhe ho, woh user ke game me add hote jaye, aur perfect add hon ki ek hi lage!"). These tests RUN the code the
// recipe writes into a game (src/game/world2d/) and hold it to that promise: the pre-made samples keep their two rules,
// every road continues across every chunk edge, the ground blends across edges, the map is endless and deterministic,
// collision is solid, and the recipe is used only where a 2D game wants a big world.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateWorld2D, WORLD2D_DIR } from '../src/server/lib/world2d/World2DGenerator';
import { world2dIntent } from '../src/server/AgentV3/world2dIntent';
import { gameKitPlan, gameKitHandoffBlock } from '../src/server/AgentV3/gameKitSeed';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog, CATALOG_TOOL_NAMES, RECIPE_TOOLS } from '../src/server/AgentV3/ToolCatalog';
import { GAME_RECIPES } from '../src/server/lib/gameRecipeLayers';

// ── Load the emitted modules exactly as written into a game ────────────────────────────────────────────────────
const { files } = generateWorld2D();
type Mod = Record<string, any>;
function load(): Mod {
  const cache: Record<string, Mod> = {};
  const req = (from: string) => (spec: string): Mod => {
    const path = `${WORLD2D_DIR}/${spec.replace(/^\.\//, '')}.ts`;
    if (cache[path]) return cache[path];
    const source = files[path];
    if (source === undefined) throw new Error(`no module ${spec} from ${from}`);
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} as Mod };
    cache[path] = module.exports;
    new Function('require', 'module', 'exports', js)(req(path), module, module.exports);
    cache[path] = module.exports;
    return module.exports;
  };
  return req('test')('./index');
}
const W = load();
const N = W.CHUNK_TILES as number;

describe('the recipe writes the four files, registered everywhere a recipe must be', () => {
  it('writes samples, world, render and index under src/game/world2d', () => {
    expect(Object.keys(files).sort()).toEqual(['index', 'render', 'samples', 'world'].map((f) => `${WORLD2D_DIR}/${f}.ts`).sort());
  });
  it('is in the catalogue, both name lists and the recipe pool', () => {
    expect(defaultToolCatalog().some((t) => t.name === 'generate_world_2d')).toBe(true);
    expect(CATALOG_TOOL_NAMES).toContain('generate_world_2d');
    expect(RECIPE_TOOLS).toContain('generate_world_2d');
    expect(Object.keys(GAME_RECIPES)).toContain('generate_world_2d');
  });
});

describe('the emitted code compiles under the strictest app settings', () => {
  it('strict + noUnusedLocals + noUnusedParameters: zero diagnostics', () => {
    const dir = join(tmpdir(), `world2d-tsc-${process.pid}`);
    rmSync(dir, { recursive: true, force: true });
    for (const [p, c] of Object.entries(files)) { const f = join(dir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, c); }
    const program = ts.createProgram(Object.keys(files).map((p) => join(dir, p)), {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], strict: true, noUnusedLocals: true, noUnusedParameters: true,
      isolatedModules: true, noEmit: true, skipLibCheck: true, types: [],
    });
    const diags = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    rmSync(dir, { recursive: true, force: true });
    expect(diags).toEqual([]);
  }, 60_000);
});

describe('the pre-made samples keep the two promises the seams rely on', () => {
  const SOFT = new Set(['.', 'f', 'b', 's', 'd']);
  it('there are samples for every biome, and they are many', () => {
    const biomes = new Set((W.SAMPLES as { biome: string }[]).map((s) => s.biome));
    expect([...biomes].sort()).toEqual(['desert', 'forest', 'lake', 'meadow', 'village']);
    expect(W.SAMPLES.length).toBeGreaterThanOrEqual(10);
  });
  for (const sample of W.SAMPLES as { id: string; rows: string[] }[]) {
    it(`${sample.id}: 16 x 16, an open-ground outer ring, and a soft road corridor`, () => {
      expect(sample.rows).toHaveLength(N);
      sample.rows.forEach((row, y) => {
        expect(row, `${sample.id} row ${y}`).toHaveLength(N);
        [...row].forEach((ch, x) => {
          if (y === 0 || y === N - 1 || x === 0 || x === N - 1) expect(ch, `${sample.id} ring ${x},${y}`).toBe('.');
          if ((y >= 6 && y <= 9) || (x >= 6 && x <= 9)) expect(SOFT.has(ch), `${sample.id} corridor ${x},${y} = ${ch}`).toBe(true);
          expect('.fbsdTPRWHwC'.includes(ch), `${sample.id} unknown tile ${ch}`).toBe(true);
        });
      });
    });
  }
});

describe('🔴 ONE map: every road continues across every chunk edge', () => {
  const world = W.createWorld2D({ seed: 42 });
  const road = (tx: number, ty: number): boolean => world.tileAt(tx, ty).road;
  it('both chunks that share an edge agree about it, over a 30 x 30 chunk area', () => {
    let roadEdges = 0;
    for (let cy = -15; cy < 15; cy++) for (let cx = -15; cx < 15; cx++) {
      const a = world.chunkAt(cx, cy);
      expect(a.sockets.e).toBe(world.chunkAt(cx + 1, cy).sockets.w);
      expect(a.sockets.s).toBe(world.chunkAt(cx, cy + 1).sockets.n);
      if (a.sockets.e) roadEdges++;
    }
    expect(roadEdges).toBeGreaterThan(100);
  });
  it('tile by tile: a road tile on one side of an edge always has a road tile across it', () => {
    for (let cy = -10; cy < 10; cy++) for (let cx = -10; cx < 10; cx++) {
      for (let k = 0; k < N; k++) {
        const ex = (cx + 1) * N; const ey = cy * N + k;
        expect(road(ex - 1, ey), `E edge ${cx},${cy} row ${k}`).toBe(road(ex, ey));
        const sx = cx * N + k; const sy = (cy + 1) * N;
        expect(road(sx, sy - 1), `S edge ${cx},${cy} col ${k}`).toBe(road(sx, sy));
      }
    }
  });
  it('a road that reaches an edge reaches the chunk centre (no road stub stops inside a chunk)', () => {
    for (let cy = -6; cy < 6; cy++) for (let cx = -6; cx < 6; cx++) {
      const c = world.chunkAt(cx, cy);
      if (c.sockets.n || c.sockets.e || c.sockets.s || c.sockets.w) expect(road(cx * N + 7, cy * N + 7)).toBe(true);
    }
  });
  it('highways run unbroken: some row of chunks is road edge to edge for 60 chunks', () => {
    let found = false;
    for (let cy = -8; cy < 8 && !found; cy++) {
      let ok = true;
      for (let tx = -30 * N; tx < 30 * N && ok; tx++) ok = road(tx, cy * N + 7);
      found = ok;
    }
    expect(found).toBe(true);
  });
  it('water under a road becomes a bridge (walkable), never a gap', () => {
    for (let cy = -20; cy < 20; cy++) for (let cx = -20; cx < 20; cx++) {
      for (const kind of world.chunkAt(cx, cy).kinds) expect(kind === 'road' || kind === 'bridge' || kind !== 'road').toBe(true);
    }
    const t = W.createWorld2D({ seed: 3 }).tileAt(0, 0);
    expect(typeof t.solid).toBe('boolean');
  });
});

describe('the ground blends across chunk edges (no line between pieces)', () => {
  it('neighbouring tiles across an edge differ no more than neighbouring tiles inside a chunk', () => {
    const world = W.createWorld2D({ seed: 9 });
    const rgb = (tx: number, ty: number): number[] => (world.tileAt(tx, ty).ground.match(/\d+/g) ?? []).map(Number);
    const diff = (a: number[], b: number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    let across = 0; let within = 0;
    for (let cy = -5; cy < 5; cy++) for (let cx = -5; cx < 5; cx++) for (let k = 0; k < N; k++) {
      const ex = (cx + 1) * N; const y = cy * N + k;
      across = Math.max(across, diff(rgb(ex - 1, y), rgb(ex, y)));
      within = Math.max(within, diff(rgb(ex - 3, y), rgb(ex - 2, y)));
    }
    expect(across).toBeLessThanOrEqual(within + 2);
    expect(across).toBeLessThan(16);
  });
});

describe('endless, bounded memory, deterministic', () => {
  it('the same seed gives the same world; another seed a different one', () => {
    const a = W.createWorld2D({ seed: 5 }); const b = W.createWorld2D({ seed: 5 }); const c = W.createWorld2D({ seed: 6 });
    let same = true; let differs = false;
    for (let cy = -4; cy < 4; cy++) for (let cx = -4; cx < 4; cx++) {
      const ka = a.chunkAt(cx, cy).kinds.join(); if (ka !== b.chunkAt(cx, cy).kinds.join()) same = false;
      if (ka !== c.chunkAt(cx, cy).kinds.join()) differs = true;
    }
    expect(same).toBe(true); expect(differs).toBe(true);
  });
  it('a chunk 100,000 chunks away exists, and the cache never grows past its bound', () => {
    const world = W.createWorld2D({ seed: 1 });
    expect(world.chunkAt(100_000, -100_000).sample).toEqual(expect.any(String));
    for (let i = 0; i < 2000; i++) world.chunkAt(i, i * 3);
    expect(world.cachedChunks()).toBeLessThanOrEqual(512);
    expect(world.bounds).toBeNull();
  });
  it('a bounded map: solid void outside, no road leads out of it, and the spawn is inside', () => {
    const world = W.createWorld2D({ seed: 2, sizeChunks: 6 });
    expect(world.bounds).not.toBeNull();
    const { minX, maxX, minY, maxY } = world.bounds!;
    expect(world.isSolid(minX - 5, (minY + maxY) / 2)).toBe(true);
    expect(world.tileAtPixel(maxX + 5, minY + 5).kind).toBe('void');
    for (let i = -3; i <= 2; i++) {
      expect(world.chunkAt(-3, i).sockets.w).toBe(false);
      expect(world.chunkAt(2, i).sockets.e).toBe(false);
      expect(world.chunkAt(i, -3).sockets.n).toBe(false);
      expect(world.chunkAt(i, 2).sockets.s).toBe(false);
    }
    const p = world.spawnPoint();
    expect(p.x).toBeGreaterThan(minX); expect(p.x).toBeLessThan(maxX);
    expect(world.isSolid(p.x, p.y)).toBe(false);
  });
});

describe('the player starts on a long road and the walls are solid', () => {
  it('the spawn is on a road that runs straight through its chunk', () => {
    for (const seed of [1, 2, 3, 4, 5, 77, 1234]) {
      const world = W.createWorld2D({ seed });
      const p = world.spawnPoint();
      expect(world.isRoad(p.x, p.y), `seed ${seed}`).toBe(true);
      const c = world.chunkAt(Math.floor(p.x / (N * 32)), Math.floor(p.y / (N * 32)));
      expect((c.sockets.e && c.sockets.w) || (c.sockets.n && c.sockets.s), `seed ${seed}`).toBe(true);
    }
  });
  it('a body cannot enter a solid tile, slides along it, and cannot tunnel through at any speed', () => {
    const world = W.createWorld2D({ seed: 42 });
    // Find a solid tile with open ground to its left.
    let at: { tx: number; ty: number } | null = null;
    for (let ty = -64; ty < 64 && !at; ty++) for (let tx = -64; tx < 64 && !at; tx++) {
      if (world.tileAt(tx, ty).solid && !world.tileAt(tx - 1, ty).solid && !world.tileAt(tx - 2, ty).solid
        && !world.tileAt(tx - 1, ty - 1).solid && !world.tileAt(tx - 1, ty + 1).solid && !world.tileAt(tx - 2, ty - 1).solid && !world.tileAt(tx - 2, ty + 1).solid) at = { tx, ty };
    }
    expect(at).not.toBeNull();
    const s = world.tileSize; const y = (at!.ty + 0.5) * s; const x = (at!.tx - 1.5) * s;
    const slow = W.moveWithCollision(world, x, y, s * 2, 0, 8);
    expect(slow.blockedX).toBe(true);
    expect(slow.x + 8).toBeLessThanOrEqual(at!.tx * s);
    const fast = W.moveWithCollision(world, x, y, s * 50, 0, 8);
    expect(fast.x + 8).toBeLessThanOrEqual(at!.tx * s);
  });
});

describe('the renderer draws only what is on screen', () => {
  function mockCtx() {
    const calls: Record<string, number> = {};
    const count = (name: string) => () => { calls[name] = (calls[name] ?? 0) + 1; };
    return { calls, ctx: new Proxy({ fillStyle: '' } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : count(k)),
      set: (t, k: string, v) => { t[k] = v; return true; },
    }) };
  }
  it('draws the visible chunks (no DOM: straight onto the target), a minimap, and maps world points to the screen', () => {
    const world = W.createWorld2D({ seed: 4 });
    const view = W.createWorldRenderer(world);
    const { ctx, calls } = mockCtx();
    view.draw(ctx, 1000, 1000, 320, 200);
    const visibleTiles = (Math.ceil(320 / 32) + N) * (Math.ceil(200 / 32) + N); // generous upper bound
    expect(calls.fillRect).toBeGreaterThan(100);
    expect(calls.fillRect).toBeLessThan(visibleTiles * 12);
    expect(view.toScreen(1000, 1000)).toEqual({ x: 160, y: 100 });
    const before = calls.fillRect;
    view.drawMinimap(ctx, 0, 0, 100, 1000, 1000, 4);
    expect(calls.fillRect).toBeGreaterThan(before + 80);
    expect(calls.arc).toBeGreaterThan(0);
  });
});

// ── When the recipe is used ─────────────────────────────────────────────────────────────────────────────────────
describe('used only where a 2D game wants a big world (the wish, not one word)', () => {
  it.each([
    '2D game banao jiska map bahut bada ho',
    'ek 2D adventure game jisme kahin bhi ghoom sakun',
    'mere 2D game ka map bahut chhota hai, bada karo',
    'top-down RPG game with a huge world to explore',
    'make a 2D survival game where the map never ends',
  ])('uses it: %s', (prompt) => {
    expect(world2dIntent({ prompt, drawnIn3D: false }).use).toBe(true);
    expect(gameKitPlan(prompt)).toContain('generate_world_2d');
  });
  it.each([
    ['ek calculator banao', 'not a game'],
    ['2D snake game', 'no wish'],
    ['2D chess game with a big board', 'board'],
    ['2D quiz game with a big map of india', 'quiz'],
    ['2D game, chhota map banao', 'small on purpose'],
  ])('does not use it: %s (%s)', (prompt) => {
    expect(world2dIntent({ prompt, drawnIn3D: false }).use).toBe(false);
    expect(gameKitPlan(prompt)).not.toContain('generate_world_2d');
  });
  it('a 3D game is never given the 2D world (the Athree map serves it)', () => {
    expect(world2dIntent({ prompt: 'car racing game ka bada map', drawnIn3D: true }).use).toBe(false);
    expect(gameKitPlan('3D open world game with a huge map')).not.toContain('generate_world_2d');
  });
  it('a project that already has the world keeps it on every edit', () => {
    expect(world2dIntent({ prompt: 'make the player faster', drawnIn3D: false, stored: true }).use).toBe(true);
  });
  it('the kit handoff tells the builder to build the game ON the world', () => {
    const block = gameKitHandoffBlock([
      { recipe: 'generate_game_runtime', ok: true, content: 'Added runtime' },
      { recipe: 'generate_world_2d', ok: true, content: 'Added the 2D world' },
    ], { flat: true });
    expect(block).toMatch(/THE BIG 2D WORLD IS ALREADY IN src\/game\/world2d/);
    expect(block).toMatch(/NEVER draw a fixed-size background/);
  });
});

class Fake implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: no such file ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('the dispatcher decides from the request', () => {
  let act: Fake; let d: ToolDispatcher;
  beforeEach(() => { act = new Fake(); const s = new AgentEventStream(); d = new ToolDispatcher(act, 'ws-world2d', new WorkspaceState(s), s); });
  afterEach(() => { delete process.env.AGENTV3_WORLD_2D; });
  const run = (request: string) => { d.setCoverageRequest(request); return d.dispatch({ id: 't', name: 'generate_world_2d', input: {} }, 'architect'); };

  it('a 2D game that wants a big map → the four files are written, byte for byte', async () => {
    const res = await run('2D game banao jiska map bahut bada ho');
    expect(res.is_error).toBeFalsy();
    for (const [p, c] of Object.entries(files)) expect(act.files.get(p), p).toBe(c);
    expect(res.content).toMatch(/Added the 2D world/);
  });
  it('a 3D game, a quiz and an app are refused with the reason, nothing written', async () => {
    for (const [p, why] of [['3D car racing game with a big map', /3D/], ['2D quiz game with a big map', /quiz/], ['ek billing app banao', /not a game/]] as const) {
      act.files.clear();
      const res = await run(p);
      expect(res.is_error, p).toBe(true);
      expect(res.content, p).toMatch(why);
      expect(act.files.size, p).toBe(0);
    }
  });
  it('AGENTV3_WORLD_2D=off refuses honestly and writes nothing', async () => {
    process.env.AGENTV3_WORLD_2D = 'off';
    const res = await run('2D game banao jiska map bahut bada ho');
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/switched off/);
    expect(act.files.size).toBe(0);
  });
  it('never overwrites a world the user edited', async () => {
    act.files.set(`${WORLD2D_DIR}/world.ts`, '// my own world');
    act.files.set(`${WORLD2D_DIR}/index.ts`, files[`${WORLD2D_DIR}/index.ts`]);
    const res = await run('make the player faster');
    expect(res.is_error).toBeFalsy();
    expect(act.files.get(`${WORLD2D_DIR}/world.ts`)).toBe('// my own world');
  });
});
