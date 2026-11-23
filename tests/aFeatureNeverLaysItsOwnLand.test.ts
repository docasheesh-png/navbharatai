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

describe('🌱 the rule says what a feature must not lay, and what to use instead', () => {
  it('names the land meshes, the kit way, and the planes that stay allowed', () => {
    for (const word of ['ground', 'grass', 'water', 'terrain', 'road mesh', 'PlaneGeometry', 'world.place(object, x, z)', 'LAND region', 'world.highways'])
      expect(OPEN_WORLD_FEATURE_GROUND_RULE, word).toContain(word);
    for (const allowed of ['sign', 'decal', 'screen', 'HUD']) expect(OPEN_WORLD_FEATURE_GROUND_RULE, allowed).toContain(allowed);
    expect(OPEN_WORLD_FEATURE_GROUND_RULE).toMatch(/ask the user/);
    expect(OPEN_WORLD_HANDOFF).toContain(OPEN_WORLD_FEATURE_GROUND_RULE);
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
