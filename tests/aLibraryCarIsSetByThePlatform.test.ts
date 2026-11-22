// 🏁 A CAR PICKED IN THE GAME LIBRARY IS SET BY THE PLATFORM — AND NOTHING IS CHANGED ON A GUESS (admin 2026-11-22: "user puri
// racing game ko bhi AI se modified karwa sake, jaise chahe sab free hand do!").
//
// The racing sibling of aLibraryCharacterIsSetByThePlatform. "Use as my car" names one exact library model; the platform
// adds it and sets CAR.model in src/game/car.ts (or writes that small file when the game has none). Where it cannot, it
// changes nothing and the builder is told to say so and ask. And the rule the builder reads on every race turn maps the
// user's requests to these paths instead of caging them in the library.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { carAsked, useAsCarPrompt, setCarModel, raceCarFile, setLibraryCarAtTurnStart, CAR_FILE_PATH, racesOnTheStarter } from '../src/server/AgentV3/carSwap';
import { librarySubjectOf } from '../src/server/AgentV3/characterSwap';
import { libraryActionsAtTurnStart } from '../src/server/AgentV3/growthTurn';
import { useAsCharacterPrompt, addToGamePrompt, libraryBrowseRows, mapPlaceRows } from '../src/server/AgentV3/gameAssets/libraryThumbnails';
import { RACE_ROAD_RULE, GAME_NO_GUESS_RULE, projectGrowthRules } from '../src/server/AgentV3/gameKitSeed';
import { parseLibraryResponse } from '../src/components/agentv3/GameLibraryPicker';

const row = libraryBrowseRows(undefined, () => false)[0];
const subject = librarySubjectOf(row.id)!;
const ask = useAsCarPrompt(row)!;
const added = `Added to the game from the NavBharatAI library: ${subject}. Use them with: …`;
const RACE_APP = "import { RacingRoadGame } from './game/RacingRoadGame';\nexport default function App() { return <RacingRoadGame />; }\n";

function turn(over: Partial<Parameters<typeof setLibraryCarAtTurnStart>[0]> = {}, file: string | null = null, app = RACE_APP) {
  const disk = new Map<string, string>([['src/App.tsx', app], ...(file === null ? [] : [[CAR_FILE_PATH, file] as [string, string]])]);
  const issues: Array<{ code: string; message: string }> = [];
  const addModel = vi.fn(async () => added);
  const write = vi.fn(async (p: string, c: string) => { disk.set(p, c); });
  const io = { prompt: ask, filesAtTurnStart: Object.fromEntries(disk) as Record<string, string>, read: async (p: string) => { const c = disk.get(p); if (c === undefined) throw new Error('ENOENT: no such file'); return c; }, write, addModel, record: (i: { code: string; message: string }) => { issues.push(i); }, ...over };
  return { io, disk, issues, addModel, write };
}

describe('the request is recognised exactly, and only it', () => {
  it('"Use as my car" carries the id; the character request, "add to game" and a typed wish do not', () => {
    expect(carAsked(ask)).toBe(row.id);
    expect(carAsked(useAsCharacterPrompt(row))).toBeNull();
    expect(carAsked(addToGamePrompt(row))).toBeNull();
    expect(carAsked('meri gaadi badal do')).toBeNull();
    expect(carAsked(null)).toBeNull();
    for (const place of mapPlaceRows()) expect(useAsCarPrompt(place)).toBeNull();
  });
  it('only a race on the starter has a car file', () => {
    expect(racesOnTheStarter({ 'src/App.tsx': RACE_APP })).toBe(true);
    expect(racesOnTheStarter({ 'src/App.tsx': 'export default function App() { return <OpenWorldGame />; }' })).toBe(false);
    expect(racesOnTheStarter(null)).toBe(false);
  });
});

describe('one line of the user\'s car file is set; every other byte is kept', () => {
  it('no file yet → the whole small file, with the model; a file → only its model line', () => {
    const fresh = setCarModel(null, 'sports car');
    expect(fresh).toEqual({ ok: true, changed: true, source: raceCarFile('sports car') });
    expect(raceCarFile('sports car')).toMatch(/export const CAR: CarChoice = \{\n {2}color: 0xb42b2b,\n {2}model: 'sports car',\n {2}modelLength: 4\.3,\n\};/);
    expect(raceCarFile()).toMatch(/model: null,/);
    const mine = "import type { CarChoice } from './play/raceCustom';\nexport const CAR: CarChoice = {\n  color: 0x1e88e5,\n  model: null,\n  tuning: { maxSpeed: 40 },\n};\n";
    const once = setCarModel(mine, 'truck');
    expect(once.ok && once.source).toBe(mine.replace('model: null', "model: 'truck'"));
    expect(setCarModel(mine.replace('model: null', "model: 'truck'"), 'truck')).toMatchObject({ ok: true, changed: false });
  });
  it('a file no longer in a shape that can be set safely is NOT edited', () => {
    expect(setCarModel('export const CAR = makeCar();', 'truck').ok).toBe(false);
    expect(setCarModel(raceCarFile() + 'export const OTHER = {\n  model: null,\n};\n', 'truck').ok).toBe(false);
  });
});

describe('the platform does it at the start of the turn', () => {
  it('a race with no car file: the model is added, the file is written, the builder is told it is DONE', async () => {
    const t = turn();
    const handoff = await setLibraryCarAtTurnStart(t.io);
    expect(t.addModel).toHaveBeenCalledWith(row.id);
    expect(t.disk.get(CAR_FILE_PATH)).toBe(raceCarFile(subject));
    expect(handoff).toMatch(/^\[DONE BY THE PLATFORM — the user's car\]/);
    expect(handoff).toContain(`CAR.model = '${subject}'`);
    expect(t.issues.map((i) => i.code)).toEqual(['RACE_CAR_SET']);
  });
  it('it runs through the one library-actions call the build route makes', async () => {
    const t = turn({}, raceCarFile());
    expect(await libraryActionsAtTurnStart(t.io)).toMatch(/DONE BY THE PLATFORM — the user's car/);
    expect(t.disk.get(CAR_FILE_PATH)).toBe(raceCarFile(subject));
  });
  it('🔴 where it cannot, NOTHING is written and the builder is told to say so and ask', async () => {
    const notRace = turn({}, null, 'export default function App() { return <OpenWorldGame />; }');
    expect(await setLibraryCarAtTurnStart(notRace.io)).toMatch(/^\[NOT DONE — the user's car\][\s\S]*not a race on NavBharatAI's racing starter/);
    expect(notRace.addModel).not.toHaveBeenCalled();
    const failed = turn({ addModel: vi.fn(async () => 'No library model could be added this time (quota)') });
    expect(await setLibraryCarAtTurnStart(failed.io)).toMatch(/could not be added to the game/);
    expect(failed.write).not.toHaveBeenCalled();
    const odd = turn({}, 'export const CAR = makeCar();');
    expect(await setLibraryCarAtTurnStart(odd.io)).toMatch(/no longer in the shape the platform can set safely/);
    expect(odd.write).not.toHaveBeenCalled();
    const unreadable = turn({ read: async () => { throw new Error('sandbox timed out'); } });
    expect(await setLibraryCarAtTurnStart(unreadable.io)).toMatch(/could not be read/);
    expect(unreadable.write).not.toHaveBeenCalled();
    const unknown = turn({ prompt: ask.replace(row.id, 'no-such-model') });
    expect(await setLibraryCarAtTurnStart(unknown.io)).toMatch(/not a model in the NavBharatAI library/);
    expect(await setLibraryCarAtTurnStart(turn({ prompt: 'meri gaadi badal do' }).io)).toBe('');
  });
});

describe('the screen offers it and the route sends it', () => {
  it('"Use as my car" is a mode of the library screen; the route sends carPrompts', () => {
    const picker = readFileSync('src/components/agentv3/GameLibraryPicker.tsx', 'utf8');
    expect(picker).toContain("['car', 'Use as my car']");
    expect(picker).toMatch(/use === 'car' \? data\.carPrompts\[row\.id\]/);
    expect(readFileSync('src/server/routes/agentv3.ts', 'utf8')).toMatch(/carPrompts: Object\.fromEntries\(result\.rows\.flatMap\(\(r\) => \{ const text = useAsCarPrompt\(r\)/);
    const body = { enabled: true, rows: [], total: 0, categories: [], prompts: {}, characterPrompts: {}, carPrompts: { a: 'drive', b: 3 } };
    expect(parseLibraryResponse(body)?.carPrompts).toEqual({ a: 'drive' });
    expect(parseLibraryResponse({ ...body, carPrompts: undefined })?.carPrompts).toEqual({});   // an older server is not an error
  });
});

describe('🔓 the race rule is a map of paths, not a cage', () => {
  it('the library is the starting point and a clear request wins; the old "never hand-build a second track" is gone', () => {
    expect(RACE_ROAD_RULE).toMatch(/only the STARTING POINT — anything the user clearly asks about the race is done/);
    expect(RACE_ROAD_RULE).not.toMatch(/Never hand-build a second track/);
    expect(RACE_ROAD_RULE).toMatch(/raise finishKm/);
    // No flat ban on a change the user asks for (rule audit #4437): shorter is as valid as longer.
    expect(RACE_ROAD_RULE).toMatch(/"race chhoti karo"\s*→ lower finishKm/);
    expect(RACE_ROAD_RULE).not.toMatch(/shorten the road|Never hand-build|never build a second/i);
    for (const ban of RACE_ROAD_RULE.match(/[Nn]ever [^,.;]*/g) ?? []) expect(ban).toMatch(/^[Nn]ever (?:ends|refuse|swap|fake)/);
  });
  it('names each path: the car file and its fields, an attached or library model, the track file, laps, and everything else in code', () => {
    for (const part of ['src/game/car.ts', 'CAR.color', 'CAR.tuning', 'CAR.model', 'CAR.modelYaw: 180', '[USER MODELS ADDED]', 'add_library_models first',
      'src/game/track.ts', 'TRACK.model', 'TRACK.laps', 'TRACK.line', 'says ON SCREEN why it cannot', 'never fake a line', 'opponents', 'the plan prop',
      'weather, time of day, camera, HUD, rules', 'edit src/game/RacingRoadGame.tsx itself']) expect(RACE_ROAD_RULE).toContain(part);
  });
  it('a race turn also carries the no-guess rule (ask when a request can mean two things)', () => {
    const rules = projectGrowthRules({ 'src/App.tsx': RACE_APP });
    expect(rules).toContain(RACE_ROAD_RULE);
    expect(rules).toContain(GAME_NO_GUESS_RULE);
    expect(projectGrowthRules({ 'src/App.tsx': 'x' })).toBe('');
  });
});
