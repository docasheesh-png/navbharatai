/**
 * Build #2565 (2026-11-27), the user's request, verbatim:
 *   "ek pubg jaisa game banao! … @character:lib12-young-man ki hero banana hai, aur @model:q7-ranger-man ko enemy bot"
 * The build said "⚠️ I could not find these in this project: @character, @model" and used neither model.
 *
 * ROOT: libraryRowById looked an id up with the library SCREEN's search (name, subjects, category — never the id), so 1,021
 * of 1,022 ids were "not in the library"; the picks stayed in the request, and the file-mention parser, which stops at ':',
 * read them as files named "character" and "model". CLASS: a library pick that is not read as the exact library item it
 * names. Locked here end to end: the id is found, its role is read, the new-game seed pins it and sets the player, the
 * enemies wear it, an unknown id is named honestly, and every kind the picker can insert is one the build reads.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandLibraryMentions, libraryRowById } from '../src/server/AgentV3/gameAssets/libraryMention';
import { LIBRARY_USES, libraryPicksIn } from '../src/server/AgentV3/gameAssets/libraryPicks';
import { libraryBrowseRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { parseFileMentions, unresolvedMentionsNotice } from '../src/server/AgentV3/fileMentions';
import { enemyFeatureSource, enemyRequestFrom, enemyRequestOf, enemiesAddedHandoff } from '../src/server/lib/GameEnemiesFeature';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { librarySubjectOf } from '../src/server/AgentV3/characterSwap';   // the generator takes the lookup (it never imports the catalogue)
import { prepareGameAssets, pickedModelsHandoff } from '../src/server/AgentV3/gameAssets/assetSeed';
import { createAssetProviders, type ReviewedAsset } from '../src/server/AgentV3/gameAssets/providers';
import { createDurableAssetCache } from '../src/server/AgentV3/gameAssets/assetCache';
import { persistProjectAsset, type GameAssetWorkspace } from '../src/server/AgentV3/gameAssets/assetProject';
import { gamePlayerFileSource, GAME_PLAYER_FILE_PATH } from '../src/server/lib/GamePlayerBodyGenerator';
import { GAME_ASSET_MODELS_PATH } from '../src/server/lib/GameAssetRuntimeGenerator';
import { syntheticGlb, syntheticCandidate } from './fixtures/gameAssetFixtures';

const BUILD_2565 = 'ek pubg jaisa game banao!\njahan 10km*10km ka map ho aur 2km*2km se le kar 5km*5km tak ke 3-4 city/village ho.\nhero ke hath me gun ho,\n@character:lib12-young-man ki hero banana hai, aur @model:q7-ranger-man ko enemy bot';

describe('build #2565: a library pick is the exact library item, never a missing file', () => {
  it('every id the library screen can show is found by that id (the lookup searched names)', () => {
    const rows = libraryBrowseRows(undefined, () => false);
    expect(rows.length).toBeGreaterThan(100);
    expect(rows.filter((r) => libraryRowById(r.id)?.id !== r.id).map((r) => r.id)).toEqual([]);
    expect(libraryRowById('map-place:village')?.id).toBe('map-place:village');
    expect(libraryRowById('no-such-thing')).toBeNull();
  });

  it('the verbatim request reads both picks, each with its role, and keeps every word the user typed', () => {
    const out = expandLibraryMentions(BUILD_2565);
    expect(out).not.toMatch(/@(?:character|model|car):/);
    expect(out).toContain('the Young Man from the NavBharatAI library (library id: "lib12-young-man") (as my player character) ki hero banana hai');
    expect(out).toContain('aur the Q7 Ranger Man from the NavBharatAI library (library id: "q7-ranger-man") (worn by the hostile characters) ko enemy bot');
    expect(out.startsWith('ek pubg jaisa game banao!\njahan 10km*10km ka map ho')).toBe(true);
    expect(libraryPicksIn(out)).toEqual([{ id: 'lib12-young-man', role: 'player' }, { id: 'q7-ranger-man', role: 'enemy' }]);
  });

  it('nothing in the read request is reported as a missing project file', () => {
    const mentions = parseFileMentions(expandLibraryMentions(BUILD_2565), ['src/App.tsx', 'src/game/player.ts']);
    expect(mentions.unresolved).toEqual([]);
    expect(mentions.library ?? []).toEqual([]);
    expect(unresolvedMentionsNotice(mentions)).toBe('');
  });

  it('an id the library does not hold is named as that id, in the library — never "@character in this project"', () => {
    const raw = '@character:lib12-nobody ki hero banana hai, aur @model:q7-x ko enemy bot, @src/App.tsx bhi dekho';
    const out = expandLibraryMentions(raw);
    expect(out).toBe(raw);
    const mentions = parseFileMentions(out, ['src/App.tsx']);
    expect(mentions.resolved).toEqual(['src/App.tsx']);
    expect(mentions.unresolved).toEqual([]);
    expect(mentions.library).toEqual(['character:lib12-nobody', 'model:q7-x']);
    const notice = unresolvedMentionsNotice(mentions);
    expect(notice).toContain('The NavBharatAI game library has no items with these ids: "lib12-nobody", "q7-x"');
    expect(notice).not.toMatch(/@character|@model|in this project/);
    // A known pick beside an unknown one: the unknown one stays in the request, never dropped without a word.
    expect(expandLibraryMentions('@model:q7-ranger-man @model:q7-x')).toContain('@model:q7-x');
  });

  it('a @model pick takes its role from its OWN clause only; both or neither kind of word is just a model', () => {
    const rows: Record<string, { id: string; name: string }> = { a: { id: 'a', name: 'A' }, b: { id: 'b', name: 'B' } };
    const look = (id: string) => rows[id] ?? null;
    expect(libraryPicksIn(expandLibraryMentions('hero @model:a ho aur enemy @model:b', look))).toEqual([{ id: 'a', role: 'player' }, { id: 'b', role: 'enemy' }]);
    expect(libraryPicksIn(expandLibraryMentions('dushman ke liye @model:a, aur gaon me @model:b rakho', look))).toEqual([{ id: 'a', role: 'enemy' }, { id: 'b', role: 'model' }]);
    expect(libraryPicksIn(expandLibraryMentions('@model:a hero aur enemy dono', look))).toEqual([{ id: 'a', role: 'player' }]);
    expect(libraryPicksIn(expandLibraryMentions('@model:a ko hero se ladne wala enemy banao', look))).toEqual([{ id: 'a', role: 'model' }]);
    // The whole instructions the library screen has always sent still read as the same roles.
    expect(libraryPicksIn('Make the Knight from the NavBharatAI library my game\'s player character (library id: "k"). Replace only…')).toEqual([{ id: 'k', role: 'player' }]);
  });

  it('every kind the Game Library picker can insert is a kind the build reads (a new picker mode fails here)', () => {
    const picker = readFileSync(join(__dirname, '../src/components/agentv3/GameLibraryPicker.tsx'), 'utf8');
    const modes = /useState<([^>]+)>\('add'\)/.exec(picker)?.[1].split('|').map((s) => s.trim().replace(/'/g, '')) ?? [];
    expect(modes.sort()).toEqual(['add', 'car', 'character']);
    expect(picker).toContain("onPick(`@${use === 'add' ? 'model' : use}:${row.id}`)");
    const emitted = modes.map((m) => (m === 'add' ? 'model' : m));
    expect(emitted.filter((k) => !(LIBRARY_USES as readonly string[]).includes(k))).toEqual([]);
  });
});

describe('build #2565: the enemies wear the model the user picked for them', () => {
  const read = expandLibraryMentions(BUILD_2565);

  it('the request gives the enemies that model, and the first build carries it to the open world', () => {
    expect(enemyRequestFrom(read, librarySubjectOf)).toMatchObject({ kind: 'enemy', ai: 'ranged', model: { subject: 'ranger', id: 'q7-ranger-man' } });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world', 'generate_game_systems'], read)).toMatchObject({ enemies: { model: { subject: 'ranger', id: 'q7-ranger-man' } } });
    // Tool input is checked: a model the builder edited into something unsafe is dropped, a sound one kept.
    expect(enemyRequestOf({ model: { subject: 'ranger', id: 'q7-ranger-man' } })?.model).toEqual({ subject: 'ranger', id: 'q7-ranger-man' });
    expect(enemyRequestOf({ model: { subject: "x'); alert(1); ('", id: 'q7-ranger-man' } })?.model).toBeUndefined();
    // No pick → no model (the kit body, as before).
    expect(enemyRequestFrom('10 zombies banao')?.model).toBeUndefined();
  });

  it('the feature dresses every enemy in it with Entities.dress and plays its own clips', () => {
    const src = enemyFeatureSource(enemyRequestFrom(read, librarySubjectOf)!);
    expect(src).toContain("model: 'ranger' as string | null,");
    expect(src).toContain('wear(state, e);');
    expect(src).toContain('void state.entities.dress(entity, model);');
    expect(src).toContain('if (s) animateWorn(s, delta);');
    expect(enemyFeatureSource(enemyRequestFrom('10 zombies banao')!)).toContain('model: null as string | null,');
    expect(enemiesAddedHandoff(enemyRequestFrom(read, librarySubjectOf)!, [])).toContain('add_library_models({ models: [{ id: "q7-ranger-man" }] })');
  });
});

describe('build #2565: the new-game seed pins the picks and sets the player', () => {
  const bytes = syntheticGlb();
  const base = syntheticCandidate(bytes);
  const entry = (id: string, subjects: string[]): ReviewedAsset => ({ ...base, id, subjects, libraryCategory: 'character', animationRoles: { idle: 'Move', walk: 'Move' } });
  const catalogue = [entry('other-young-man', ['young man']), entry('lib12-young-man', ['young man', 'teenager']), entry('q7-ranger-man', ['ranger'])];

  it('adds both exact models, sets PLAYER.model to the hero, and says so to the builder', async () => {
    const workspaceId = 'fixture-2565';
    const texts = new Map<string, string>();
    const objects = new Map<string, Uint8Array>();
    const workspace: GameAssetWorkspace = { writeFile: async () => {}, writeBinaryFile: async () => {}, runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }) };
    const binary = new Map<string, string>();
    const persistence = {
      saveBinary: async (_id: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) binary.set(p, c); },
      readBinary: async (_id: string, p: string) => (binary.has(p) ? Buffer.from(binary.get(p)!.split(',')[1], 'base64') : null),
      saveText: async (_id: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) texts.set(p, c); },
    };
    const download = vi.fn(async () => bytes);
    const result = await prepareGameAssets({
      workspaceId, prompt: expandLibraryMentions(BUILD_2565), starterPlayerSource: gamePlayerFileSource(workspaceId), env: { AGENTV3_EXTERNAL_GAME_ASSETS: 'on' } as NodeJS.ProcessEnv,
      signal: new AbortController().signal, workspace, persistence, catalogue,
      dependencies: {
        cache: createDurableAssetCache({ read: async (k: string) => objects.get(k) ?? null, write: async (k: string, d: Uint8Array) => { objects.set(k, d); } }, catalogue),
        providers: createAssetProviders(catalogue), download, parse: vi.fn(async () => {}), persist: persistProjectAsset(workspace, workspaceId, persistence),
      },
    });
    expect(result.status, JSON.stringify(result.outcomes).slice(0, 1500)).toBe('prepared');
    const manifest = JSON.parse(result.files['public/game-assets/manifest.json']) as { assets: Array<{ subject: string; candidate: { id: string } }> };
    expect(manifest.assets.find((a) => a.subject === 'young man')?.candidate.id).toBe('lib12-young-man');
    expect(manifest.assets.find((a) => a.subject === 'ranger')?.candidate.id).toBe('q7-ranger-man');
    expect(result.files[GAME_PLAYER_FILE_PATH]).toContain("model: 'young man'");
    expect(result.files[GAME_ASSET_MODELS_PATH]).toContain('"ranger"');
    expect(result.handoff).toContain("\"lib12-young-man\" is the player: PLAYER.model = 'young man' is already set");
    expect(result.handoff).toContain("\"q7-ranger-man\" is saved as 'ranger' for the enemies");
  });

  it('a pick that could not be added is said plainly', () => {
    expect(pickedModelsHandoff([{ id: 'q7-ranger-man', role: 'enemy', subject: 'ranger' }], new Set(), false)).toContain('"q7-ranger-man" could not be added to the game');
    expect(pickedModelsHandoff([], new Set(), false)).toBe('');
  });
});
