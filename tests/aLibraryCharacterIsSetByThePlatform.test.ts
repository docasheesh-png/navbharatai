// A CHARACTER PICKED IN THE GAME LIBRARY IS SET BY THE PLATFORM — AND NOTHING IS CHANGED ON A GUESS (failedbr #2485, Q-3229;
// admin 2026-11-21: "andaze se kuch bhi change/update na ho. Jab bhi baat clear na ho, to user se puch li jaye").
//
// 🧬 THE CLASS: an exact, mechanical request handed to a model to carry out by following a rule. "Use as my character"
// names one exact library model; the platform adds it and sets one line. Where it cannot, it changes nothing and the
// builder is told to say so and ask — never to pick something close.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { characterAsked, librarySubjectOf, modelWasAdded, setPlayerModel, PLAYER_FILE_PATH } from '../src/server/AgentV3/characterSwap';
import { setLibraryCharacterAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { useAsCharacterPrompt, addToGamePrompt, libraryBrowseRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { GAME_PLAYER_FILE, GAME_PLAYER_FILE_PATH } from '../src/server/lib/GameOpenWorldGenerator';

const row = libraryBrowseRows(undefined, () => false)[0];
const subject = librarySubjectOf(row.id)!;
const ask = useAsCharacterPrompt(row)!;
const added = `Added to the game from the NavBharatAI library: ${subject}. Use them with: …`;

function turn(over: Partial<Parameters<typeof setLibraryCharacterAtTurnStart>[0]> = {}, file: string | null = GAME_PLAYER_FILE) {
  const disk = new Map<string, string>(file === null ? [] : [[PLAYER_FILE_PATH, file]]);
  const issues: Array<{ code: string; message: string }> = [];
  const addModel = vi.fn(async () => added);
  const write = vi.fn(async (p: string, c: string) => { disk.set(p, c); });
  const io = { prompt: ask, filesAtTurnStart: Object.fromEntries(disk) as Record<string, string>, read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT'); return c; }, write, addModel, record: (i: { code: string; message: string }) => { issues.push(i); }, ...over };
  return { io, disk, issues, addModel, write };
}

describe('the request is recognised exactly, and only it', () => {
  it('the library screen\'s own message carries the id; a typed wish and "add to game" do not', () => {
    expect(PLAYER_FILE_PATH).toBe(GAME_PLAYER_FILE_PATH);
    expect(characterAsked(ask)).toBe(row.id);
    expect(characterAsked(addToGamePrompt(row))).toBeNull();
    expect(characterAsked('mera character badal do')).toBeNull();
    expect(characterAsked(null)).toBeNull();
    expect(librarySubjectOf('no-such-model')).toBeNull();
  });
  it('the receipt is read for THIS subject', () => {
    expect(modelWasAdded(added, subject)).toBe(true);
    expect(modelWasAdded(`Added to the game from the NavBharatAI library: other-thing.`, subject)).toBe(false);
    expect(modelWasAdded('No library model could be added this time (x)', subject)).toBe(false);
    expect(modelWasAdded('The NavBharatAI model library is not switched on for this account, so no model was added.', subject)).toBe(false);
  });
});

describe('one line of the user\'s file is set; every other byte is kept', () => {
  it('null → the subject; a second pick replaces the first; the look is untouched', () => {
    const once = setPlayerModel(GAME_PLAYER_FILE, 'knight');
    expect(once.ok && once.changed).toBe(true);
    if (!once.ok) return;
    expect(once.source).toBe(GAME_PLAYER_FILE.replace('model: null', "model: 'knight'"));
    const twice = setPlayerModel(once.source, 'robot');
    expect(twice.ok && twice.source).toBe(GAME_PLAYER_FILE.replace('model: null', "model: 'robot'"));
    const same = setPlayerModel(once.source, 'knight');
    expect(same.ok && same.changed).toBe(false);
  });
  it('a file that is no longer in a shape that can be set safely is NOT edited', () => {
    expect(setPlayerModel('export const PLAYER = makePlayer();', 'knight').ok).toBe(false);
    expect(setPlayerModel(GAME_PLAYER_FILE + "\nexport const OTHER = {\n  model: null,\n};\n", 'knight').ok).toBe(false);   // two candidates: no guess
    expect(setPlayerModel(GAME_PLAYER_FILE.replace('model: null', 'model: pick()'), 'knight').ok).toBe(false);
    expect(setPlayerModel('', 'knight').ok).toBe(false);
  });
});

describe('the turn', () => {
  it('adds that exact model, sets the player, and tells the builder it is done', async () => {
    const t = turn();
    const handoff = await setLibraryCharacterAtTurnStart(t.io);
    expect(t.addModel).toHaveBeenCalledWith(row.id);
    expect(t.disk.get(PLAYER_FILE_PATH)).toBe(GAME_PLAYER_FILE.replace('model: null', `model: '${subject}'`));
    expect(handoff).toContain('DONE BY THE PLATFORM');
    expect(handoff).toContain(`PLAYER.model = '${subject}'`);
    expect(handoff).toMatch(/Do not edit src\/game\/player\.ts/);
    expect(t.issues.map((i) => i.code)).toEqual(['PLAYER_CHARACTER_SET']);
  });
  it('the model could not be added: NOTHING is written, and the builder is told to say so and ask — not to pick another', async () => {
    for (const receipt of ['The NavBharatAI model library is not switched on for this account, so no model was added.', 'No library model could be added this time (x)']) {
      const t = turn({ addModel: vi.fn(async () => receipt) });
      const handoff = await setLibraryCharacterAtTurnStart(t.io);
      expect(t.write).not.toHaveBeenCalled();
      expect(t.disk.get(PLAYER_FILE_PATH)).toBe(GAME_PLAYER_FILE);
      expect(handoff).toContain('NOT DONE');
      expect(handoff).toMatch(/do NOT change any file on a guess/);
      expect(handoff).toMatch(/ask what they would like instead/);
      expect(t.issues.map((i) => i.code)).toEqual(['PLAYER_CHARACTER_NOT_SET']);
    }
    const thrown = turn({ addModel: vi.fn(async () => { throw new Error('sandbox gone'); }) });
    expect(await setLibraryCharacterAtTurnStart(thrown.io)).toContain('NOT DONE');
    expect(thrown.write).not.toHaveBeenCalled();
  });
  it('an id the library does not have: no model call at all', async () => {
    const t = turn({ prompt: ask.replace(row.id, 'made-up-id') });
    expect(await setLibraryCharacterAtTurnStart(t.io)).toContain('NOT DONE');
    expect(t.addModel).not.toHaveBeenCalled();
    expect(t.write).not.toHaveBeenCalled();
  });
  it('a player file the platform cannot set safely is left exactly as it is', async () => {
    const odd = 'export const PLAYER = makePlayer();';
    const t = turn({}, odd);
    expect(await setLibraryCharacterAtTurnStart(t.io)).toContain('NOT DONE');
    expect(t.disk.get(PLAYER_FILE_PATH)).toBe(odd);
  });
  it('any other turn, and a game with no player file, are not this step\'s business', async () => {
    const other = turn({ prompt: 'add coins' });
    expect(await setLibraryCharacterAtTurnStart(other.io)).toBe('');
    const none = turn({}, null);
    expect(await setLibraryCharacterAtTurnStart(none.io)).toBe('');
    expect(other.addModel).not.toHaveBeenCalled();
    expect(none.addModel).not.toHaveBeenCalled();
  });
  it('the build route runs it at the start of the turn, through the real library tool', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toMatch(/await libraryActionsAtTurnStart\(\{[\s\S]{0,700}name: 'add_library_models', input: \{ models: \[\{ id \}\] \}/);
    const growth = readFileSync(join(__dirname, '..', 'src/server/AgentV3/growthTurn.ts'), 'utf8');
    expect(growth).toMatch(/await addLibraryPlaceAtTurnStart\(io\), await setLibraryCharacterAtTurnStart\(io\)/);
  });
});

describe('🛑 nothing is changed on a guess — said on every turn of a growing game', () => {
  it('the rule is in the turn of a game that grows by lists, and not in any other project\'s', async () => {
    const { projectGrowthRules, gameTurnHandoff, GAME_NO_GUESS_RULE, GAME_FEATURES_INDEX_FILE } = await import('../src/server/AgentV3/gameKitSeed');
    const game = { [GAME_FEATURES_INDEX_FILE]: 'export const FEATURES = [];' };
    expect(projectGrowthRules(game)).toContain(GAME_NO_GUESS_RULE);
    expect(projectGrowthRules({ 'src/App.tsx': 'x' })).toBe('');
    // A turn whose words name no game ("isko accha karo") still carries it.
    expect(gameTurnHandoff('isko accha karo', game, { writingRun: true, moduleTurn: false, importTurn: false, stopped: false }).block).toContain(GAME_NO_GUESS_RULE);
    expect(GAME_NO_GUESS_RULE).toMatch(/do NOT pick one/);
    expect(GAME_NO_GUESS_RULE).toMatch(/ask ONE short question/);
    expect(GAME_NO_GUESS_RULE).toMatch(/never question a request that is already exact/);
  });
});
