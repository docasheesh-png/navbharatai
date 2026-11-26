// 🔴 "BUBG" IS PUBG, AND A BIG MAP IS NOT A 2D TOP-DOWN WORLD (failedbr #2497, 2026-11-22).
//
// "ek bahut bada map par bubg jaisa game banao!!" (a PUBG-like game on a very big map; "bubg" is PUBG typed by ear) became
// GAME_CONTRACT {genre: unknown, dimension: unspecified}, and the kit seeded generate_game_runtime, generate_game_vfx,
// generate_melody and generate_world_2d — a 2D top-down game. The admin: "ye pubg ki jagah kya bana diya".
//
// Three classes, each locked here:
//   1. TITLE RECOGNITION WAS EXACT-SPELLING ONLY, in six private lists. Now ONE tolerant matcher (lib/wellKnownGameTitles)
//      reads every title, and every reader asks it. Proven with Hinglish spellings AND a negative corpus of ordinary words
//      and real non-game prompts (tests/fixtures), and by a census that fails when a private title regex comes back.
//   2. A BIG MAP WITH NO STATED VIEW WAS DRAWN 2D, while the map profile read it as a 3D open world. Now one explicit rule
//      (gameKitSeed.bigWorldIsDrawnIn3D): a big world is 3D unless 2D, top-down, a 2D world or a flat genre is named.
//   3. A NAME WE DO NOT KNOW ("zorbix jaisa game") was silently built as anything. Now the contract carries it and the
//      builder is told to ask instead of guessing.
//
// Reversion (each proven while writing this file): put `\bpubg\b` back as the only PUBG spelling → the #2497 block fails;
// drop `bigWorldIsDrawnIn3D` from gameKitWants3D → the big-map block fails; drop `unrecognisedReference` from the contract →
// the ask block fails; make PUBG fuzzy with MIN_FUZZY_LENGTH 3 → "pub", "pug", "PBG tender" become PUBG and the negative
// block fails; empty ORDINARY_WORDS → "candy crust" becomes Candy Crush.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findGameTitles, mentionsBattleRoyale, namesGtaTitle, namesWellKnownGame, unrecognisedGameReference } from '../src/server/lib/wellKnownGameTitles';
import { asksForBattleRoyale, buildGameContract, gameContractBlock, namedGameReference } from '../src/server/AgentV3/gameIntent';
import { bigWorldIsDrawnIn3D, gameKitPlan, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';
import { world2dIntent } from '../src/server/AgentV3/world2dIntent';
import { mapProfileFor } from '../src/server/lib/athreeMap/athreeMapIntent';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { realismIntent } from '../src/server/lib/realismIntent';
import { needsHumanCharacter } from '../src/server/AgentV3/gameAssets/humanPack';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';

const ROOT = join(__dirname, '..');
/** The report's own words, verbatim. */
const REAL_PROMPT = readFileSync(join(ROOT, 'tests/fixtures/failedbr2497.prompt.txt'), 'utf8').trim();

describe('failedbr #2497 — the real prompt is a PUBG-like 3D game on the big map', () => {
  it('the prompt is the report\'s own', () => {
    expect(REAL_PROMPT).toBe('ek bahut bada map par bubg jaisa game banao!!');
  });
  it('the contract names PUBG as the reference: a 3D third-person shooter', () => {
    const c = buildGameContract(REAL_PROMPT);
    expect(c.reference).toBe('PUBG');
    expect(c.genre).toBe('shooter');
    expect(c.dimension).toBe('3d');
    expect(c.camera).toBe('third-person');
    expect(c.unrecognisedReference).toBeUndefined();
  });
  it('the kit is the 3D big-map kit with the player on foot — never the 2D world', () => {
    const plan = gameKitPlan(REAL_PROMPT);
    expect(plan).toContain('generate_game_3d');
    expect(plan).toContain('generate_game_shell');
    expect(plan).not.toContain('generate_world_2d');
    expect(gameKitWants3D(REAL_PROMPT)).toBe(true);
    expect(mapProfileFor(REAL_PROMPT)).toBe('battle-royale');
  });
  it('every reader agrees it is a royale', () => {
    expect(asksForBattleRoyale(REAL_PROMPT)).toBe(true);
    expect(namesWellKnownGame(REAL_PROMPT)).toBe(true);
    expect(needsHumanCharacter({ prompt: REAL_PROMPT })).toBe(true);
    expect(analyzeAppScope(REAL_PROMPT).famousApp).toBe('PUBG');
    expect(realismIntent(REAL_PROMPT).tier).toBe('real');
  });
});

describe('one tolerant matcher reads the spellings people actually type', () => {
  it.each([
    ['bubg', 'PUBG'], ['pabji', 'PUBG'], ['pubji', 'PUBG'], ['pub-g', 'PUBG'], ['P.U.B.G', 'PUBG'], ['pubgg', 'PUBG'],
    ['pbg game', 'PUBG'], ['पबजी', 'PUBG'],
    ['bgmi', 'BGMI'], ['bgmii', 'BGMI'], ['bgmmi', 'BGMI'], ['b g m i', 'BGMI'],
    ['free fire', 'Free Fire'], ['frie fire', 'Free Fire'], ['free fair', 'Free Fire'], ['freefire', 'Free Fire'], ['fri fire', 'Free Fire'], ['free-fire', 'Free Fire'], ['फ्री फायर', 'Free Fire'],
    ['gta', 'GTA'], ['gtaa', 'GTA'], ['g.t.a', 'GTA'], ['gta5', 'GTA'], ['gta vice city', 'GTA'], ['जीटीए', 'GTA'],
    ['minecraft', 'Minecraft'], ['minecraf', 'Minecraft'], ['maincraft', 'Minecraft'], ['mine craft', 'Minecraft'], ['minecrft', 'Minecraft'],
    ['counter strik', 'Counter-Strike'], ['valoront', 'Valorant'], ['subway surfar', 'Subway Surfers'],
  ])('%s → %s', (spelling, name) => {
    expect(findGameTitles(`${spelling} jaisa game banao`).map((m) => m.name)).toContain(name);
  });

  it.each(['bubg', 'pabji', 'bgmii', 'frie fire', 'free fair'])('"%s jaisa game" is a royale to every royale reader', (s) => {
    const p = `${s} jaisa game banao`;
    expect(mentionsBattleRoyale(p)).toBe(true);
    expect(namedGameReference(p)?.dimension).toBe('3d');
    expect(gameKitWants3D(p)).toBe(true);
  });

  it.each(['gtaa jaisa game', 'g.t.a jaisa game banao'])('"%s" is GTA to the GTA reader, the map and the kit', (p) => {
    expect(namesGtaTitle(p)).toBe(true);
    expect(mapProfileFor(p)).toMatch(/open-world|explore/);
    expect(gameKitWants3D(p)).toBe(true);
  });

  it('a typed title is never an unknown outside service', () => {
    expect(unknownNamesInRequest('BUBG jaisa game banao')).toEqual([]);
    expect(unknownNamesInRequest('mujhe PABJI wala game chahiye')).toEqual([]);
  });
});

describe('ordinary words never become a title (the tolerance is bounded)', () => {
  it.each([
    'fix the bug in my app', 'a pub finder app', 'bus ticket booking app', 'a big calculator', 'fire safety checklist',
    'free time tracker', 'a bag shop', 'page builder', 'pug adoption site', 'gate pass app', 'data entry form', 'mine safety app',
    'craft store', 'a fortunate cookie app', 'once a fortnight reminder', 'free hire job portal', 'code mobile app for my shop',
    'temple ruins tourism guide', 'minecart physics demo', 'a valiant knight story', 'PBG tender tracker', 'bgm add karo',
    'BMI calculator', 'gate exam prep', 'big mi phone review site',
    'candy crust bakery menu', 'upload a freefile backup',
  ])('"%s" names no game title', (p) => {
    expect(findGameTitles(p)).toEqual([]);
    expect(mentionsBattleRoyale(p)).toBe(false);
  });

  it('a corpus of real non-game prompts (tests/fixtures) names no title', () => {
    const dir = join(ROOT, 'tests/fixtures');
    const prompts = readdirSync(dir).filter((n) => /prompt|Prompt|step1/.test(n) && n !== 'failedbr2497.prompt.txt');
    expect(prompts.length).toBeGreaterThan(15);
    for (const n of prompts) {
      const t = readFileSync(join(dir, n), 'utf8');
      expect(findGameTitles(t), n).toEqual([]);
      expect(namesWellKnownGame(t), n).toBe(false);
    }
  });
});

describe('a big map with no stated view is the 3D big map; 2D only when 2D is asked', () => {
  it.each(['ek bahut bada map wala game banao', 'make a game with a huge world', 'ek game jisme kahin bhi ghoom sakun'])('3D: %s', (p) => {
    expect(bigWorldIsDrawnIn3D(p)).toBe(true);
    expect(gameKitPlan(p)).toContain('generate_game_3d');
    expect(gameKitPlan(p)).not.toContain('generate_world_2d');
  });
  it.each([
    '2D game banao jiska map bahut bada ho',
    'top-down RPG game with a huge world to explore',
    'make a 2D survival game where the map never ends',
    'mario jaisa game with a huge map',
  ])('the 2D world stays where 2D, top-down or a flat genre is named: %s', (p) => {
    expect(bigWorldIsDrawnIn3D(p)).toBe(false);
    expect(gameKitPlan(p)).toContain('generate_world_2d');
  });
  it('the contract the builder reads says the same view the kit was laid for (one rule, gameIntent.bigWorldWantsThreeD)', () => {
    expect(buildGameContract('ek bahut bada map wala game banao').dimension).toBe('3d');
    expect(buildGameContract('2D game banao jiska map bahut bada ho').dimension).toBe('2d');
    expect(buildGameContract('mario jaisa game with a huge map').dimension).toBe('unspecified');
    expect(buildGameContract('top-down RPG game with a huge world to explore').dimension).toBe('unspecified');
  });
  it('a complaint about an existing world\'s size is an edit, never a switch to 3D', () => {
    expect(bigWorldIsDrawnIn3D('is game ka map bahut chhota hai, bada karo')).toBe(false);
  });
  it('the 2D world reader is never handed a big-map game the kit draws in 3D', () => {
    const p = 'ek bahut bada map wala game banao';
    expect(world2dIntent({ prompt: p, drawnIn3D: gameKitWants3D(p) }).use).toBe(false);
  });
  it('our own milestone identity lines are not the user\'s wish (BR1958 F3 keeps its 2D milestone)', () => {
    expect(bigWorldIsDrawnIn3D('Create a basic HTML5 canvas game.\nThe player is on foot on the big map.')).toBe(false);
  });
});

describe('a name we do not recognise is asked about, never guessed', () => {
  it('the contract carries it and the builder is told to ask', () => {
    const c = buildGameContract('zorbix jaisa game banao');
    expect(c.unrecognisedReference).toBe('zorbix');
    const block = gameContractBlock(c);
    expect(block).toMatch(/does not recognise that name/);
    expect(block).toMatch(/Do NOT guess what it is/);
    expect(block).toMatch(/ask ONE short question/);
  });
  it('a game like X (English order) too', () => {
    expect(unrecognisedGameReference('make a game like zorbix')).toBe('zorbix');
  });
  it.each(['bubg jaisa game banao', 'mere jaisa game banao', 'pehle jaisa game kar do', 'car racing jaisa game banao', 'mario jaisa game'])('no unknown name: %s', (p) => {
    expect(buildGameContract(p).unrecognisedReference).toBeUndefined();
  });
});

describe('🔒 census — no reader keeps a private exact-spelling title list', () => {
  // A title regex anywhere but the catalogue is the class #2497 came from. Comments are stripped; files that only carry
  // data or prompt text (keywords for the AI, sound tags, the model's own instructions) are listed with their reason.
  const ALLOWED: Record<string, string> = {
    'src/server/lib/wellKnownGameTitles.ts': 'THE catalogue',
    'src/server/AppContext/AppKnowledgeBase.ts': 'search keywords for the app\'s AIs, not a reader',
    'src/server/AgentV3/gameAssets/soundLibraryCatalogue.ts': 'sound tags',
    'src/server/AgentV3/weakBuildAdmission.ts': 'a model prompt\'s examples',
    'src/server/lib/GameOpenWorldGenerator.ts': 'text the builder reads',
    'src/server/lib/GameShellGenerator.ts': 'generated game source',
    'src/server/AgentV3/unknownName.ts': 'acronyms the catalogue does not hold (NFS, FIFA…); titles route through findGameTitles',
    'src/server/lib/appScopeAnalyzer.ts': 'names catalogue entries by name ({ title: \'PUBG\' })',
    'src/server/lib/realismIntent.ts': 'names catalogue entries by name',
    'src/server/AgentV3/gameCoverage.ts': 'benchmark prompts written the way users type them (data, read through the shared matcher)',
  };
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const TITLE = /pubg|bgmi|minecraft|fortnite|free\\s\*\??fire|\\bgta(?!g)|valorant|call\\s\+of\\s\+duty|temple\\s\+run|subway\\s\*surf/i;
  it('every title is read by the shared matcher', () => {
    const offenders = walk(join(ROOT, 'src')).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))
      .filter((rel) => !(rel in ALLOWED) && TITLE.test(strip(readFileSync(join(ROOT, rel), 'utf8'))));
    expect(offenders).toEqual([]);
  });
  it('the census sees a private list when one is written', () => {
    expect(TITLE.test(strip('const MY_TITLES = /\\bpubg\\b|minecraft/i;'))).toBe(true);
    expect(TITLE.test(strip('// a comment about pubg'))).toBe(false);
  });
});
