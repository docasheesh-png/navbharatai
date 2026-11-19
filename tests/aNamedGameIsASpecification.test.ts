// 🔴 "PUBG/BGMI JAISA GAME" IS A SPECIFICATION, AND "ENTER BATTLEGROUND" STARTS IT (autopsy aba63ead,
// failedbr #2475, 2026-11-19).
//
// The real prompt became {genre: unknown, dimension: unspecified, camera: unspecified}: the builder kept the
// project's 2D city map as "the game" ("apne pata nahi kya photo bana diya hai"). And the playtest, whose start
// stems knew "play" and "race" but not "enter", never pressed "Enter Battleground" — although the click explorer
// had pressed it and seen a game screen with "Quit Game" on it — and filed GAME_PLAYTEST_NOT_RUN.
// Reversion: drop BATTLE_ROYALE_REFERENCE from NAMED_GAMES, or "enter" from START_STEM together with
// `opensGameSession`, and the matching block fails.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asksForBattleRoyale, buildGameContract, gameContractBlock, namedGameReference } from '../src/server/AgentV3/gameIntent';
import { opensGameSession, startLabelRank, startLabelsFromExplore } from '../src/server/AgentV3/gamePlaytest';
import { mapProfileFor } from '../src/server/lib/athreeMap/athreeMapIntent';
import { sceneryFor } from '../src/server/AgentV3/gameAssets/worldDressing';
import { needsHumanCharacter } from '../src/server/AgentV3/gameAssets/humanPack';
import { gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';

/** The report's own words, verbatim. */
const REAL_PROMPT = 'mujhe pubg/bgmi jaisa game chahiye. jahan ham character ko joystick se move kare! \napne pata nahi kya photo bana diya hai,';

describe('the scope contract reads a named royale title', () => {
  it('the #2475 prompt: a 3D third-person shooter on touch, naming its reference', () => {
    const c = buildGameContract(REAL_PROMPT);
    expect(c.genre).toBe('shooter');
    expect(c.dimension).toBe('3d');
    expect(c.camera).toBe('third-person');
    expect(c.controls).toEqual(['touch']);
    expect(c.reference?.toLowerCase()).toBe('pubg');
  });

  it('the builder is told the PLAYABLE game must come first, and never to copy the named title', () => {
    const block = gameContractBlock(buildGameContract(REAL_PROMPT));
    expect(block).toMatch(/ORIGINAL 3D shooter game/);
    expect(block).toMatch(/never its name, characters, art or maps/);
    expect(block).toMatch(/must be the first screen or one press away/);
    expect(block).toMatch(/A map, a menu, a list or a picture standing in for the game is not the game/);
  });

  it.each([
    ['free fire jaisa game banao', 'shooter', '3d'],
    ['make a battle royale game', 'shooter', '3d'],
    ['फ्री फायर जैसा गेम', 'shooter', '3d'],
    ['पबजी जैसा गेम बनाओ', 'shooter', '3d'],
    ['a game like fortnite', 'shooter', '3d'],
    ['valorant jaisa game', 'shooter', '3d'],
  ])('%s → %s / %s', (prompt, genre, dim) => {
    const c = buildGameContract(prompt);
    expect(c.genre).toBe(genre);
    expect(c.dimension).toBe(dim);
  });

  it("the request's own explicit words still win over the reference", () => {
    expect(buildGameContract('a 2D pubg style top-down game').dimension).toBe('2d');
    expect(buildGameContract('a 2D pubg style top-down game').camera).toBe('top-down');
    expect(buildGameContract('pubg jaisa racing game').genre).toBe('racing');
    expect(buildGameContract('valorant style fps').camera).toBe('first-person');
  });

  it('nothing changes for a request that names no title (no invented reference)', () => {
    const c = buildGameContract('make a snake game with score');
    expect(c.reference).toBeUndefined();
    expect(c.genre).toBe('snake');
    expect(namedGameReference('a calculator app')).toBeNull();
  });
});

describe('one reader for "a royale-style game" — every consumer agrees', () => {
  it('the map profile, the scenery and the contract all read #2475 as a royale', () => {
    expect(asksForBattleRoyale(REAL_PROMPT)).toBe(true);
    expect(mapProfileFor(REAL_PROMPT)).toBe('battle-royale');
    // A royale is a lived-in world, not a firing range (naming PUBG now reads as 'shooter').
    expect(sceneryFor(REAL_PROMPT)?.layout).toBe('village');
    expect(sceneryFor('make a shooting game with targets')?.layout).toBe('range');
  });

  it('a prompt that names only BGMI gets the 3D kit and human characters (both private lists lacked "bgmi")', () => {
    const bgmiOnly = 'mujhe bgmi jaisa game chahiye';
    expect(gameKitWants3D(bgmiOnly)).toBe(true);
    expect(needsHumanCharacter({ prompt: bgmiOnly })).toBe(true);
    expect(gameKitWants3D(REAL_PROMPT)).toBe(true);
  });

  it('no module keeps a private royale regex any more (census — a new copy fails here)', () => {
    const files = [
      'src/server/lib/athreeMap/athreeMapIntent.ts',
      'src/server/AgentV3/ToolDispatcher.ts',
      'src/server/AgentV3/gameAssets/worldDressing.ts',
      'src/server/AgentV3/gameAssets/humanPack.ts',
      'src/server/AgentV3/gameKitSeed.ts',
    ];
    for (const f of files) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(src, f).not.toMatch(/battle\\s\*royale\|/);
      expect(src, f).not.toMatch(/\\bpubg\\b\|\\bbgmi/);
      expect(src, f).not.toMatch(/\|pubg\||free\\s\*-\?\\s\*fire\|battle/);
    }
  });
});

describe('the playtest finds the way into an arena / royale game', () => {
  it('"Enter Battleground" is a start control', () => {
    expect(startLabelRank('Enter Battleground')).toBe(2);
    for (const l of ['Join Match', 'Deploy', 'Drop In', 'Find Match', 'Enter Arena', 'Battle!', 'Spawn']) {
      expect(startLabelRank(l), l).toBeGreaterThan(0);
    }
  });

  it('what is not a start stays not a start', () => {
    for (const l of ['Settings', 'Quit Game', 'Delete save', 'Buy coins', 'How to play', 'Leaderboard']) {
      expect(startLabelRank(l), l).toBe(0);
    }
  });

  // The explorer's real record from #2475, trimmed to the presses that matter.
  const PRESSES = [
    { label: 'Move to New Delhi (Capital)', verdict: 'ok', changed: true },
    { label: 'Move to Mumbai', verdict: 'covered', changed: false },
    { label: 'Enter Battleground', verdict: 'ok', changed: true },
    { label: 'Quit Game', verdict: 'ok', changed: true, via: 'Enter Battleground' },
  ];

  it('the explorer vouches for the control that opened a screen with a game-session control', () => {
    expect(startLabelsFromExplore(PRESSES)).toContain('Enter Battleground');
    expect(startLabelsFromExplore(PRESSES)).not.toContain('Move to Mumbai');
  });

  it('EVIDENCE, NOT VOCABULARY: a start with no known stem is still vouched when it opened a game session', () => {
    const presses = [
      { label: 'Warp Into Zone', verdict: 'ok', changed: true },
      { label: 'Pause', verdict: 'ok', changed: true, via: 'Warp Into Zone' },
    ];
    expect(startLabelRank('Warp Into Zone')).toBe(0);
    expect(opensGameSession('Warp Into Zone', presses)).toBe(true);
    expect(startLabelsFromExplore(presses)).toEqual(['Warp Into Zone']);
  });

  it('never vouches for a control that must never be pressed or says it is something else', () => {
    const presses = [
      { label: 'Buy Battle Pass', verdict: 'ok', changed: true },
      { label: 'Quit Game', verdict: 'ok', changed: true, via: 'Buy Battle Pass' },
      { label: 'Settings', verdict: 'ok', changed: true },
      { label: 'Pause', verdict: 'ok', changed: true, via: 'Settings' },
    ];
    expect(startLabelsFromExplore(presses)).toEqual([]);
  });
});
