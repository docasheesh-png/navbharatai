/**
 * 🚗 Admin 2026-11-26: "maine game library se police car choose ki par woh bhi nahi ayi, likh kar aya, yah car available nahi
 * hai". "Use as my car" worked only on the racing starter; in an open-world game the platform refused ("this game is not a
 * race") and the user was told the car was not changed. Now a game on the kit's features list gets the picked car as a
 * feature: the model is added, src/game/features/myCar.ts is written and listed, and the car is drivable in front of the
 * player. The written file is compiled against the real kit.
 */
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_FEATURES_INDEX, GAME_FEATURES_INDEX_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { featuresIndexWith } from '../src/server/lib/GameEnemiesFeature';
import { MY_CAR_FEATURE_PATH, myCarFeatureSource, setMyCarModel } from '../src/server/lib/GameMyCarFeature';
import { setLibraryCarAtTurnStart, useAsCarPrompt } from '../src/server/AgentV3/carSwap';
import { librarySubjectOf } from '../src/server/AgentV3/characterSwap';
import { generateAssetModelLoader, generateGameAssetRuntime } from '../src/server/lib/GameAssetRuntimeGenerator';
import { tsconfig as scaffoldTsconfig } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

const ID = 'q6-car-police';
const SUBJECT = librarySubjectOf(ID)!;
const PICK = useAsCarPrompt({ id: ID, name: 'Police car' })!;

function turn(files: Record<string, string>, addModel = async () => `Added to the game from the NavBharatAI library: ${SUBJECT}.`) {
  const written: Record<string, string> = {};
  const codes: string[] = [];
  const io = {
    prompt: PICK, filesAtTurnStart: files,
    read: async (p: string) => { const c = written[p] ?? files[p]; if (c === undefined) throw new Error('ENOENT'); return c; },
    write: async (p: string, c: string) => { written[p] = c; },
    addModel, record: (i: { code: string }) => { codes.push(i.code); },
  };
  return { io, written, codes };
}

describe('🚗 a car picked in the Game library arrives in an open-world game', () => {
  it('the police car of the report is a library model', () => {
    expect(SUBJECT).toBeTruthy();
  });

  it('an open-world game: the model is added, myCar.ts is written and listed, and the builder is told it is done', async () => {
    let added = '';
    const t = turn({ 'src/App.tsx': '<OpenWorldGame />', [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX }, async (id: string) => { added = id; return `Added to the game from the NavBharatAI library: ${SUBJECT}.`; });
    const note = await setLibraryCarAtTurnStart(t.io as never);
    expect(added).toBe(ID);
    expect(t.written[MY_CAR_FEATURE_PATH]).toContain(`model: '${SUBJECT}',`);
    expect(t.written[MY_CAR_FEATURE_PATH]).toContain('ctx.vehicles.add(car);');
    expect(t.written[GAME_FEATURES_INDEX_PATH]).toContain("import myCar from './myCar';");
    expect(t.codes).toEqual(['MY_CAR_ADDED']);
    expect(note).toMatch(/DONE BY THE PLATFORM/);
    expect(note).not.toMatch(/NOT DONE/);
  });

  it('picking another car later changes one line; nothing is listed twice', async () => {
    const first = myCarFeatureSource('sedan');
    const t = turn({ 'src/App.tsx': '<OpenWorldGame />', [GAME_FEATURES_INDEX_PATH]: featuresIndexWith(GAME_FEATURES_INDEX, 'myCar')!, [MY_CAR_FEATURE_PATH]: first });
    await setLibraryCarAtTurnStart(t.io as never);
    expect(t.written[MY_CAR_FEATURE_PATH]).toBe(setMyCarModel(first, SUBJECT));
    expect(t.written[GAME_FEATURES_INDEX_PATH]).toBeUndefined();
  });

  it('a model that could not be added is said, never pretended; a game with neither a race nor the kit list is still told plainly', async () => {
    const failed = turn({ 'src/App.tsx': '<OpenWorldGame />', [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX }, async () => 'failed: offline');
    expect(await setLibraryCarAtTurnStart(failed.io as never)).toMatch(/NOT DONE/);
    expect(failed.written).toEqual({});
    const other = turn({ 'src/App.tsx': '<Todo />' });
    expect(await setLibraryCarAtTurnStart(other.io as never)).toMatch(/NOT DONE/);
  });

  it('the race starter keeps its own path (CAR.model in src/game/car.ts)', async () => {
    const t = turn({ 'src/App.tsx': '<RacingRoadGame />' });
    await setLibraryCarAtTurnStart(t.io as never);
    expect(t.codes).toEqual(['RACE_CAR_SET']);
    expect(t.written[MY_CAR_FEATURE_PATH]).toBeUndefined();
  });

  it('the written feature compiles against the real kit (with the model loader a game has once a model is added)', () => {
    const REPO_MODULES = resolve(__dirname, '..', 'node_modules');
    const dir = makeTempDir('nbai-mycar-');
    const files = new Map<string, string>();
    for (const [p, f] of recipeFilePool()) files.set(p, f.content);
    files.set('src/game/three/externalAssets.ts', generateGameAssetRuntime());
    files.set('src/game/three/assetModels.ts', generateAssetModelLoader({}));
    files.set(MY_CAR_FEATURE_PATH, myCarFeatureSource(SUBJECT));
    files.set(GAME_FEATURES_INDEX_PATH, featuresIndexWith(GAME_FEATURES_INDEX, 'myCar')!);
    files.set('src/vite-env.d.ts', `/// <reference path="${join(REPO_MODULES, 'vite', 'client.d.ts')}" />\n`);
    for (const [p, c] of files) { if (!/\.(?:ts|tsx)$/.test(p)) continue; mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
    const parsed = ts.parseJsonConfigFileContent(JSON.parse(scaffoldTsconfig), ts.sys, dir);
    const program = ts.createProgram([join(dir, GAME_FEATURES_INDEX_PATH), join(dir, 'src/vite-env.d.ts')], {
      ...parsed.options, noEmit: true,
      paths: { ...(parsed.options.paths ?? {}), '*': [`${REPO_MODULES}/@types/*`, `${REPO_MODULES}/*`] }, typeRoots: [join(REPO_MODULES, '@types')], types: [],
    });
    const excused = (d: ts.Diagnostic) => (d.code === 2307 || d.code === 7016) && /['"]three(?:\/[^'"]*)?['"]/.test(ts.flattenDiagnosticMessageText(d.messageText, ' '));
    const errs = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName.startsWith(dir) && !excused(d) && /features\//.test(d.file.fileName))
      .map((d) => `${d.file!.fileName.slice(dir.length + 1)} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    expect(errs).toEqual([]);
  }, 180_000);
});
