/**
 * BR1977 — "Lata Mangeshkar City" Hinglish 3D request.
 *
 * The user asked for a realistic 3D Indian-city game where the player works,
 * earns Paisa, and buys gadiyan (cars); crime leads to a police arrest that
 * bail (also Paisa) undoes. The platform recorded a game contract with
 * vehicle:null (it already knew "gaadi" but not "gadiyan") and GAME_KIT_SEEDED
 * listing five recipes and 3 files after SANDBOX_UNAVAILABLE. The builder was
 * told the kit was on disk; six seconds later src/game/core/events.ts was
 * missing. It invented src/game/lata-city/car (written after the missing-file
 * gate), the preview 404'd, and RELEASE_GATE stayed RED.
 *
 * F1: gadi / gadiyan / gaadiyan are the same vehicle as gaadi.
 * F2: a recipe "success" with fewer landed files than successful recipes
 *     is not a seeded kit — do not tell the builder the files are on disk,
 *     and do not prepare 3D assets on a missing 3D layer.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { buildGameContract, gameContractBlock } from '../src/server/AgentV3/gameIntent';
import {
  gameKitPlan,
  gameKitHandoffBlock,
  gameKitSeededMessage,
  kitSeedClaimIsHonest,
  downgradeEmptyKitSeedSuccesses,
  type GameKitSeedResult,
} from '../src/server/AgentV3/gameKitSeed';

const PROMPT = 'Mujhko bahut achcha 3D mein game chahie Lata Mangeshkar City ek Indian city jaisa design hona chahiye Koi bad mein game khelne jaaye to pahle usko player milega uske bad vah player se kuchh bhi kam karvaega aur uske bad uske pass ka Paisa aaega aur Paisa aane ke bad vah kuchh gadiyan matlab jo kharidna chahe vah kharidega aur usmein kadhai hoga to police usko utha Le jayegi aur usko police se bhi chhutane ke liye Paisa hi lagega ekadam realistic rahana chahie 3D mein game hona chahie';

const INTENT = readFileSync(resolve(__dirname, '../src/server/AgentV3/gameIntent.ts'), 'utf8');
const SEED = readFileSync(resolve(__dirname, '../src/server/AgentV3/gameKitSeed.ts'), 'utf8');
const ROUTE = readFileSync(resolve(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

describe('BR1977 — this Hinglish city prompt names a driveable car', () => {
  it('reads gadiyan as a car without turning the request into a racing game', () => {
    const c = buildGameContract(PROMPT);
    expect(c.vehicle).toBe('car');
    expect(c.genre).toBe('unknown');
    expect(c.dimension).toBe('3d');
    expect(c.subjects).toEqual(['building']);
    expect(c.requiredFeatures).toEqual([]);
    expect(c.camera).toBe('third-person');
    expect(c.externalAssets).toBe(false);
    expect(gameContractBlock(c)).toContain('The player drives: a car');
    expect(gameContractBlock(c)).toContain("Camera: a chase view from OUTSIDE the car");
  });

  it('the same spellings still work on their own, and gaadi is unchanged', () => {
    expect(buildGameContract('gadiyan kharidna hai 3D game').vehicle).toBe('car');
    expect(buildGameContract('gadiyaan wala 3D game').vehicle).toBe('car');
    expect(buildGameContract('gaadiyan wala 3D game').vehicle).toBe('car');
    expect(buildGameContract('ek gadi wala 3D game').vehicle).toBe('car');
    expect(buildGameContract('gadiya chahiye 3D game').vehicle).toBe('car');
    expect(buildGameContract('ek gaadi wala 3D game').vehicle).toBe('car');
    expect(buildGameContract('ek car wala khel banao').vehicle).toBe('car');
    expect(buildGameContract('ek car wala khel banao').genre).toBe('racing');
  });

  it('does not steal a train, a bicycle, a snake, or a word that only looks like gadi', () => {
    const train = buildGameContract('Create a 3D train simulator with a realistic train, railway tracks, trees, buildings and mountains and free external 3D assets and mobile controls');
    expect(train.vehicle).toBe('train');
    expect(train.genre).toBe('simulator');
    expect(buildGameContract('bicycle race game').vehicle).toBe('bicycle');
    expect(buildGameContract('a snake game with score').vehicle).toBeNull();
    expect(buildGameContract('brigadier game').vehicle).toBeNull();
    expect(buildGameContract('gta5 wala game').vehicle).toBeNull();
  });

  it('still plans the 3D kit and stays in the game domain (this is not Q-2650)', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('game');
    expect(gameKitPlan(PROMPT, 'vite-react')).toEqual([
      'generate_game_runtime', 'generate_game_3d', 'generate_game_vfx', 'generate_melody', 'generate_game_shell',
    ]);
    expect(analyzeRequirementGaps('Mujhe ak bike race app bana kar dedo').domain).not.toBe('game');
    expect(gameKitPlan('type of super market simulator', 'vite-react').includes('generate_game_3d')).toBe(false);
  });

  it('the car regex in source lists the Hinglish spellings', () => {
    expect(INTENT).toContain('gaadiyaan|gaadiyan|gadiyaan|gadiyan|gadiya|gaadi|gadi');
  });
});

describe('BR1977 — five successful recipes and three files is not a seeded kit', () => {
  const emptyOk = (recipe: GameKitSeedResult['recipe']): GameKitSeedResult => (
    { recipe, ok: true, content: 'Created nothing' }
  );

  it('the honesty bar is one landed file per successful recipe', () => {
    expect(kitSeedClaimIsHonest(5, 3)).toBe(false);
    expect(kitSeedClaimIsHonest(5, 5)).toBe(true);
    expect(kitSeedClaimIsHonest(5, 30)).toBe(true);
    expect(kitSeedClaimIsHonest(1, 1)).toBe(true);
    expect(kitSeedClaimIsHonest(3, 3)).toBe(true);
    expect(kitSeedClaimIsHonest(0, 0)).toBe(false);
    expect(kitSeedClaimIsHonest(2, 0)).toBe(false);
    expect(kitSeedClaimIsHonest(Number.NaN, 4)).toBe(false);
  });

  it('this report\'s five empty successes are downgraded so the handoff stays silent', () => {
    const results: GameKitSeedResult[] = [
      emptyOk('generate_game_runtime'),
      emptyOk('generate_game_3d'),
      emptyOk('generate_game_vfx'),
      emptyOk('generate_melody'),
      emptyOk('generate_game_shell'),
    ];
    downgradeEmptyKitSeedSuccesses(results, 3);
    expect(results.every((r) => r.ok === false)).toBe(true);
    expect(results[0].content).toContain('only 3 file(s) landed for 5 recipe(s)');
    expect(gameKitHandoffBlock(results)).toBe('');
    expect(gameKitSeededMessage(results, 3, 22400)).toContain('Not laid down: generate_game_runtime');
  });

  it('a healthy ~30-file 3D seed is left alone and still tells the builder the kit is on disk', () => {
    const results: GameKitSeedResult[] = [
      emptyOk('generate_game_runtime'),
      emptyOk('generate_game_3d'),
      emptyOk('generate_game_vfx'),
      emptyOk('generate_melody'),
      emptyOk('generate_game_shell'),
    ];
    downgradeEmptyKitSeedSuccesses(results, 30);
    expect(results.every((r) => r.ok)).toBe(true);
    const handoff = gameKitHandoffBlock(results);
    expect(handoff).toContain('Their files are on disk NOW');
    expect(gameKitSeededMessage(results, 30, 22400)).toContain(
      'Laid down the game kit before the first model call: generate_game_runtime, generate_game_3d, generate_game_vfx, generate_melody, generate_game_shell (30 files',
    );
    expect(gameKitSeededMessage(results, 30, 22400)).not.toContain('Not laid down');
  });

  it('recipes that already failed stay failed, and a 1-for-1 seed still counts', () => {
    const mixed: GameKitSeedResult[] = [
      emptyOk('generate_game_runtime'),
      { recipe: 'generate_game_3d', ok: false, content: 'sandbox unavailable' },
      emptyOk('generate_game_vfx'),
    ];
    downgradeEmptyKitSeedSuccesses(mixed, 2);
    expect(mixed.filter((r) => r.ok).map((r) => r.recipe)).toEqual(['generate_game_runtime', 'generate_game_vfx']);
    expect(mixed[1].ok).toBe(false);
    expect(mixed[1].content).toBe('sandbox unavailable');
  });

  it('the route counts recipe writes (not later assets) and downgrades before 3D-asset prep', () => {
    expect(SEED).toContain('export function kitSeedClaimIsHonest');
    expect(SEED).toContain('export function downgradeEmptyKitSeedSuccesses');
    expect(ROUTE).toContain('downgradeEmptyKitSeedSuccesses(kitResults, recipeFiles)');
    expect(ROUTE).toContain('const recipeFiles = [...writtenFiles].filter(([p, c]) => writtenBeforeKit.get(p) !== c).length;');
    const downgradeAt = ROUTE.indexOf('downgradeEmptyKitSeedSuccesses(kitResults, recipeFiles)');
    const assetsAt = ROUTE.indexOf('if (gameKitCanPrepareAssets(kitResults) && !abort.signal.aborted)');
    expect(downgradeAt).toBeGreaterThan(0);
    expect(assetsAt).toBeGreaterThan(downgradeAt);
  });
});
