// A FEATURE NEVER LAYS ITS OWN LAND IN AN OPEN WORLD (failedbr #2495/#2501 autopsy). Asked for a grass field in the middle of
// an open-world map, the builder added a feature with a flat 2 km PlaneGeometry at y = -0.1: the map's hills cut through it and
// the sea showed grass under it. The rule is said on every turn of an open world — in Hindi and English alike — and never in
// another game, and it leaves small flat planes (signs, decals, screens, the HUD) alone.
import { describe, it, expect } from 'vitest';
import {
  gameTurnHandoff, projectGrowthRules, OPEN_WORLD_FEATURE_GROUND_RULE, OPEN_WORLD_HANDOFF, GAME_WORLD_FILE, GAME_FEATURES_INDEX_FILE,
  GAME_FEATURES_RULE, GAME_WORLD_RULE,
} from '../src/server/AgentV3/gameKitSeed';

const turn = { writingRun: true, moduleTurn: false, importTurn: false, stopped: false };
const env = {} as NodeJS.ProcessEnv;
// Synthetic project files: an open world has both the features list and the map's regions.
const openWorld = { [GAME_WORLD_FILE]: 'export const WORLD = { regions: [] };', [GAME_FEATURES_INDEX_FILE]: 'export const FEATURES = [];' };

describe('🌱 the rule bans only map-scale land, and says what to use instead', () => {
  it('names map-scale land, the kit way, and the planes that stay allowed', () => {
    for (const word of ['MAP-SCALE', '300 m', 'fixed y', 'world.heightAt', 'world.place', 'LAND region', 'world.highways'])
      expect(OPEN_WORLD_FEATURE_GROUND_RULE, word).toContain(word);
    for (const allowed of ['sign', 'decal', 'screen', 'HUD']) expect(OPEN_WORLD_FEATURE_GROUND_RULE.toLowerCase(), allowed).toContain(allowed.toLowerCase());
    expect(OPEN_WORLD_HANDOFF).toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
  });
  it('never forbids water, and never sends a sized ground object back as a question', () => {
    expect(OPEN_WORLD_FEATURE_GROUND_RULE).not.toMatch(/no [^.]*\bwater\b[^.]*of its own/i);
    expect(OPEN_WORLD_FEATURE_GROUND_RULE).not.toMatch(/ask the user/i);
    expect(OPEN_WORLD_FEATURE_GROUND_RULE).toMatch(/its water, grass or tarmac is part of it/);
  });
});

// The opposite class (re-review 2026-11-23): sized ground objects the user asks for are ALLOWED — the rule each turn
// carries names them as fine, at their real size, placed with world.place and following heightAt.
describe('🏏 a sized ground object the user asks for is allowed — Hindi and English', () => {
  const asks: Array<[string, string]> = [
    ['beech me ek cricket ground banao', 'cricket ground'],
    ['add a cricket ground in the middle', 'cricket ground'],
    ['football field add karo', 'football field'],
    ['add a football field next to the city', 'football field'],
    ['ek swimming pool banao', 'swimming pool'],
    ['ek talaab banao', 'talaab'],
    ['make a pond near the village', 'pond'],
    ['parking lot banao', 'parking lot'],
    ['add a parking lot by the mall', 'parking lot'],
    ['race track banao', 'race track'],
    ['build a race track outside the city', 'race track'],
    ['ek basketball court banao', 'court'],
  ];
  for (const [ask, kind] of asks) it(ask, () => {
    const block = gameTurnHandoff(ask, openWorld, turn, env).block;
    expect(block).toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
    const allowed = OPEN_WORLD_FEATURE_GROUND_RULE.slice(OPEN_WORLD_FEATURE_GROUND_RULE.indexOf('A SIZED GROUND OBJECT IS FINE'));
    expect(allowed, kind).toContain(kind);
    expect(allowed).toMatch(/world\.place\(object, x, z\)/);
    expect(allowed).toMatch(/follows world\.heightAt/);
  });
});

describe('🗣️ said on every open-world turn, whatever the language', () => {
  const asks = [
    'beech me ghaas ka maidan banao',                // Hindi (Latin)
    'बीच में घास का मैदान बनाओ',                     // Hindi (Devanagari)
    'add a big grass field in the middle of the map', // English
    'sab shehar ko road se jodo',                     // Hindi
    'connect every town with a road',                 // English
    'score 2x karo',                                  // an unrelated Hindi edit: still an open world
  ];
  for (const ask of asks) it(ask, () => {
    const block = gameTurnHandoff(ask, openWorld, turn, env).block;
    expect(block).toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
    expect(block).toContain(GAME_FEATURES_RULE);
    expect(block).toContain(GAME_WORLD_RULE);
  });
});

describe('🚫 never said outside an open world', () => {
  it('a features-only game (a runner, a fighter) and a map file alone do not get it', () => {
    expect(projectGrowthRules({ [GAME_FEATURES_INDEX_FILE]: 'x' })).not.toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
    expect(projectGrowthRules({ [GAME_WORLD_FILE]: 'x' })).not.toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
    expect(projectGrowthRules({})).toBe('');
    const race = { 'src/App.tsx': "import { RacingRoadGame } from './game/RacingRoadGame';\nexport default function App() { return <RacingRoadGame />; }" };
    expect(projectGrowthRules(race)).not.toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
    expect(gameTurnHandoff('build a notes app', {}, turn, env).block).not.toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
  });
  it('is said once per turn, not twice', () => {
    const block = gameTurnHandoff('map bada karo', openWorld, turn, env).block;
    expect(block.split(OPEN_WORLD_FEATURE_GROUND_RULE).length - 1).toBe(1);
  });
});
