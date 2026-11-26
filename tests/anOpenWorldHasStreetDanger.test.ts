/**
 * Admin 2026-11-25 (problem 4): "enemy nahi ban rahe hai, na enemy hero ko marne ke liye ate, na police car ati hai hero ko pakadne.
 * matlab jitna kam aapne kar diya hai, bas wahi templet rattu tote ki tarah sabhi game me suna diya jata hai." — and: "user ke words
 * par nahi intention par kam ho".
 *
 * The kit had enemies that chase and attack (systems/entities.ts) and a wanted level with police cars (systems/dispatch.ts), but a
 * GTA-style request never got the systems kit (the title implies no feature and the genre read "rpg"), and the open-world starter
 * created no enemies or police even when it did. An on-foot city world is an action game by nature: it gets the fight unless the
 * user asks for a peaceful one, and the platform writes the first feature — streetDanger.ts — that really spawns them (Q-3521).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_STREET_DANGER_FEATURE, GAME_STREET_DANGER_PATH, GAME_FEATURES_INDEX_WITH_DANGER, GAME_FEATURES_INDEX_PATH, GAME_OPEN_WORLD_BRIDGE } from '../src/server/lib/GameOpenWorldGenerator';

const DIR = join(__dirname, `.tmp-danger-${process.pid}`);
beforeAll(() => {
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  mkdirSync(dirname(join(DIR, GAME_STREET_DANGER_PATH)), { recursive: true });
  writeFileSync(join(DIR, GAME_STREET_DANGER_PATH), GAME_STREET_DANGER_FEATURE);
  writeFileSync(join(DIR, GAME_FEATURES_INDEX_PATH), GAME_FEATURES_INDEX_WITH_DANGER);
  // three.js ships no types in this repo: the shim makes THREE `any` for every file alike (the kit files import it too).
  writeFileSync(join(DIR, 'src/three-shim.d.ts'), "declare module 'three';\n");
}, 120_000);
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('the street-danger feature is real kit code', () => {
  it('compiles strictly against the real kit (entities, dispatch, state, the open world, the feature host)', () => {
    const files = [join(DIR, GAME_STREET_DANGER_PATH), join(DIR, GAME_FEATURES_INDEX_PATH), join(DIR, 'src/three-shim.d.ts')];
    const program = ts.createProgram(files, {
      strict: true, noUnusedLocals: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, noEmit: true, skipLibCheck: true, esModuleInterop: true, allowImportingTsExtensions: false,
      lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
      // three.js ships no types in this repo, so THREE is `any` here; every kit API the feature calls (the controller, input,
      // the open world, Entities, Dispatch, Wanted, state) is the kit's own TypeScript and is checked in full.
    });
    const ours = ts.getPreEmitDiagnostics(program).filter((d) => d.file && (d.file.fileName.includes('/features/')))
      .map((d) => `${d.file!.fileName.split('/').slice(-2).join('/')}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    expect(ours).toEqual([]);
  }, 120_000); // a strict compile of the kit files from disk: seconds locally, past the 20 s default under CI coverage (#4595's red run)
  it('spawns hostile enemies and bystanders, lands the punch, and brings the police on a crime', () => {
    expect(GAME_STREET_DANGER_FEATURE).toContain("kind: 'enemy', hostile: true");
    expect(GAME_STREET_DANGER_FEATURE).toContain("kind: 'villager', hostile: false");
    expect(GAME_STREET_DANGER_FEATURE).toContain("npcs.melee(ctx.player.object.position, yaw, STREET_DANGER.punchDamage, { byPlayer: true");
    expect(GAME_STREET_DANGER_FEATURE).toContain('new Wanted(ctx, npcs, dispatch');
    expect(GAME_STREET_DANGER_FEATURE).toContain('world.place(e.object, wx, wz, 0.05)'); // kept through origin shifts
    expect(GAME_FEATURES_INDEX_WITH_DANGER).toContain("import streetDanger from './streetDanger';");
  });
});

import { readFileSync } from 'node:fs';
import { gameKitPlan, gameKitRecipeInput, openWorldHasAFight } from '../src/server/AgentV3/gameKitSeed';

describe('a city you walk through has a fight in it — by intent, not by the word "enemy"', () => {
  const GTA = 'ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare';
  it('the GTA request lays the combat kit and tells the open world it has a fight', () => {
    const plan = gameKitPlan(GTA, 'vite-react');
    expect(plan).toContain('generate_open_world');
    expect(plan).toContain('generate_game_systems');
    expect(plan.indexOf('generate_game_systems')).toBeLessThan(plan.indexOf('generate_open_world')); // systems exist when the feature is written
    expect(gameKitRecipeInput('generate_open_world', plan, GTA)).toMatchObject({ mount: true, city: true, danger: true });
  });
  it.each([
    'open world city game for kids, peaceful, just walk around',
    'GTA jaisa open world banao par bina ladai ke, sirf ghoomne ke liye',
    'a calm open world city to explore, no violence',
  ])('🔒 a peaceful wish gets no fight: %s', (p) => {
    expect(openWorldHasAFight(p)).toBe(false);
  });
  it('🔒 a walk through open country (no city) is not given a fight it never asked for', () => {
    expect(openWorldHasAFight('3D open world game with hills and rivers to explore')).toBe(false);
  });
  it('wired: the dispatcher writes streetDanger.ts only when the systems are really there, lists it, and tells the builder', () => {
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain("if (await has('src/game/systems/entities.ts') && await has('src/game/systems/dispatch.ts')) {");
    // One list, built once: the enemies the request asked for and street danger each add themselves (featuresIndexWith).
    expect(src).toContain("indexSource = featuresIndexWith(indexSource, 'streetDanger') ?? indexSource;");
    expect(src).toContain('The game ALREADY has its fight: src/game/features/streetDanger.ts');
  });
});

describe('the kit ground is the map ground (sibling found while wiring the enemies)', () => {
  it('the open world registers the Athree height as groundHeightAt / standOnGround, in render metres, and clears it on dispose', () => {
    expect(GAME_OPEN_WORLD_BRIDGE).toContain('setGround((x, z) => { const h = map.world.heightAt(x + chunks.origin.x, z + chunks.origin.z);');
    expect(GAME_OPEN_WORLD_BRIDGE).toContain('setGround(null);');
  });
});

describe('never a second set of enemies (found merging with the requested-enemies feature, 2026-11-26)', () => {
  it('with the user\'s own enemies written, street danger brings bystanders and police but no enemies of its own', async () => {
    const { streetDangerSource } = await import('../src/server/lib/GameOpenWorldGenerator');
    expect(streetDangerSource()).toBe(GAME_STREET_DANGER_FEATURE);
    const own = streetDangerSource({ ownEnemies: true });
    expect(own).toMatch(/^\s*enemies: 0,/m);
    expect(own).toMatch(/^\s*bystanders: 4,/m);
    expect(own).not.toBe(GAME_STREET_DANGER_FEATURE);
    const src = readFileSync(join(__dirname, '..', 'src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(src).toContain('streetDangerSource({ ownEnemies: !!enemyReq })');
  });
});
