// WHICH PART THE USER MEANS — BY MEANING, NOT BY THE FILE'S NAME (admin 2026-11-21: "agar user police ko 'sipahi' kahe to
// platform use nahi pehchanega … isko intention ke anusar banao").
//
// 🧬 THE CLASS: a decision about the user's intent made by matching their words against a name THEY never chose (the
// builder named the file). A part is now known by its id, its own `about` list, the USER'S OWN WORDS for it (remembered by
// the platform) and words that mean the same in English, Roman Hindi and Devanagari. When the meaning is still not clear the
// guard stays shut and asks — no model's guess opens a working part.
import { describe, it, expect } from 'vitest';
import { requestMeans, tellingWords, stem, aboutWordsIn, parsePartNames, rememberPartNames, partKnowledge, PART_NAMES_FILE } from '../src/server/AgentV3/partMeaning';
import { growthVerdict, partsKnown, requestIsAbout, mayEdit, mayRemove, growthProtectedPaths, FEATURES_INDEX } from '../src/server/AgentV3/growthGuard';
import { enforceGrowthAtTurnEnd } from '../src/server/AgentV3/growthTurn';
import { GAME_FEATURES_RULE } from '../src/server/AgentV3/gameKitSeed';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const POLICE = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'police', update() {} });\n";
const COINS = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'coins', about: ['coins', 'sikke', 'paise'], setup() {} });\n";
const WEATHER = "import { defineFeature } from '../play/features';\nexport default defineFeature({ id: 'skyFx', about: ['rain', 'storm'], update() {} });\n";
const INDEX = "import police from './police';\nimport coins from './coins';\nimport skyFx from './skyFx';\nexport const FEATURES = [police, coins, skyFx];\n";
const project = (names?: Record<string, string[]>): Record<string, string> => ({
  [FEATURES_INDEX]: INDEX, 'src/game/features/police.ts': POLICE, 'src/game/features/coins.ts': COINS, 'src/game/features/skyFx.ts': WEATHER,
  ...(names ? { [PART_NAMES_FILE]: JSON.stringify(names) } : {}),
});

describe('🧠 words that mean the same are the same subject', () => {
  it('the exact case: the part is "police", the user says "sipahi" — in Roman Hindi, in Devanagari, in English', () => {
    const known = partsKnown(project());
    for (const ask of ['sipahi ko aur tez karo', 'sipahiyon ki gaadi laal karo', 'पुलिस को तेज़ करो', 'make the cops smarter', 'cop ko hata do']) {
      expect(requestIsAbout(ask, 'police', known), ask).toBe(true);
    }
    expect(requestIsAbout('baarish daalo', 'police', known)).toBe(false);
    expect(requestIsAbout('sikke badhao', 'police', known)).toBe(false);
  });

  it('the guard opens for the meaning, and stays shut for everything else', () => {
    const known = partsKnown(project());
    expect(mayEdit('sipahi ko tez karo', 'police', known)).toBe(true);
    expect(mayRemove('sipahi hata do', 'police', known)).toBe(true);
    expect(mayRemove('sipahi ko tez karo', 'police', known)).toBe(false);        // meaning opens an edit, never a removal by itself
    const v = (request: string) => growthVerdict({ path: 'src/game/features/police.ts', before: POLICE, after: 'changed', request, known });
    expect(v('sipahi thode kam karo').allow).toBe(true);
    expect(v('paise ka rang badlo').allow).toBe(false);                           // that is about coins
    expect(growthVerdict({ path: 'src/game/features/coins.ts', before: COINS, after: 'changed', request: 'paise ka rang badlo', known }).allow).toBe(true);
  });

  it('a part says what it is in its own `about` list — whatever its file is called', () => {
    expect(aboutWordsIn(WEATHER)).toEqual(['rain', 'storm']);
    const known = partsKnown(project());
    expect(requestIsAbout('baarish zyada karo', 'skyFx', known)).toBe(true);     // "skyFx" says nothing; about + meaning do
    expect(requestIsAbout('toofan lao', 'skyFx', known)).toBe(true);
    expect(GAME_FEATURES_RULE).toMatch(/Give every feature about: the words the user used for it/);
    expect(generateGameShell().files['src/game/play/features.ts']).toMatch(/about\?: string\[\];/);
  });
});

describe('📒 the user\'s own words are remembered', () => {
  it('a word no table knows: the user called it "chowkidar", so "chowkidar" is that part from then on', () => {
    expect(requestIsAbout('chowkidar ko tez karo', 'police', partsKnown(project()))).toBe(false);     // nothing says so yet
    const names = { police: ['chowkidar daalo jo raat ko gasht kare'] };
    const known = partsKnown(project(names));
    expect(requestIsAbout('chowkidar ko tez karo', 'police', known)).toBe(true);
    expect(requestIsAbout('gasht ka rasta badlo', 'police', known)).toBe(true);
    expect(requestIsAbout('chowkidar ko tez karo', 'coins', known)).toBe(false);
  });

  it('the platform files a NEW part under what the user asked for, and a part they spoke of under those words too', async () => {
    const start = project();
    const disk = new Map(Object.entries(start));
    disk.set('src/game/features/guard.ts', "export default { id: 'guard' };");
    await enforceGrowthAtTurnEnd({ filesAtTurnStart: start, request: 'ek chowkidar daalo jo sikke bachaye', read: async (p) => { const c = disk.get(p); if (c === undefined) throw new Error(`ENOENT ${p}`); return c; },
      write: async (p, c) => { disk.set(p, c); }, platformWrote: new Map(), refused: [], written: ['src/game/features/guard.ts', FEATURES_INDEX], record: () => undefined, say: () => undefined });
    const names = parsePartNames(disk.get(PART_NAMES_FILE));
    expect(names.guard).toEqual(['ek chowkidar daalo jo sikke bachaye']);       // the new part
    expect(names.coins).toEqual(['ek chowkidar daalo jo sikke bachaye']);       // "sikke" was about coins
    expect(names.police).toBeUndefined();
    // Next turn, from the saved project: "chowkidar" means the new part.
    const next = partsKnown(Object.fromEntries(disk));
    expect(requestIsAbout('chowkidar ko bada karo', 'guard', next)).toBe(true);
  });

  it('a first build files its parts too; the record is bounded, and only the platform writes it', async () => {
    const disk = new Map<string, string>([[FEATURES_INDEX, INDEX], ['src/game/features/police.ts', POLICE]]);
    await enforceGrowthAtTurnEnd({ filesAtTurnStart: {}, request: 'gta jaisa game banao', read: async (p) => { const c = disk.get(p); if (c === undefined) throw new Error(`ENOENT ${p}`); return c; },
      write: async (p, c) => { disk.set(p, c); }, platformWrote: new Map(), refused: [], written: [FEATURES_INDEX, 'src/game/features/police.ts'], record: () => undefined, say: () => undefined });
    expect(parsePartNames(disk.get(PART_NAMES_FILE)).police).toEqual(['gta jaisa game banao']);
    let rec: string | undefined;
    for (let i = 0; i < 20; i++) rec = rememberPartNames(rec, ['police'], `saying ${i} ${'x'.repeat(500)}`);
    expect(parsePartNames(rec).police).toHaveLength(6);
    expect(parsePartNames(rec).police[0].length).toBeLessThanOrEqual(240);
    expect(parsePartNames('not json')).toEqual({});
    const start = project({ police: ['sipahi'] });
    expect(growthProtectedPaths(start)).toContain(PART_NAMES_FILE);
    expect(growthVerdict({ path: PART_NAMES_FILE, before: start[PART_NAMES_FILE], after: '{}', request: 'sab badal do' })).toMatchObject({ allow: false, restore: start[PART_NAMES_FILE] });
  });
});

describe('🧠 what never decides', () => {
  it('words that say nothing, and words every part shares', () => {
    expect(tellingWords('game me kuch naya add karo please')).toEqual([]);
    expect(stem('sipahiyon')).toBe('sipahi');
    expect(stem('gaadiyan')).toBe('gaadi');
    expect(stem('coins')).toBe('coin');
    // The first build's request is in every part's record: it singles out none of them.
    const said = 'gta jaisa shehar wala game banao';
    const known = partsKnown(project({ police: [said], coins: [said], skyFx: [said] }));
    for (const id of ['police', 'coins', 'skyFx']) expect(requestIsAbout('shehar bada karo', id, known), id).toBe(false);
    expect(requestIsAbout('sipahi tez karo', 'police', known)).toBe(true);        // …and meaning still works beside it
  });

  it('unclear stays shut: an unknown word opens nothing (the platform asks instead)', () => {
    const known = partsKnown(project());
    expect(requestMeans('woh wali cheez theek se nahi lag rahi', ['police'], [])).toBe(false);
    for (const id of ['police', 'coins', 'skyFx']) expect(requestIsAbout('thingamajig ko badlo', id, known), id).toBe(false);
    expect(partKnowledge(project()).get('police')!.vocabulary).toEqual(['police']);
  });
});
