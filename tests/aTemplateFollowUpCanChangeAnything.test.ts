// A template is a starting point (owner t417u). After the build, a normal follow-up may change the
// character, add a level, change the rules, or switch the genre. The growth guard must let that edit
// through, and must still put back a kit file the request never mentioned.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  APP_FILE, FEATURES_INDEX, PLAYER_FILE, WORLD_FILE, changesGenre, growthVerdict, replacesWholeGame,
} from '../src/server/AgentV3/growthGuard';
import { recipeFilePool } from '../src/server/lib/gameRecipeLayers';
import { openWorldAppSource } from '../src/server/lib/GameOpenWorldGenerator';

const STARTERS = ['src/game/LaneRunnerGame.tsx', 'src/game/RacingRoadGame.tsx', 'src/game/OpenWorldGame.tsx'] as const;
const RULES = 'src/game/core/runner.ts';
const kit = (path: string): string => {
  const file = recipeFilePool().get(path);
  if (!file) throw new Error(`missing kit file ${path}`);
  return file.content;
};
const edited = (path: string): string => `${kit(path)}\n// follow-up edit\n`;

const INDEX = "import coins from './coins';\nexport const FEATURES = [\n  coins,\n];\n";
const WORLD = "export const WORLD = { regions: [\n  { id: 'main-city', kind: 'city' },\n] };\n";
const ADDED_LEVEL = "export const WORLD = { regions: [\n  { id: 'main-city', kind: 'city' },\n  { id: 'level-2', kind: 'town', toward: 'east' },\n] };\n";

describe('a follow-up on a template-based game is a normal edit', () => {
  it('change the character opens every starter and the player file', () => {
    const request = 'change the character to a tall runner in a red shirt';
    for (const path of STARTERS) {
      expect(growthVerdict({ path, before: kit(path), after: edited(path), request }).allow, path).toBe(true);
    }
    expect(growthVerdict({ path: PLAYER_FILE, before: 'export const PLAYER = { look: { shirt: 0x222222 } };\n', after: 'export const PLAYER = { look: { shirt: 0xff0000 } };\n', request }).allow).toBe(true);
  });

  it('add a level opens the starters and keeps the places already on the map', () => {
    const request = 'add a level after the city';
    for (const path of STARTERS) {
      expect(growthVerdict({ path, before: kit(path), after: edited(path), request }).allow, path).toBe(true);
    }
    expect(growthVerdict({ path: WORLD_FILE, before: WORLD, after: ADDED_LEVEL, request }).allow).toBe(true);
  });

  it('change the rules opens the starters and the runner rules', () => {
    const request = 'change the rules so a hit costs a life and three coins make a shield';
    for (const path of [...STARTERS, RULES]) {
      expect(growthVerdict({ path, before: kit(path), after: edited(path), request }).allow, path).toBe(true);
    }
  });

  it('graphics, sounds, language and UI each open the file that holds them', () => {
    const cases: Array<[string, string]> = [
      ['change the graphics to a night city', STARTERS[0]],
      ['change the sounds to softer footsteps', 'src/game/fx/audio.ts'],
      ['change the language of the menus to Hindi', 'src/game/ui/Hud.tsx'],
      ['change the UI so the pause button is bigger', 'src/game/ui/Hud.tsx'],
    ];
    for (const [request, path] of cases) {
      expect(growthVerdict({ path, before: kit(path), after: edited(path), request }).allow, request).toBe(true);
    }
  });

  it('a different genre may replace the starter, the mount and the old parts', () => {
    const request = 'make this a platformer instead';
    expect(changesGenre(request)).toBe(true);
    expect(replacesWholeGame(request)).toBe(true);
    expect(growthVerdict({ path: STARTERS[2], before: kit(STARTERS[2]), after: edited(STARTERS[2]), request }).allow).toBe(true);
    expect(growthVerdict({ path: APP_FILE, before: openWorldAppSource({ city: true }), after: 'export default function App() { return <canvas />; }\n', request }).allow).toBe(true);
    expect(growthVerdict({ path: 'src/game/features/coins.ts', before: 'export default function coins() { return null; }\n', after: null, request }).allow).toBe(true);
    expect(growthVerdict({ path: FEATURES_INDEX, before: INDEX, after: 'export const FEATURES = [\n];\n', request }).allow).toBe(true);
  });

  it('a request that is not about the template still does not rewrite the camera', () => {
    const camera = 'src/game/three/camera.ts';
    expect(growthVerdict({ path: camera, before: kit(camera), after: edited(camera), request: 'add a fruit stall in the market' })).toMatchObject({ allow: false });
    expect(changesGenre('add a level')).toBe(false);
    expect(changesGenre('change the character')).toBe(false);
    expect(changesGenre('make it faster')).toBe(false);
  });

  it('the seeded starters say they are a starting point, not a locked template', () => {
    const openWorld = readFileSync('src/server/lib/GameOpenWorldGenerator.ts', 'utf8');
    const shell = readFileSync('src/server/lib/GameShellGenerator.ts', 'utf8');
    expect(openWorld).toContain('THIS FILE IS A STARTING POINT');
    expect(openWorld).not.toContain('never replace the world, the player or the camera');
    expect(shell).toContain('STARTING POINT');
    expect(shell).toContain('not a locked template');
  });
});
