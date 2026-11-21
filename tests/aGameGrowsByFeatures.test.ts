// A GAME GROWS FROM ONE THING TO A HUNDRED WITHOUT BREAKING (admin 2026-11-21: "sirf 2 hisse nahi — user jo chahe game me
// judwaye, usi game me judta chala jaye, kuch bhi tute na … 10-100 kitne bhi judwa sakta hai user, navbharatai isko easily
// handle kare").
//
// 🧬 THE CLASS: a game that is one big setup() is rewritten on every request, and each rewrite can break what worked. The
// kit now makes a game a LIST of features: one file and one line per thing, each run inside its own guard. This runs the
// REAL generated host: a hundred features, one that throws, features that build on each other — and the rule the builder is
// handed on every later turn of such a game.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { generateOpenWorld, openWorldAppSource, GAME_FEATURES_INDEX, GAME_FEATURES_INDEX_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { gameTurnHandoff, GAME_FEATURES_RULE, GAME_FEATURES_INDEX_FILE, OPEN_WORLD_HANDOFF } from '../src/server/AgentV3/gameKitSeed';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DIR = join(__dirname, `.tmp-features-${process.pid}`);
/* eslint-disable @typescript-eslint/no-explicit-any */
let F: any;
beforeAll(async () => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  F = await import(join(DIR, 'src/game/play/features.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const ctx = {} as any;

describe('🧩 the feature host', () => {
  it('a hundred features: each set up once, each updated every step, in the order listed', () => {
    const calls: string[] = [];
    const features = Array.from({ length: 100 }, (_, i) => F.defineFeature({ id: `f${i}`, setup: () => { calls.push(`s${i}`); }, update: () => { calls.push(`u${i}`); } }));
    const host = F.createFeatureHost(features);
    host.setup(ctx, null);
    host.update(ctx, null, 1 / 60); host.update(ctx, null, 1 / 60);
    expect(calls.slice(0, 100)).toEqual(features.map((_, i) => `s${i}`));
    expect(calls.filter((c) => c === 'u57')).toHaveLength(2);
    expect(host.status().every((s: any) => s.state === 'on')).toBe(true);
  });

  it('🔴 one feature that throws is switched off and NAMED — the other ninety-nine keep running', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ran = 0;
    const good = Array.from({ length: 99 }, (_, i) => F.defineFeature({ id: `ok${i}`, update: () => { ran++; } }));
    const bad = F.defineFeature({ id: 'police', update: () => { throw new Error('car is undefined'); } });
    const host = F.createFeatureHost([...good.slice(0, 50), bad, ...good.slice(50)]);
    host.setup(ctx, null);
    for (let i = 0; i < 10; i++) host.update(ctx, null, 1 / 60);
    expect(ran).toBe(990);                                                   // nobody else lost a step
    expect(host.status().find((s: any) => s.id === 'police')).toEqual({ id: 'police', state: 'off', reason: 'update: car is undefined' });
    const said = errors.mock.calls.map((c) => String(c[0]));
    expect(said.filter((m) => m.startsWith('[feature police] switched off'))).toHaveLength(1);   // once, not sixty times a second
    errors.mockRestore();
  });

  it('a feature that throws while being set up never starts, and the game still starts', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    const host = F.createFeatureHost([{ id: 'rain', setup: () => { throw new Error('no sky'); }, update: after }, { id: 'coins', update: after }]);
    expect(() => host.setup(ctx, null)).not.toThrow();
    host.update(ctx, null, 1 / 60);
    expect(after).toHaveBeenCalledTimes(1);                                  // coins only
    errors.mockRestore();
  });

  it('features build on each other: needs orders them, shares a value, and a broken base switches its dependants off too', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const order: string[] = [];
    const shop = { id: 'shop', needs: ['coins'], setup: (_c: any, _w: any, api: any) => { order.push('shop'); return { wallet: api.get('coins') }; } };
    const coins = { id: 'coins', setup: () => { order.push('coins'); return { count: 5 }; } };
    const host = F.createFeatureHost([shop, coins]);                           // listed the wrong way round on purpose
    host.setup(ctx, null);
    expect(order).toEqual(['coins', 'shop']);
    // A base that fails takes only its dependants with it, and each says why.
    const host2 = F.createFeatureHost([{ id: 'coins', setup: () => { throw new Error('x'); } }, { id: 'shop', needs: ['coins'] }, { id: 'weather' }, { id: 'ghost', needs: ['nothing-here'] }]);
    host2.setup(ctx, null);
    const st = Object.fromEntries(host2.status().map((s: any) => [s.id, s.state]));
    expect(st).toEqual({ coins: 'off', shop: 'off', weather: 'on', ghost: 'off' });
    expect(host2.status().find((s: any) => s.id === 'shop').reason).toMatch(/needs "coins"/);
    errors.mockRestore();
  });

  it('the same id twice: the second is ignored, never run twice', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn();
    const host = F.createFeatureHost([{ id: 'coins', setup: run }, { id: 'coins', setup: run }]);
    host.setup(ctx, null);
    expect(run).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('any game on <GameCanvas> can grow the same way: withFeatures keeps its own setup and update', () => {
    const own = { setup: vi.fn(() => ['collider']), update: vi.fn() };
    const feature = { id: 'coins', setup: vi.fn(), update: vi.fn() };
    const options = F.withFeatures(own, [feature]);
    expect(options.setup(ctx)).toEqual(['collider']);
    options.update(ctx, 1 / 60);
    expect(own.update).toHaveBeenCalledTimes(1);
    expect(feature.setup).toHaveBeenCalledTimes(1);
    expect(feature.update).toHaveBeenCalledTimes(1);
  });
});

describe('🧩 where it ships, and what the builder is told', () => {
  it('every game on the shell has the host; the open-world game is mounted with its list', () => {
    expect(Object.keys(generateGameShell().files)).toContain('src/game/play/features.ts');
    expect(Object.keys(generateGameShell(['gamecanvas']).files)).toContain('src/game/play/features.ts');
    expect(openWorldAppSource({ city: true })).toContain("import { FEATURES } from './game/features';");
    expect(openWorldAppSource({ city: true })).toContain('features={FEATURES}');
    expect(GAME_FEATURES_INDEX_PATH).toBe(GAME_FEATURES_INDEX_FILE);
    expect(GAME_FEATURES_INDEX).toContain('export const FEATURES: GameFeature<OpenWorld>[] = [');
    expect(generateOpenWorld().files['src/game/OpenWorldGame.tsx']).toMatch(/host\.current\?\.update\(ctx, world\.current, delta\)/);
    // The list is the user's file: created once on mount, never replaced.
    const dispatcher = read('src/server/AgentV3/ToolDispatcher.ts');
    expect(dispatcher).toMatch(/if \(!listed\) \{\s*const index = await this\.guardedWrite\(GAME_FEATURES_INDEX_PATH, GAME_FEATURES_INDEX, \{ agent, source: 'generate_open_world' \}\);/);
  });

  it('the rule is said on the first build, and on EVERY later turn of a game that has the list — whatever the turn says', () => {
    expect(OPEN_WORLD_HANDOFF).toContain(GAME_FEATURES_RULE);
    expect(GAME_FEATURES_RULE).toMatch(/create ONE new feature file and add ONE line/);
    expect(GAME_FEATURES_RULE).toMatch(/NEVER rewrite, merge or move the other features/);
    const project = { [GAME_FEATURES_INDEX_FILE]: GAME_FEATURES_INDEX };
    const turn = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
    // "police bhi daalo" names no game — the project's own list decides.
    expect(gameTurnHandoff('police bhi daalo jo player ka peecha kare', project, turn, {} as NodeJS.ProcessEnv).block).toContain(GAME_FEATURES_RULE);
    expect(gameTurnHandoff('add coins to collect', project, turn, {} as NodeJS.ProcessEnv).block).toContain(GAME_FEATURES_RULE);
    // A project without the list, and a turn that writes nothing, hear nothing.
    expect(gameTurnHandoff('add a login page', {}, turn, {} as NodeJS.ProcessEnv).block).toBe('');
    expect(gameTurnHandoff('police bhi daalo', project, { ...turn, writingRun: false }, {} as NodeJS.ProcessEnv).block).toBe('');
  });
});
