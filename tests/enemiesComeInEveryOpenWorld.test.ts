/**
 * ENEMIES COME IN EVERY OPEN WORLD — HOWEVER THE USER ASKS, ON WHATEVER TURN (admin 2026-11-26: "kitna bhi prompt de! par
 * open world game me enemy ban hi nahi rahe hai, hero par attack karne ke liye enemy aye, fire kare, punch kare").
 *
 * The causes found in the code and in failedbr #2510–#2532, each closed here:
 *   1. The game kit enemies run on (Entities, combat, police) was laid only on a NEW build — an "enemy banao" EDIT turn on an
 *      existing open world got nothing and left it all to the model (#2510, #2514, #2518/#2519). → enemiesAtTurnStart lays
 *      the kit, writes streetDanger.ts and lists it, itself.
 *   2. An `async setup()` feature handed the host a Promise; its update() ran before the monsters existed, and they stood
 *      still (#2531). → the feature host waits for an async setup.
 *   3. A feature that threw was switched off with one console line — no report, no reason (all of them). → the playtest reads
 *      the switched-off features and records GAME_FEATURE_OFF with the reason.
 *   4. Street enemies only punched, one arrived every 6 s, and the hero's gun did not hurt them. → the street fills on the
 *      first frame, some enemies fire (tracer, flash, sound), and the hero's own shot hits the enemy in front.
 * (Placing asked-for enemies near the hero, the on-screen enemy check and the repair that broke a clean file are #4560's.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_FEATURES_INDEX, GAME_FEATURES_INDEX_PATH, GAME_STREET_DANGER_FEATURE, GAME_STREET_DANGER_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { enemiesAtTurnStart, withStreetDangerListed, ownEnemyFeature, ENTITIES_FILE, DISPATCH_FILE, OPEN_WORLD_KIT_FILE } from '../src/server/AgentV3/buildPhases/enemiesTurn';
import { reportFeaturesOff } from '../src/server/AgentV3/buildPhases/gameRuleProbes';
import { parseFeatureList } from '../src/server/AgentV3/growthGuard';
import { buildFindingSuggestions } from '../src/server/AgentV3/buildFindingSuggestions';

const SAID = 'kitna bhi prompt de! par open world game me enemy ban hi nahi rahe hai, hero par attack karne ke liye enemy aye, fire kare, punch kare';
const OWN_INDEX = "import type { GameFeature } from '../play/features';\nimport type { OpenWorld } from '../play/openWorld';\nimport coins from './coins';\n\nexport const FEATURES: GameFeature<OpenWorld>[] = [\n  coins,\n];\n";

/** An existing open world on the platform, before this turn — the kit's systems not laid (the #2514 project). */
function project(extra: Record<string, string> = {}): Record<string, string> {
  return { [GAME_FEATURES_INDEX_PATH]: OWN_INDEX, [OPEN_WORLD_KIT_FILE]: '// the open world kit', 'src/game/features/coins.ts': 'export default {}', ...extra };
}
function sandbox(files: Record<string, string>, recipeWorks = true) {
  const disk = new Map(Object.entries(files));
  const recipes: string[] = []; const issues: Array<{ code: string }> = [];
  const io = {
    prompt: SAID, filesAtTurnStart: { ...files },
    read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
    write: async (p: string, c: string) => { disk.set(p, c); },
    runRecipe: async (name: string) => { recipes.push(name); if (recipeWorks) { disk.set(ENTITIES_FILE, '// kit'); disk.set(DISPATCH_FILE, '// kit'); } return recipeWorks; },
    record: (i: { code: string }) => issues.push(i),
  };
  return { io, disk, recipes, issues };
}

describe('🔴 1 · "enemy banao" on an open world that already exists', () => {
  it('the admin\'s own sentence: the kit is laid, street danger is written and LISTED, and the builder is told it is done', async () => {
    const s = sandbox(project());
    const note = await enemiesAtTurnStart(s.io);
    expect(s.recipes).toEqual(['generate_game_systems']);
    expect(s.disk.get(GAME_STREET_DANGER_PATH)).toBe(GAME_STREET_DANGER_FEATURE);
    const list = parseFeatureList(s.disk.get(GAME_FEATURES_INDEX_PATH)!)!;
    expect(list.listed).toEqual(['streetDanger', 'coins']);
    expect(s.disk.get(GAME_FEATURES_INDEX_PATH)).toContain("import streetDanger from './streetDanger';");
    expect(s.issues.map((i) => i.code)).toEqual(['ENEMIES_ADDED']);
    expect(note).toMatch(/ALREADY DONE BY THE PLATFORM[\s\S]*Do NOT write another enemy system/);
  });
  it('the kit already there: no recipe runs again', async () => {
    const s = sandbox(project({ [ENTITIES_FILE]: '// kit', [DISPATCH_FILE]: '// kit' }));
    await enemiesAtTurnStart(s.io);
    expect(s.recipes).toEqual([]);
    expect(s.disk.has(GAME_STREET_DANGER_PATH)).toBe(true);
  });
  it('never a second set: street danger already there, or a feature of the user\'s own that spawns hostile people', async () => {
    const a = sandbox(project({ [GAME_STREET_DANGER_PATH]: GAME_STREET_DANGER_FEATURE }));
    expect(await enemiesAtTurnStart(a.io)).toMatch(/already has its enemies[\s\S]*change THAT file/);
    expect(a.disk.get(GAME_FEATURES_INDEX_PATH)).toBe(OWN_INDEX);
    const mine = project({ 'src/game/features/monsters.ts': "const npcs = new Entities(ctx); npcs.spawnAround(4, { hostile: true });" });
    expect(ownEnemyFeature(mine)).toBe('src/game/features/monsters.ts');
    const b = sandbox(mine);
    expect(await enemiesAtTurnStart(b.io)).toMatch(/src\/game\/features\/monsters\.ts\. Make THAT one work/);
    expect(b.disk.has(GAME_STREET_DANGER_PATH)).toBe(false);
  });
  it('the kit cannot be laid: nothing is pretended — a warning, and the builder tells the user', async () => {
    const s = sandbox(project(), false);
    expect(await enemiesAtTurnStart(s.io)).toMatch(/Tell the user plainly that the enemies were not added/);
    expect(s.issues.map((i) => i.code)).toEqual(['ENEMIES_KIT_NOT_LAID']);
    expect(s.disk.has(GAME_STREET_DANGER_PATH)).toBe(false);
  });
  it('only where it belongs: no enemy words, a game that is not an open world, an import turn', async () => {
    expect(await enemiesAtTurnStart({ ...sandbox(project()).io, prompt: 'make the city bigger' })).toBe('');
    expect(await enemiesAtTurnStart({ ...sandbox({ 'src/App.tsx': 'x' }).io })).toBe('');
    expect(await enemiesAtTurnStart({ ...sandbox(project()).io, skip: true })).toBe('');
    expect(await enemiesAtTurnStart({ ...sandbox(project()).io, prompt: 'no enemies please, a calm walk' })).toBe('');
  });
  it('the list helper: the platform\'s empty list, idempotent, and an unknown shape is refused', () => {
    const once = withStreetDangerListed(GAME_FEATURES_INDEX)!;
    expect(parseFeatureList(once)!.listed).toEqual(['streetDanger']);
    expect(withStreetDangerListed(once)).toBe(once);
    expect(withStreetDangerListed('export default []')).toBeNull();
  });
  it('🔒 the route runs it at the start of every turn, its writes counted as the platform\'s', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/buildPrompt = withPlatformHandoff\(await enemiesAtTurnStart\(\{ skip: isImportTurn \|\| !!projectModuleRef, prompt, filesAtTurnStart: projectFilesAtTurnStart,[\s\S]{0,400}?preseededGolden\.set\(p, c\);[\s\S]{0,300}?name: 'run_recipe', input: \{ name \}/);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-enemies-${process.pid}`);
let F: any;
beforeAll(async () => {
  const g = globalThis as any;
  g.window ??= { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  F = await import(join(DIR, 'src/game/play/features.ts'));
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('🔴 2 · an async setup() is waited for (#2531: the monsters stood still)', () => {
  it('update runs only once the setup has finished; its value is shared; a feature that needs it waits for it', async () => {
    let release!: (v: unknown) => void;
    const seen: string[] = [];
    const monsters = { id: 'monsters', setup: () => new Promise((r) => { release = r; }), update: () => { seen.push('monsters'); } };
    const boss = { id: 'boss', needs: ['monsters'], setup: (_c: unknown, _w: unknown, api: any) => { seen.push('boss saw ' + JSON.stringify(api.get('monsters'))); }, update: () => { seen.push('boss'); } };
    const host = F.createFeatureHost([monsters, boss]);
    host.setup({}, undefined);
    host.update({}, undefined, 0.016);
    expect(seen).toEqual([]);                                            // nothing ran before the monsters existed
    expect(host.status().every((s: any) => s.state === 'on')).toBe(true);  // waiting is not "off"
    release({ count: 4 });
    await tick();
    host.update({}, undefined, 0.016);
    expect(seen).toEqual(['boss saw {"count":4}', 'monsters', 'boss']);
    host.dispose();
  });
  it('a rejected async setup is switched off WITH its reason, and listed for the playtest', async () => {
    const bad = { id: 'monsters', setup: async () => { throw new Error('world.scene is undefined'); } };
    const host = F.createFeatureHost([bad]);
    host.setup({}, undefined);
    await tick();
    expect(host.status()).toEqual([{ id: 'monsters', state: 'off', reason: 'setup: world.scene is undefined' }]);
    const read = ((globalThis as any).window.__nbFeatureHosts as Array<() => any[]>).flatMap((f) => f()).filter((x) => x.state === 'off');
    expect(read).toEqual([{ id: 'monsters', state: 'off', reason: 'setup: world.scene is undefined' }]);
    host.dispose();
    expect(((globalThis as any).window.__nbFeatureHosts as unknown[]).length).toBe(0);
  });
  it('an async setup that finishes after the game is gone is disposed, never started', async () => {
    let release!: (v: unknown) => void; let disposed = 0;
    const host = F.createFeatureHost([{ id: 'late', setup: () => new Promise((r) => { release = r; }), dispose: () => { disposed++; } }]);
    host.setup({}, undefined); host.dispose(); release(1); await tick();
    expect(disposed).toBe(1);
  });
});

describe('🔴 3 · a switched-off feature reaches the report', () => {
  it('GAME_FEATURE_OFF names each one with its reason, and has a one-tap fix', () => {
    const recorded: any[] = [];
    expect(reportFeaturesOff([{ id: 'monsters', reason: "update: Cannot read properties of undefined (reading 'position')" }], { record: (i) => recorded.push(i), say: () => undefined })).toBe('GAME_FEATURE_OFF');
    expect(recorded[0]).toMatchObject({ severity: 'warning', code: 'GAME_FEATURE_OFF', autoResolved: false });
    expect(recorded[0].message).toMatch(/"monsters" \(update: Cannot read properties of undefined/);
    expect(reportFeaturesOff([], { record: () => { throw new Error('no'); }, say: () => undefined })).toBeNull();
    expect(buildFindingSuggestions([{ code: 'GAME_FEATURE_OFF', message: recorded[0].message, severity: 'warning' } as any])[0]?.title).toBe('Fix the part of the game that switched off');
  });
  it('🔒 the playtest reads window.__nbFeatureHosts and the phase reports it', () => {
    const play = readFileSync(join(__dirname, '../src/server/AgentV3/gamePlaytest.ts'), 'utf8');
    expect(play).toMatch(/out\.featuresOff = await page\.evaluate\(\(\) => \(window\.__nbFeatureHosts \|\| \[\]\)/);
    expect(readFileSync(join(__dirname, '../src/server/AgentV3/buildPhases/gamePlaytestPhase.ts'), 'utf8')).toContain('reportFeaturesOff(playRun.featuresOff, p.fix);');
  });
});

describe('🔴 4 · street enemies fight like the user asked: punch AND fire, from the first second', () => {
  it('the street fills on the first frame; gunmen are ranged and their shots are seen and heard; the hero\'s gun hits', () => {
    const f = GAME_STREET_DANGER_FEATURE;
    expect(f).toMatch(/if \(!filled\) \{\s*filled = true;\s*for \(let i = 0; i < STREET_DANGER\.enemies; i\+\+\) bring\('enemy'\);/);
    expect(f).toMatch(/ai: armed \? 'ranged' :/);
    expect(f).toMatch(/events\.on\('ENTITY_ATTACKED'[\s\S]{0,500}?tracerOf\(e\)[\s\S]{0,300}?events\.emit\('WEAPON_FIRED', \{[\s\S]{0,140}?ownerId: e\.id \}\)/);
    expect(f).toMatch(/events\.on\('WEAPON_FIRED', \(p[^)]*\) => \{\s*if \(p && p\.ownerId !== undefined && p\.ownerId !== 'player'\) return;[\s\S]{0,300}?npcs\.melee\([^)]*STREET_DANGER\.playerShot, \{ range: STREET_DANGER\.gunRange/);
  });
});
