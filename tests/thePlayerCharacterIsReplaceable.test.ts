// THE CHARACTER THE USER PLAYS AS CAN BE REPLACED AT ANY TIME (failedbr #2485, Q-3229; admin 2026-11-21: "yeh jo character
// isme banta hai, isko user jab chahe replace karwa de, text se ya game library se chun ke").
//
// 🧬 THE CLASS: the player's body was built inside the shell with one fixed look, and nothing in a game named it — so
// "change my character" meant rewriting the game around it. The body is ONE user-owned file now (src/game/player.ts):
// a look for the kit person, or a library model that takes its place. Runs the REAL generated kit headless.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { openWorldAppSource, GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH, GAME_PLAYER_BODY_PATH, OPEN_WORLD_STARTER_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { projectGrowthRules, GAME_PLAYER_RULE, GAME_PLAYER_FILE_PATH_IN_GAME } from '../src/server/AgentV3/gameKitSeed';
import { useAsCharacterPrompt, addToGamePrompt, mapPlaceRows, libraryBrowseRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { parseLibraryResponse } from '../src/components/agentv3/GameLibraryPicker';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const DIR = join(__dirname, `.tmp-player-${process.pid}`);
const pool = recipeFilePool();
/* eslint-disable @typescript-eslint/no-explicit-any */
let PB: any; let CH: any; let HU: any;
beforeAll(async () => {
  for (const [p, f] of pool) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  PB = await import(join(DIR, GAME_PLAYER_BODY_PATH));
  CH = await import(join(DIR, 'src/game/play/character.ts'));
  HU = await import(join(DIR, 'src/game/three/humanoid.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const game = () => {
  const player = new CH.CharacterController({});
  const hero = HU.createHumanoid({ height: 1.75 });
  player.object.add(hero.root);
  return { player, hero, ctx: { player, hero } };
};
/** A library model as the asset runtime hands it over: 3.5 m tall, its feet 0.5 m below its origin. */
const knight = () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 3.5, 1));
  mesh.position.y = 1.25;
  root.add(mesh);
  const played: string[] = [];
  return { played, handle: { root, source: 'model', update: vi.fn(), dispose: vi.fn(), play: (role: string) => { played.push(role); return role !== 'run'; } } };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('🧍 a library character takes the place of the kit person', () => {
  it('stands where the player stands, at a person\'s height, feet on the ground — and the kit person steps aside', async () => {
    const g = game(); const k = knight();
    const asked: string[] = [];
    const body = PB.applyPlayerChoice(g.ctx, { model: ' knight ' }, async () => ({ loadRequestedAsset: async (subject: string) => { asked.push(subject); return k.handle; } }));
    expect(body.showing).toBe('person');                       // never a missing player while the model loads
    await settle();
    expect(asked).toEqual(['knight']);
    expect(body.showing).toBe('model');
    expect(k.handle.root.parent).toBe(g.player.object);
    const box = new THREE.Box3().setFromObject(k.handle.root);
    expect(box.max.y - box.min.y).toBeCloseTo(1.75, 2);
    expect(box.min.y).toBeCloseTo(g.player.object.position.y, 2);
    expect(g.hero.root.scale.x).toBeLessThan(0.001);
  });

  it('faces the way the player faces, plays the clip the movement calls for, and falls back when a clip is missing', async () => {
    const g = game(); const k = knight();
    const body = PB.applyPlayerChoice(g.ctx, { model: 'knight' }, async () => ({ loadRequestedAsset: async () => k.handle }));
    await settle();
    g.hero.root.rotation.y = 1.2;
    body.update(0.016);
    expect(k.handle.root.rotation.y).toBeCloseTo(1.2);
    expect(k.handle.update).toHaveBeenCalledWith(0.016);
    expect(k.played.at(-1)).toBe(PB.locomotionRole(g.player.speed, g.player.isGrounded));
    expect(PB.locomotionRole(0, true)).toBe('idle');
    expect(PB.locomotionRole(2, true)).toBe('walk');
    expect(PB.locomotionRole(7, true)).toBe('run');
    expect(PB.locomotionRole(7, false)).toBe('jump');
  });

  it('a character the game does not have: the kit person stays, and the game says why', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const load of [
      async () => null,                                                                                  // the game has no saved models at all
      async () => ({ loadRequestedAsset: async (_s: string, fallback: () => unknown) => fallback() }),    // not one of them
      async () => { throw new Error('offline'); },
    ]) {
      const g = game();
      const body = PB.applyPlayerChoice(g.ctx, { model: 'dragon' }, load);
      await settle();
      expect(body.showing).toBe('person');
      expect(g.hero.root.scale.x).toBe(1);
      expect(g.player.object.children).toEqual([g.hero.root]);
    }
    expect(said.mock.calls.flat().join(' ')).toMatch(/dragon/);
    said.mockRestore();
  });

  it('no model asked: nothing is loaded; and taking the model away brings the person back', async () => {
    const g = game(); const load = vi.fn(async () => null);
    expect(PB.applyPlayerChoice(g.ctx, { look: { shirt: 0xff0000 }, model: null }, load).showing).toBe('person');
    expect(PB.applyPlayerChoice(g.ctx, undefined, load).showing).toBe('person');
    expect(load).not.toHaveBeenCalled();
    const k = knight();
    const body = PB.applyPlayerChoice(g.ctx, { model: 'knight' }, async () => ({ loadRequestedAsset: async () => k.handle }));
    await settle();
    body.dispose();
    expect(k.handle.root.parent).toBeNull();
    expect(g.hero.root.scale.x).toBe(1);
  });
});

describe('🎨 the look of the kit person', () => {
  it('the shell builds its hero from the game\'s own look, and the starter passes it through', () => {
    const shell = pool.get('src/game/Game.ts')!.content;
    expect(shell).toMatch(/playerLook\?: HumanoidOptions/);
    expect(shell).toMatch(/createHumanoid\(\{[^}]*\.\.\.\(options\.playerLook \|\| \{\}\)/);
    const starter = pool.get(OPEN_WORLD_STARTER_PATH)!.content;
    expect(starter).toMatch(/player\?\.look \? \{ playerLook: player\.look \}/);
    expect(starter).toMatch(/applyPlayerChoice\(ctx, player\)/);
    expect(starter).toMatch(/body\.current\?\.update\(delta\)/);
    const red = HU.createHumanoid({ height: 1.75, shirt: 0x2e5a87, ...{ shirt: 0xff0000, height: 2 } });
    const colours: number[] = [];
    red.root.traverse((o: any) => { if (o.material?.color) colours.push(o.material.color.getHex()); });
    expect(colours).toContain(0xff0000);
    expect(colours).not.toContain(0x2e5a87);
  });
});

describe('📄 one file is the character — the user\'s, written once', () => {
  it('the mounted game reads its player from src/game/player.ts', () => {
    const app = openWorldAppSource({ city: true });
    expect(app).toContain("import { PLAYER } from './game/player';");
    expect(app).toContain('player={PLAYER}');
    expect(GAME_PLAYER_FILE_PATH).toBe('src/game/player.ts');
    expect(GAME_PLAYER_FILE_PATH_IN_GAME).toBe(GAME_PLAYER_FILE_PATH);
    expect(GAME_PLAYER_FILE).toMatch(/export const PLAYER: PlayerChoice = \{[\s\S]*look:[\s\S]*model: null/);
    expect(pool.has(GAME_PLAYER_FILE_PATH)).toBe(false);          // never a kit file: a refresh must not reset the user's character
  });
  it('the mount creates it only when it is not there', () => {
    const src = read('src/server/AgentV3/ToolDispatcher.ts');
    const at = src.indexOf('GAME_PLAYER_FILE_PATH); cast = true;');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toMatch(/if \(!cast\) \{\s*const playerFile = await this\.guardedWrite\(GAME_PLAYER_FILE_PATH, GAME_PLAYER_FILE,/);
  });
  it('the builder is told where the character lives on every turn of a game that has the file — and never otherwise', () => {
    expect(projectGrowthRules({ [GAME_PLAYER_FILE_PATH]: GAME_PLAYER_FILE })).toContain(GAME_PLAYER_RULE);
    expect(projectGrowthRules({ 'src/App.tsx': 'x' })).not.toContain('player.ts');
    expect(GAME_PLAYER_RULE).toMatch(/PLAYER\.look/);
    expect(GAME_PLAYER_RULE).toMatch(/add_library_models/);
    expect(GAME_PLAYER_RULE).toMatch(/PLAYER\.model/);
  });
});

describe('📚 picking the character from the library', () => {
  it('every model can be asked for as the player, by its exact library id; a map place cannot', () => {
    const rows = libraryBrowseRows(undefined, () => false);
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows.slice(0, 40)) {
      const text = useAsCharacterPrompt(r)!;
      expect(text).toContain(`library id: "${r.id}"`);
      expect(text).toMatch(/player character/);
      expect(text).not.toBe(addToGamePrompt(r));
    }
    for (const place of mapPlaceRows()) expect(useAsCharacterPrompt(place)).toBeNull();
  });
  it('the route sends the instruction and the screen offers the choice', () => {
    expect(read('src/server/routes/agentv3.ts')).toMatch(/characterPrompts: Object\.fromEntries\(result\.rows\.flatMap\(\(r\) => \{ const text = useAsCharacterPrompt\(r\)/);
    const body = { enabled: true, rows: [], total: 0, categories: [], prompts: { a: 'add' }, characterPrompts: { a: 'be', b: 7 } };
    expect(parseLibraryResponse(body)?.characterPrompts).toEqual({ a: 'be' });
    expect(parseLibraryResponse({ ...body, characterPrompts: undefined })?.characterPrompts).toEqual({});   // an older server is not an error
    const picker = read('src/components/agentv3/GameLibraryPicker.tsx');
    expect(picker).toContain('Use as my character');
    expect(picker).toMatch(/use === 'character' \? data\.characterPrompts\[row\.id\] : data\.prompts\[row\.id\]/);
  });
});

describe('🔒 the character file is changed freely and never lost', () => {
  it('an edit is allowed on any turn; a deletion is put back; the mount keeps reading it', async () => {
    const { growthVerdict, growthProtectedPaths, lostMount } = await import('../src/server/AgentV3/growthGuard');
    const files = { 'src/App.tsx': openWorldAppSource({ city: true }), 'src/game/features/index.ts': 'export const FEATURES = [];', [GAME_PLAYER_FILE_PATH]: GAME_PLAYER_FILE };
    expect(growthProtectedPaths(files)).toContain(GAME_PLAYER_FILE_PATH);
    const ask = { path: GAME_PLAYER_FILE_PATH, before: GAME_PLAYER_FILE, request: 'add coins', platformWrote: null };
    expect(growthVerdict({ ...ask, after: GAME_PLAYER_FILE.replace('0x2e5a87', '0xff0000') }).allow).toBe(true);
    const gone = growthVerdict({ ...ask, after: null });
    expect(gone.allow).toBe(false);
    expect(gone.restore).toBe(GAME_PLAYER_FILE);
    expect(lostMount(files['src/App.tsx'], files['src/App.tsx'].replace(' player={PLAYER}', ''))).toEqual(['player={PLAYER}']);
    // A game mounted before the character file existed has nothing to lose.
    expect(lostMount(files['src/App.tsx'].replace(' player={PLAYER}', ''), files['src/App.tsx'].replace(' player={PLAYER}', ''))).toEqual([]);
  });
});
