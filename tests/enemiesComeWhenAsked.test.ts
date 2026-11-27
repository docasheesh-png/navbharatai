/**
 * Admin 2026-11-26, game-maker list #4: "abhi enemy bot nahi ban rahe hai. aap is ko 5-7 bar edit kar chuke bhi game me
 * enemy nahi aa rahe hai". The kit had every part of an enemy and nothing put them in a game; each request asked a model
 * to assemble them by hand. Now the platform writes src/game/features/enemies.ts at the start of the turn and lists it.
 * This census proves (1) the request is read in the words users type, refusals included; (2) the turn-start action writes
 * the feature, lists it once, and never overwrites the game's own enemies; (3) the file it writes COMPILES against the real
 * kit, under the scaffold's own compiler options, so the enemies are not a type error waiting for the builder.
 */
import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempDir } from './helpers/tempDir';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { GAME_FEATURES_INDEX, GAME_FEATURES_INDEX_PATH } from '../src/server/lib/GameOpenWorldGenerator';
import { enemyRequestFrom, enemyFeatureSource, featuresIndexWith, ENEMIES_FEATURE_PATH, FEATURES_INDEX_PATH } from '../src/server/lib/GameEnemiesFeature';
import { addEnemiesAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { tsconfig as scaffoldTsconfig } from '../src/server/AgentV3/sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

describe('#4 the request is read in the words users type', () => {
  it('asks: any language, count, kind, how they fight', () => {
    expect(enemyRequestFrom('game me enemy banao')).toMatchObject({ count: 6, ai: 'melee', kind: 'enemy' });
    expect(enemyRequestFrom('10 zombies add karo')).toMatchObject({ count: 10, kind: 'zombie' });
    expect(enemyRequestFrom('paanch villain daalo jo gun se shoot kare')).toMatchObject({ count: 5, kind: 'villain', ai: 'ranged' });
    expect(enemyRequestFrom('bots chahiye jo chaaron taraf se ghere')).toMatchObject({ kind: 'bot', ai: 'flanker' });
    expect(enemyRequestFrom('दुश्मन बनाओ')).toMatchObject({ kind: 'enemy' });
    expect(enemyRequestFrom('bahut saare gunde lao, mushkil wale')).toMatchObject({ count: 12, kind: 'goon', health: 120, damage: 16 });
  });
  it('does not ask: refusals and a mention with no wish', () => {
    for (const p of ['enemy mat daalo', 'no enemies please, peaceful game', 'bina dushman ka game', 'ek gaon banao', 'zombie']) expect(enemyRequestFrom(p), p).toBeNull();
  });
  it('the count is bounded', () => {
    expect(enemyRequestFrom('500 enemies banao')!.count).toBe(40);
  });
});

describe('#4 the turn-start action puts them in, once', () => {
  const fake = (files: Record<string, string>) => {
    const written: Record<string, string> = {};
    const issues: Array<{ code: string }> = [];
    const io = {
      filesAtTurnStart: files,
      read: async (p: string) => written[p] ?? files[p],
      write: async (p: string, c: string) => { written[p] = c; },
      record: (i: { code: string }) => { issues.push(i); },
    };
    return { io, written, issues };
  };

  it('writes the feature, lists it in the game, and tells the builder', async () => {
    const kit = Object.fromEntries([...recipeFilePool()].map(([p, f]) => [p, f.content]));
    const { io, written, issues } = fake({ ...kit, [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX });
    const note = await addEnemiesAtTurnStart({ ...io, prompt: '8 enemy banao' } as never);
    expect(written[ENEMIES_FEATURE_PATH]).toContain('count: 8,');
    expect(written[FEATURES_INDEX_PATH]).toContain("import enemies from './enemies';");
    expect(written[FEATURES_INDEX_PATH]).toMatch(/FEATURES: GameFeature<OpenWorld>\[\] = \[\n {2}enemies,\n\];/);
    expect(issues.map((i) => i.code)).toEqual(['ENEMIES_ADDED']);
    expect(note).toMatch(/THE ENEMIES ARE ALREADY IN THE GAME/);
    // A project that already has the kit gets only the two files.
    expect(Object.keys(written).sort()).toEqual([ENEMIES_FEATURE_PATH, FEATURES_INDEX_PATH].sort());
  });

  it('a project missing a kit file the feature imports gets that file too (entities, its body, its physics)', async () => {
    const { io, written } = fake({ [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX });
    await addEnemiesAtTurnStart({ ...io, prompt: 'enemy banao' } as never);
    expect(Object.keys(written)).toContain('src/game/systems/entities.ts');
  });

  it('never overwrites a game that already has enemies; nothing for a game without the kit list or a turn with no ask', async () => {
    const own = fake({ [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX, [ENEMIES_FEATURE_PATH]: '// mine' });
    expect(await addEnemiesAtTurnStart({ ...own.io, prompt: '10 enemy karo' } as never)).toMatch(/ALREADY HAS ENEMIES/);
    expect(own.written).toEqual({});
    const noList = fake({ 'src/App.tsx': 'x' });
    expect(await addEnemiesAtTurnStart({ ...noList.io, prompt: 'enemy banao' } as never)).toBe('');
    const noAsk = fake({ [GAME_FEATURES_INDEX_PATH]: GAME_FEATURES_INDEX });
    expect(await addEnemiesAtTurnStart({ ...noAsk.io, prompt: 'ek pul banao' } as never)).toBe('');
    expect(noAsk.written).toEqual({});
  });

  it('a list already holding it is not listed twice; a list not in the kit shape is not guessed at', () => {
    const once = featuresIndexWith(GAME_FEATURES_INDEX, 'enemies')!;
    expect(featuresIndexWith(once, 'enemies')).toBeNull();
    expect(featuresIndexWith('export default []', 'enemies')).toBeNull();
  });
});

const REPO_MODULES = resolve(__dirname, '..', 'node_modules');
function excused(d: ts.Diagnostic): boolean {
  if (d.code !== 2307 && d.code !== 7016) return false;
  return /['"]three(?:\/[^'"]*)?['"]/.test(ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

describe('#4 the enemies file compiles against the real kit', () => {
  it('no diagnostic in the feature or the list, under the scaffold tsconfig', () => {
    const dir = makeTempDir('nbai-enemies-');
    const files = new Map<string, string>();
    for (const [p, f] of recipeFilePool()) files.set(p, f.content);
    // Build #2565: the enemies dressed in a library model compile too (the model's loader is optional, read by import.meta.glob).
    for (const req of [enemyRequestFrom('10 zombies banao')!, enemyRequestFrom('gun wale villain banao')!, { ...enemyRequestFrom('gun wale villain banao')!, model: { subject: 'ranger', id: 'q7-ranger-man' } }]) {
      files.set(ENEMIES_FEATURE_PATH, enemyFeatureSource(req));
      files.set(FEATURES_INDEX_PATH, featuresIndexWith(GAME_FEATURES_INDEX, 'enemies')!);
      files.set('src/vite-env.d.ts', `/// <reference path="${join(REPO_MODULES, 'vite', 'client.d.ts')}" />\n`);
      for (const [p, c] of files) {
        if (!/\.(?:ts|tsx)$/.test(p)) continue;
        mkdirSync(dirname(join(dir, p)), { recursive: true });
        writeFileSync(join(dir, p), c);
      }
      const parsed = ts.parseJsonConfigFileContent(JSON.parse(scaffoldTsconfig), ts.sys, dir);
      const program = ts.createProgram([join(dir, FEATURES_INDEX_PATH), join(dir, 'src/vite-env.d.ts')], {
        ...parsed.options, noEmit: true,
        paths: { ...(parsed.options.paths ?? {}), '*': [`${REPO_MODULES}/@types/*`, `${REPO_MODULES}/*`] },
        typeRoots: [join(REPO_MODULES, '@types')], types: [],
      });
      const errs = ts.getPreEmitDiagnostics(program)
        .filter((d) => d.file && d.file.fileName.startsWith(dir) && !excused(d))
        .map((d) => `${d.file!.fileName.slice(dir.length + 1)} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
      expect(errs).toEqual([]);
    }
  }, 180_000);
});

describe('#4 a first build that asks for enemies has them', () => {
  it('the seed hands the open world the request; none when not asked', async () => {
    const { gameKitRecipeInput } = await import('../src/server/AgentV3/gameKitSeed');
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek open world game banao jisme 5 zombie ho')).toMatchObject({ mount: true, enemies: { count: 5, kind: 'zombie' } });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'ek open world game banao')).not.toHaveProperty('enemies');
  });
  it('tool input is checked and bounded before it becomes code', async () => {
    const { enemyRequestOf } = await import('../src/server/lib/GameEnemiesFeature');
    expect(enemyRequestOf({ count: 999, ai: 'nuke', health: -5, kind: "x'); alert(1); //" })).toEqual({ count: 40, ai: 'melee', health: 1, damage: 10, kind: 'enemy' });
    expect(enemyRequestOf('enemy')).toBeNull();
    expect(enemyRequestOf(null)).toBeNull();
  });
  it('the dispatcher writes the feature before the list, and the turn-start action runs every turn, beside the picker actions', async () => {
    const { readFileSync } = await import('node:fs');
    const dispatcher = readFileSync(resolve(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
    expect(dispatcher).toMatch(/const enemyReq = enemyRequestOf\(owRec\.enemies\);[\s\S]{0,400}guardedWrite\(ENEMIES_FEATURE_PATH, enemyFeatureSource\(enemyReq\)/);
    // Not a picker action (the builder still runs after it), so it runs beside the picker composition, every turn.
    const turn = readFileSync(resolve(__dirname, '../src/server/AgentV3/platformDoneTurn.ts'), 'utf8');
    expect(turn).toMatch(/const enemies = await addEnemiesAtTurnStart\(io\);/);
    expect(turn).toMatch(/const handoff = \[picked, enemies(?:, police)?\]\.filter\(Boolean\)/);
  });
});
