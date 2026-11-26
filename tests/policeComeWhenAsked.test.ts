/**
 * 🚓 failedbr #2549 (2026-11-26): "@model:q6-car-police me police ani chahiye, dikhni chahiye screen par cyron ki awaz bhi aye" —
 * and then the admin: "bolne par bhi na police aa rahi hai, na gadi … police ki gadi aye usse police utre". The kit had real
 * police (systems/dispatch.ts) and nothing put it in a game; the builder hand-wrote police.ts, policeCars.ts, policeResponse.ts,
 * policeSiren.ts … none on the kit's systems, and the playtest never ran (3 fps). Locked here on the REAL emitted kit:
 * (1) the request is read in the user's words; (2) the turn-start action writes policeDispatch.ts on the kit, lists it once and
 * adds the kit files it imports; (3) the written feature, run on the real kit, sends a real police car that drives in and
 * whose officers get out; (4) the file compiles against the kit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as THREE from 'three';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_FEATURES_INDEX, GAME_FEATURES_INDEX_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { policeRequestFrom, policeRequestOf, policeFeatureSource, featuresIndexWithPolice, POLICE_FEATURE_PATH } from '../src/server/lib/GamePoliceFeature';
import { addPoliceAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { tsconfig as scaffoldTsconfig } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

const REPORT_2549 = '@model:q6-car-police me police ani chahiye, dikhni chahiye screen par cyron ki awaz bhi aye,';
const ADMIN = 'police ki gadi aye usse police utre';

describe('🚓 the request is read in the words users type', () => {
  it("#2549's own words, the admin's, and the usual ones", () => {
    expect(policeRequestFrom(REPORT_2549)).toEqual({ cars: 1, crew: 2, chase: false });
    expect(policeRequestFrom(ADMIN)).toMatchObject({ cars: 1 });
    expect(policeRequestFrom('2 police gaadi bhejo jo mujhe pakde')).toEqual({ cars: 2, crew: 2, chase: true });
    expect(policeRequestFrom('पुलिस आनी चाहिए')).not.toBeNull();
  });
  it('a refusal or a mention with no wish is not a request; tool input is bounded', () => {
    for (const p of ['police mat daalo', 'bina police ka game', 'ek gaon banao', 'police']) expect(policeRequestFrom(p), p).toBeNull();
    expect(policeRequestOf({ cars: 99, crew: -2, chase: 'yes' })).toEqual({ cars: 5, crew: 1, chase: false });
    expect(policeRequestOf(null)).toBeNull();
  });
  it('the first open-world build carries it', () => {
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world city game jisme police aaye')).toMatchObject({ police: { cars: 1 } });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world city game')).not.toHaveProperty('police');
  });
});

describe('🚓 the turn-start action puts the kit police in, once', () => {
  const fake = (files: Record<string, string>) => {
    const written: Record<string, string> = {};
    const codes: string[] = [];
    const io = { filesAtTurnStart: files, read: async (p: string) => written[p] ?? files[p], write: async (p: string, c: string) => { written[p] = c; }, record: (i: { code: string }) => { codes.push(i.code); } };
    return { io, written, codes };
  };
  it('#2549\'s project had no systems kit: the feature, the list entry and the kit files it imports are all written', async () => {
    const { io, written, codes } = fake({ [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX, 'src/game/features/police.ts': '// hand-written' });
    const note = await addPoliceAtTurnStart({ ...io, prompt: REPORT_2549 } as never);
    expect(written[POLICE_FEATURE_PATH]).toContain("import { Dispatch, Wanted } from '../systems/dispatch';");
    expect(written[GAME_FEATURES_INDEX_PATH]).toContain("import policeDispatch from './policeDispatch';");
    expect(Object.keys(written)).toEqual(expect.arrayContaining(['src/game/systems/dispatch.ts', 'src/game/systems/entities.ts']));
    expect(codes).toEqual(['POLICE_ADDED']);
    expect(note).toMatch(/THE POLICE ARE ALREADY IN THE GAME/);
    expect(note).toMatch(/stop extending any hand-written police file/);
  });
  it('never twice; nothing without the kit list or without an ask', async () => {
    const once = fake({ [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX, [POLICE_FEATURE_PATH]: '// there' });
    expect(await addPoliceAtTurnStart({ ...once.io, prompt: ADMIN } as never)).toMatch(/ALREADY HAS THE KIT'S POLICE/);
    expect(once.written).toEqual({});
    expect(await addPoliceAtTurnStart({ ...fake({ 'src/App.tsx': 'x' }).io, prompt: ADMIN } as never)).toBe('');
    expect(featuresIndexWithPolice(featuresIndexWithPolice(GAME_FEATURES_INDEX)!)).toBeNull();
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIR = join(__dirname, `.tmp-police-${process.pid}`);
const REPO_MODULES = resolve(__dirname, '..', 'node_modules');
let F: any;
beforeAll(async () => {
  (globalThis as any).window = { addEventListener: () => {} };
  for (const [p, f] of recipeFilePool()) if (/^src\/game\//.test(p) && !/\.test\.tsx?$/.test(p)) { mkdirSync(dirname(join(DIR, p)), { recursive: true }); writeFileSync(join(DIR, p), f.content); }
  mkdirSync(dirname(join(DIR, POLICE_FEATURE_PATH)), { recursive: true });
  writeFileSync(join(DIR, POLICE_FEATURE_PATH), policeFeatureSource({ cars: 1, crew: 2, chase: false }));
  F = await import(join(DIR, POLICE_FEATURE_PATH));
}, 120_000);
afterAll(() => { rmSync(DIR, { recursive: true, force: true }); delete (globalThis as any).window; });

describe('🚓 the written feature, on the real kit: a police car drives in and the officers get out', () => {
  it('a car with its light bar is in the scene, it arrives near the player, and two officers stand there', () => {
    const scene = new THREE.Scene();
    const player = { object: new THREE.Object3D() };
    scene.add(player.object);
    const hooks = new Set<(dt: number) => void>();
    const ctx = { scene, player, camera: new THREE.PerspectiveCamera(), onStep: (fn: (dt: number) => void) => { hooks.add(fn); return () => { hooks.delete(fn); }; } };
    const placed: any[] = [];
    const world = { map: { chunks: { origin: { x: 0, z: 0 } } }, place: (o: any) => placed.push(o) };
    const feature = F.default;
    const state = feature.setup(ctx, world, { get: () => undefined });
    const api = { get: () => state };
    const cars = () => scene.children.filter((o) => o.name === 'police car');
    expect(cars().length).toBe(1);
    expect(Math.hypot(cars()[0].position.x, cars()[0].position.z)).toBeGreaterThan(20);   // it comes FROM somewhere
    let officers = 0;
    for (let t = 0; t < 40 && officers < 2; t += 1 / 30) {
      for (const f of [...hooks]) f(1 / 30);
      feature.update(ctx, world, 1 / 30, api);
      officers = state.dispatch.active.reduce((n: number, c: any) => n + c.units.filter((u: any) => u.alive).length, 0);
    }
    expect(officers).toBe(2);
    expect(placed.length).toBeGreaterThanOrEqual(3);   // the car and both officers move with the floating origin
  }, 60_000);
});

describe('🚓 the file compiles against the real kit', () => {
  it('no diagnostic in the feature or the list, under the scaffold tsconfig', () => {
    const dir = join(DIR, 'app');
    const files = new Map<string, string>();
    for (const [p, f] of recipeFilePool()) files.set(p, f.content);
    files.set(POLICE_FEATURE_PATH, policeFeatureSource({ cars: 2, crew: 2, chase: true }));
    files.set(GAME_FEATURES_INDEX_PATH, featuresIndexWithPolice(GAME_FEATURES_INDEX)!);
    files.set('src/vite-env.d.ts', `/// <reference path="${join(REPO_MODULES, 'vite', 'client.d.ts')}" />\n`);
    for (const [p, c] of files) { if (!/\.(?:ts|tsx)$/.test(p)) continue; mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
    const parsed = ts.parseJsonConfigFileContent(JSON.parse(scaffoldTsconfig), ts.sys, dir);
    const program = ts.createProgram([join(dir, GAME_FEATURES_INDEX_PATH), join(dir, 'src/vite-env.d.ts')], {
      ...parsed.options, noEmit: true,
      paths: { ...(parsed.options.paths ?? {}), '*': [`${REPO_MODULES}/@types/*`, `${REPO_MODULES}/*`] }, typeRoots: [join(REPO_MODULES, '@types')], types: [],
    });
    const excused = (d: ts.Diagnostic) => (d.code === 2307 || d.code === 7016) && /['"]three(?:\/[^'"]*)?['"]/.test(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName.startsWith(dir) && !excused(d))
      .map((d) => `${d.file!.fileName.slice(dir.length + 1)} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    expect(errs).toEqual([]);
  }, 180_000);
});

describe('🚓 wired: the police action runs every turn beside the enemies, and on the first build', () => {
  it('platformDoneTurn calls it; the dispatcher writes it on the first build with the kit files it imports', async () => {
    const { readFileSync } = await import('node:fs');
    const turn = readFileSync(resolve(__dirname, '../src/server/AgentV3/platformDoneTurn.ts'), 'utf8');
    expect(turn).toMatch(/const police = await addPoliceAtTurnStart\(io\);/);
    expect(turn).toMatch(/const handoff = \[picked, enemies, police\]\.filter\(Boolean\)/);
    const d = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(d).toMatch(/const policeReq = policeRequestOf\(owRec\.police\);[\s\S]{0,300}guardedWrite\(POLICE_FEATURE_PATH, policeFeatureSource\(policeReq\)/);
    expect(d).toMatch(/if \(Object\.keys\(peopleFiles\)\.length\) owLayers \+= await this\.addMissingRecipeLayers\(peopleFiles, agent\);/);
  });
});
